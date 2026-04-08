from __future__ import annotations

import asyncio
import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.modules.accounts.codex_live_usage import (
    LocalCodexLiveUsage,
    LocalCodexTaskPreview,
    read_live_codex_process_session_counts_by_snapshot,
    read_local_codex_live_usage_by_snapshot,
    read_local_codex_task_previews_by_session_id,
    read_local_codex_task_previews_by_snapshot,
    read_runtime_live_session_counts_by_snapshot,
)

_DEFAULT_OVERVIEW_WS_POLL_SECONDS = 2.0
_DEFAULT_OVERVIEW_WS_HEARTBEAT_SECONDS = 20.0


def _poll_interval_seconds() -> float:
    raw = os.getenv("CODEX_LB_DASHBOARD_OVERVIEW_WS_POLL_SECONDS")
    if raw is None:
        return _DEFAULT_OVERVIEW_WS_POLL_SECONDS
    try:
        return max(0.1, float(raw))
    except ValueError:
        return _DEFAULT_OVERVIEW_WS_POLL_SECONDS


def _heartbeat_interval_seconds() -> float:
    raw = os.getenv("CODEX_LB_DASHBOARD_OVERVIEW_WS_HEARTBEAT_SECONDS")
    if raw is None:
        return _DEFAULT_OVERVIEW_WS_HEARTBEAT_SECONDS
    try:
        return max(1.0, float(raw))
    except ValueError:
        return _DEFAULT_OVERVIEW_WS_HEARTBEAT_SECONDS


def _json_timestamp_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _serialize_usage_window(window: Any) -> dict[str, Any] | None:
    if window is None:
        return None
    return {
        "used_percent": round(float(window.used_percent), 4),
        "reset_at": window.reset_at,
        "window_minutes": window.window_minutes,
    }


def _serialize_live_usage(value: LocalCodexLiveUsage) -> dict[str, Any]:
    return {
        "recorded_at": value.recorded_at.isoformat(),
        "active_session_count": int(value.active_session_count),
        "primary": _serialize_usage_window(value.primary),
        "secondary": _serialize_usage_window(value.secondary),
    }


def _serialize_task_preview(value: LocalCodexTaskPreview) -> dict[str, Any]:
    return {
        "text": value.text,
        "recorded_at": value.recorded_at.isoformat(),
    }


def compute_dashboard_overview_fingerprint() -> str:
    now = datetime.now(timezone.utc)
    usage_by_snapshot = read_local_codex_live_usage_by_snapshot(now=now)
    runtime_counts = read_runtime_live_session_counts_by_snapshot(now=now)
    process_counts = read_live_codex_process_session_counts_by_snapshot()
    preview_by_snapshot = read_local_codex_task_previews_by_snapshot(now=now)
    preview_by_session_id = read_local_codex_task_previews_by_session_id(now=now)

    payload = {
        "usage_by_snapshot": {
            snapshot: _serialize_live_usage(usage)
            for snapshot, usage in sorted(usage_by_snapshot.items(), key=lambda item: item[0])
        },
        "runtime_counts_by_snapshot": dict(sorted((snapshot, int(count)) for snapshot, count in runtime_counts.items())),
        "process_counts_by_snapshot": dict(sorted((snapshot, int(count)) for snapshot, count in process_counts.items())),
        "task_preview_by_snapshot": {
            snapshot: _serialize_task_preview(preview)
            for snapshot, preview in sorted(preview_by_snapshot.items(), key=lambda item: item[0])
        },
        "task_preview_by_session_id": {
            session_id: _serialize_task_preview(preview)
            for session_id, preview in sorted(preview_by_session_id.items(), key=lambda item: item[0])
        },
    }

    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


async def _safe_send(websocket: WebSocket, payload: dict[str, Any]) -> bool:
    if websocket.application_state != WebSocketState.CONNECTED:
        return False
    try:
        await websocket.send_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    except (RuntimeError, WebSocketDisconnect):
        return False
    return True


async def stream_dashboard_overview_updates(websocket: WebSocket) -> None:
    poll_seconds = _poll_interval_seconds()
    heartbeat_seconds = _heartbeat_interval_seconds()
    previous_fingerprint = await asyncio.to_thread(compute_dashboard_overview_fingerprint)
    heartbeat_elapsed = 0.0

    await _safe_send(
        websocket,
        {
            "type": "dashboard.overview.connected",
            "ts": _json_timestamp_now(),
        },
    )

    try:
        while websocket.application_state == WebSocketState.CONNECTED:
            await asyncio.sleep(poll_seconds)
            current_fingerprint = await asyncio.to_thread(compute_dashboard_overview_fingerprint)

            if current_fingerprint != previous_fingerprint:
                previous_fingerprint = current_fingerprint
                sent = await _safe_send(
                    websocket,
                    {
                        "type": "dashboard.overview.invalidate",
                        "reason": "live_usage_changed",
                        "ts": _json_timestamp_now(),
                    },
                )
                if not sent:
                    return

            heartbeat_elapsed += poll_seconds
            if heartbeat_elapsed >= heartbeat_seconds:
                heartbeat_elapsed = 0.0
                sent = await _safe_send(
                    websocket,
                    {
                        "type": "dashboard.overview.heartbeat",
                        "ts": _json_timestamp_now(),
                    },
                )
                if not sent:
                    return
    except WebSocketDisconnect:
        return
