from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.core.config.settings import get_settings
from app.modules.accounts.live_session_continuity_cache import (
    LiveSessionContinuitySignal,
    close_live_session_continuity_cache,
    get_live_session_continuity_cache,
)


@pytest.mark.asyncio
async def test_file_cache_recovers_signal_across_cache_restart(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache_path = tmp_path / "dashboard-session-continuity.json"
    monkeypatch.setenv("CODEX_LB_DASHBOARD_SESSION_CONTINUITY_REDIS_URL", "")
    monkeypatch.setenv("CODEX_LB_DASHBOARD_SESSION_CONTINUITY_FILE_PATH", str(cache_path))
    monkeypatch.setenv("CODEX_LB_DASHBOARD_SESSION_CONTINUITY_TTL_SECONDS", "600")
    get_settings.cache_clear()
    await close_live_session_continuity_cache()

    signal = LiveSessionContinuitySignal(
        account_id="acc-file-restart",
        snapshot_name="snapshot-a",
        codex_live_session_count=1,
        codex_tracked_session_count=1,
        has_live_session=True,
        task_preview="resume previous CLI session after restart",
    )

    first_cache = get_live_session_continuity_cache()
    await first_cache.store([signal])

    # Simulate backend restart by dropping the singleton and recreating it.
    await close_live_session_continuity_cache()
    get_settings.cache_clear()
    second_cache = get_live_session_continuity_cache()
    recovered = await second_cache.load([signal.account_id])

    assert recovered == {signal.account_id: signal}

    await close_live_session_continuity_cache()
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_file_cache_drops_stale_signal_on_load(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache_path = tmp_path / "dashboard-session-continuity.json"
    monkeypatch.setenv("CODEX_LB_DASHBOARD_SESSION_CONTINUITY_REDIS_URL", "")
    monkeypatch.setenv("CODEX_LB_DASHBOARD_SESSION_CONTINUITY_FILE_PATH", str(cache_path))
    monkeypatch.setenv("CODEX_LB_DASHBOARD_SESSION_CONTINUITY_TTL_SECONDS", "60")
    get_settings.cache_clear()
    await close_live_session_continuity_cache()

    signal = LiveSessionContinuitySignal(
        account_id="acc-stale",
        snapshot_name="snapshot-a",
        codex_live_session_count=1,
        codex_tracked_session_count=0,
        has_live_session=True,
        task_preview="stale preview should expire",
    )

    cache = get_live_session_continuity_cache()
    await cache.store([signal])

    payload = json.loads(cache_path.read_text(encoding="utf-8"))
    payload[signal.account_id]["recorded_at"] = (
        datetime.now(timezone.utc) - timedelta(hours=3)
    ).isoformat()
    cache_path.write_text(json.dumps(payload), encoding="utf-8")

    await close_live_session_continuity_cache()
    get_settings.cache_clear()

    restarted_cache = get_live_session_continuity_cache()
    recovered = await restarted_cache.load([signal.account_id])
    assert recovered == {}

    pruned_payload = json.loads(cache_path.read_text(encoding="utf-8"))
    assert signal.account_id not in pruned_payload

    await close_live_session_continuity_cache()
    get_settings.cache_clear()
