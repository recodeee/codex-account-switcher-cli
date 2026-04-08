from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.auth.dependencies import validate_dashboard_websocket_session
from app.modules.dashboard_auth.service import DASHBOARD_SESSION_COOKIE

pytestmark = pytest.mark.unit


class _FakeWebSocket:
    def __init__(self, *, cookies: dict[str, str] | None = None) -> None:
        self.cookies = cookies or {}
        self.closed: tuple[int, str] | None = None

    async def close(self, *, code: int, reason: str) -> None:
        self.closed = (code, reason)


@pytest.mark.asyncio
async def test_validate_dashboard_websocket_session_allows_when_auth_not_required(monkeypatch: pytest.MonkeyPatch):
    websocket = _FakeWebSocket()
    settings = SimpleNamespace(password_hash=None, totp_required_on_login=False)

    class _SettingsCache:
        async def get(self):
            return settings

    monkeypatch.setattr("app.core.auth.dependencies.get_settings_cache", lambda: _SettingsCache())

    result = await validate_dashboard_websocket_session(websocket)  # type: ignore[arg-type]
    assert result is True
    assert websocket.closed is None


@pytest.mark.asyncio
async def test_validate_dashboard_websocket_session_rejects_missing_session(monkeypatch: pytest.MonkeyPatch):
    websocket = _FakeWebSocket()
    settings = SimpleNamespace(password_hash="hashed", totp_required_on_login=False)

    class _SettingsCache:
        async def get(self):
            return settings

    monkeypatch.setattr("app.core.auth.dependencies.get_settings_cache", lambda: _SettingsCache())
    monkeypatch.setattr(
        "app.core.auth.dependencies.get_dashboard_session_store",
        lambda: SimpleNamespace(get=lambda _session_id: None),
    )

    result = await validate_dashboard_websocket_session(websocket)  # type: ignore[arg-type]
    assert result is False
    assert websocket.closed == (4401, "Authentication is required")


@pytest.mark.asyncio
async def test_validate_dashboard_websocket_session_rejects_totp_missing_verification(
    monkeypatch: pytest.MonkeyPatch,
):
    websocket = _FakeWebSocket(cookies={DASHBOARD_SESSION_COOKIE: "session-1"})
    settings = SimpleNamespace(password_hash="hashed", totp_required_on_login=True)
    state = SimpleNamespace(password_verified=True, totp_verified=False)

    class _SettingsCache:
        async def get(self):
            return settings

    monkeypatch.setattr("app.core.auth.dependencies.get_settings_cache", lambda: _SettingsCache())
    monkeypatch.setattr(
        "app.core.auth.dependencies.get_dashboard_session_store",
        lambda: SimpleNamespace(get=lambda _session_id: state),
    )

    result = await validate_dashboard_websocket_session(websocket)  # type: ignore[arg-type]
    assert result is False
    assert websocket.closed == (4403, "TOTP verification is required")
