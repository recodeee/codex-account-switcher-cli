from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.modules.dashboard import live_updates as live_updates_module

pytestmark = pytest.mark.integration


def test_dashboard_overview_websocket_emits_invalidation_when_fingerprint_changes(
    app_instance,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("CODEX_LB_DASHBOARD_OVERVIEW_WS_POLL_SECONDS", "0.05")
    monkeypatch.setenv("CODEX_LB_DASHBOARD_OVERVIEW_WS_HEARTBEAT_SECONDS", "10")

    fingerprints = iter(["same", "same", "changed"])
    monkeypatch.setattr(
        live_updates_module,
        "compute_dashboard_overview_fingerprint",
        lambda: next(fingerprints, "changed"),
    )

    with TestClient(app_instance) as client:
        with client.websocket_connect("/api/dashboard/overview/ws") as websocket:
            connected_message = json.loads(websocket.receive_text())
            assert connected_message["type"] == "dashboard.overview.connected"

            invalidate_message: dict[str, object] | None = None
            for _ in range(8):
                message = json.loads(websocket.receive_text())
                if message.get("type") == "dashboard.overview.invalidate":
                    invalidate_message = message
                    break

            assert invalidate_message is not None
            assert invalidate_message["reason"] == "live_usage_changed"


def test_dashboard_overview_websocket_requires_authenticated_dashboard_session(
    app_instance,
):
    with TestClient(app_instance) as authenticated_client:
        setup = authenticated_client.post(
            "/api/dashboard-auth/password/setup",
            json={"password": "password123"},
        )
        assert setup.status_code == 200

        with authenticated_client.websocket_connect("/api/dashboard/overview/ws") as websocket:
            connected_message = json.loads(websocket.receive_text())
            assert connected_message["type"] == "dashboard.overview.connected"

    with TestClient(app_instance) as unauthenticated_client:
        with pytest.raises(WebSocketDisconnect) as exc:
            with unauthenticated_client.websocket_connect("/api/dashboard/overview/ws"):
                pass
        assert exc.value.code == 4401
