from __future__ import annotations

import asyncio
import os
from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket

from app.core.auth.dependencies import (
    set_dashboard_error_format,
    validate_dashboard_session,
    validate_dashboard_websocket_session,
)
from app.core.openai.model_registry import get_model_registry, is_public_model
from app.db.session import SessionLocal
from app.modules.dashboard.repository import DashboardRepository
from app.modules.dashboard.live_updates import stream_dashboard_overview_updates
from app.modules.dashboard.schemas import (
    DashboardOverviewResponse,
    DashboardSystemMonitorResponse,
)
from app.modules.dashboard.service import DashboardService
from app.modules.dashboard.system_monitor import collect_dashboard_system_monitor_sample

router = APIRouter(
    prefix="/api",
    tags=["dashboard"],
    dependencies=[Depends(validate_dashboard_session), Depends(set_dashboard_error_format)],
)
ws_router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])
_DEFAULT_DASHBOARD_OVERVIEW_SINGLEFLIGHT_TIMEOUT_SECONDS = 30.0
_MIN_DASHBOARD_OVERVIEW_SINGLEFLIGHT_TIMEOUT_SECONDS = 0.01


def _dashboard_overview_singleflight_timeout_seconds() -> float:
    raw = os.getenv("CODEX_LB_DASHBOARD_OVERVIEW_TIMEOUT_SECONDS")
    if raw is None:
        return _DEFAULT_DASHBOARD_OVERVIEW_SINGLEFLIGHT_TIMEOUT_SECONDS
    try:
        return max(_MIN_DASHBOARD_OVERVIEW_SINGLEFLIGHT_TIMEOUT_SECONDS, float(raw))
    except ValueError:
        return _DEFAULT_DASHBOARD_OVERVIEW_SINGLEFLIGHT_TIMEOUT_SECONDS


class _DashboardOverviewSingleFlight:
    def __init__(self, timeout_seconds: float | None = None) -> None:
        self._lock = asyncio.Lock()
        self._inflight: asyncio.Task[DashboardOverviewResponse] | None = None
        self._timeout_seconds = (
            _dashboard_overview_singleflight_timeout_seconds()
            if timeout_seconds is None
            else max(_MIN_DASHBOARD_OVERVIEW_SINGLEFLIGHT_TIMEOUT_SECONDS, float(timeout_seconds))
        )

    async def run(
        self,
        loader: Callable[[], Coroutine[Any, Any, DashboardOverviewResponse]],
    ) -> DashboardOverviewResponse:
        async with self._lock:
            task = self._inflight
            if task is None:
                task = asyncio.create_task(self._run_loader(loader))
                self._inflight = task
                task.add_done_callback(self._clear_if_done)
        return await asyncio.shield(task)

    async def _run_loader(
        self,
        loader: Callable[[], Coroutine[Any, Any, DashboardOverviewResponse]],
    ) -> DashboardOverviewResponse:
        return await asyncio.wait_for(loader(), timeout=self._timeout_seconds)

    def _clear_if_done(self, task: asyncio.Task[DashboardOverviewResponse]) -> None:
        # Read terminal state so cancelled orphan tasks never produce
        # "Task exception was never retrieved" warnings.
        try:
            task.exception()
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
        if self._inflight is task:
            self._inflight = None


_overview_singleflight = _DashboardOverviewSingleFlight()


async def _load_dashboard_overview() -> DashboardOverviewResponse:
    async with SessionLocal() as session:
        service = DashboardService(DashboardRepository(session))
        return await service.get_overview()


@router.get("/dashboard/overview", response_model=DashboardOverviewResponse)
async def get_overview() -> DashboardOverviewResponse:
    try:
        return await _overview_singleflight.run(_load_dashboard_overview)
    except TimeoutError as exc:
        raise HTTPException(
            status_code=503,
            detail="Dashboard overview refresh timed out. Retry shortly.",
        ) from exc


@ws_router.websocket("/overview/ws")
async def stream_overview_updates(websocket: WebSocket) -> None:
    if not await validate_dashboard_websocket_session(websocket):
        return
    await websocket.accept()
    await stream_dashboard_overview_updates(websocket)


@router.get("/models")
async def list_models() -> dict:
    registry = get_model_registry()
    models_by_slug = registry.get_models_with_fallback()
    if not models_by_slug:
        return {"models": []}
    models = [
        {"id": slug, "name": model.display_name or slug}
        for slug, model in models_by_slug.items()
        if is_public_model(model, None)
    ]
    return {"models": models}


@router.get(
    "/dashboard/system-monitor",
    response_model=DashboardSystemMonitorResponse,
)
async def get_system_monitor() -> DashboardSystemMonitorResponse:
    sample = collect_dashboard_system_monitor_sample()
    return DashboardSystemMonitorResponse(
        sampled_at=sample.sampled_at,
        cpu_percent=sample.cpu_percent,
        gpu_percent=sample.gpu_percent,
        vram_percent=sample.vram_percent,
        network_mb_s=sample.network_mb_s,
        memory_percent=sample.memory_percent,
        spike=sample.spike,
    )
