from __future__ import annotations

import pytest
from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState
from typing import cast

from app.modules.dashboard import live_updates as live_updates_module


class _DisconnectingWebSocket:
    application_state = WebSocketState.CONNECTED

    async def send_text(self, text: str) -> None:
        raise WebSocketDisconnect(code=1006)


@pytest.mark.asyncio
async def test_stream_dashboard_overview_updates_treats_client_disconnect_during_initial_send_as_normal(
    monkeypatch,
) -> None:
    monkeypatch.setattr(live_updates_module, "compute_dashboard_overview_fingerprint", lambda: "stable")

    await live_updates_module.stream_dashboard_overview_updates(cast(WebSocket, _DisconnectingWebSocket()))
