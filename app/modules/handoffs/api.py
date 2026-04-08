from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.core.auth.dependencies import set_dashboard_error_format, validate_dashboard_session
from app.modules.handoffs.schemas import (
    RuntimeHandoffAbortRequest,
    RuntimeHandoffCreateRequest,
    RuntimeHandoffEntry,
    RuntimeHandoffListResponse,
    RuntimeHandoffResumeRequest,
    RuntimeHandoffResumeResponse,
    RuntimeHandoffStatus,
)
from app.modules.handoffs.service import RuntimeHandoffService

router = APIRouter(
    prefix="/api/runtime-handoffs",
    tags=["dashboard"],
    dependencies=[Depends(validate_dashboard_session), Depends(set_dashboard_error_format)],
)


def get_runtime_handoff_service() -> RuntimeHandoffService:
    return RuntimeHandoffService()


@router.get("", response_model=RuntimeHandoffListResponse)
async def list_runtime_handoffs(
    status: RuntimeHandoffStatus | None = Query(default=None),
    source_snapshot: str | None = Query(default=None, alias="sourceSnapshot"),
    limit: int = Query(default=100, ge=1, le=200),
    service: RuntimeHandoffService = Depends(get_runtime_handoff_service),
) -> RuntimeHandoffListResponse:
    entries = service.list_handoffs(status=status, source_snapshot=source_snapshot, limit=limit)
    return RuntimeHandoffListResponse(entries=entries, total=len(entries))


@router.post("", response_model=RuntimeHandoffEntry)
async def create_runtime_handoff(
    payload: RuntimeHandoffCreateRequest,
    service: RuntimeHandoffService = Depends(get_runtime_handoff_service),
) -> RuntimeHandoffEntry:
    return service.create_handoff(payload)


@router.post("/{handoff_id}/resume", response_model=RuntimeHandoffResumeResponse)
async def resume_runtime_handoff(
    handoff_id: str,
    payload: RuntimeHandoffResumeRequest,
    service: RuntimeHandoffService = Depends(get_runtime_handoff_service),
) -> RuntimeHandoffResumeResponse:
    handoff, resume_prompt = service.resume_handoff(handoff_id, payload)
    return RuntimeHandoffResumeResponse(handoff=handoff, resume_prompt=resume_prompt)


@router.post("/{handoff_id}/abort", response_model=RuntimeHandoffEntry)
async def abort_runtime_handoff(
    handoff_id: str,
    _payload: RuntimeHandoffAbortRequest,
    service: RuntimeHandoffService = Depends(get_runtime_handoff_service),
) -> RuntimeHandoffEntry:
    return service.abort_handoff(handoff_id)

