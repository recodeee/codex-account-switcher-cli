from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import OperationalError

pytestmark = pytest.mark.unit


def _bridge_ring_ok():
    from app.modules.health.schemas import BridgeRingInfo

    return BridgeRingInfo(
        ring_fingerprint="abc",
        ring_size=0,
        instance_id="pod-a",
        is_member=False,
    )


@pytest.mark.asyncio
async def test_health_live_always_ok():
    from app.modules.health.api import health_live

    response = await health_live()
    assert response.status == "ok"


@pytest.mark.asyncio
async def test_live_usage_returns_xml_payload():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"viktoredixaicom": 8},
                unattributed_session_pids=[],
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api.utcnow",
            return_value=datetime(2026, 4, 5, 0, 0, 0),
        ),
    ):
        response = await live_usage()

    assert response.media_type == "application/xml"
    assert response.headers.get("cache-control") == "no-store"
    body = response.body.decode("utf-8")
    assert (
        '<live_usage generated_at="2026-04-05T00:00:00Z" total_sessions="8" mapped_sessions="8" unattributed_sessions="0" total_task_previews="0">'
        in body
    )
    assert '<snapshot name="viktoredixaicom" session_count="8" />' in body


@pytest.mark.asyncio
async def test_live_usage_includes_task_previews_mapped_to_snapshot():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"unique": 4},
                unattributed_session_pids=[],
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(
                return_value={
                    "unique": [
                        SimpleNamespace(
                            account_id="acc-1",
                            preview="Investigate merged telemetry",
                        )
                    ]
                }
            ),
        ),
        patch(
            "app.modules.health.api.utcnow",
            return_value=datetime(2026, 4, 5, 0, 0, 0),
        ),
    ):
        response = await live_usage()

    body = response.body.decode("utf-8")
    assert (
        '<live_usage generated_at="2026-04-05T00:00:00Z" total_sessions="4" mapped_sessions="4" unattributed_sessions="0" total_task_previews="1">'
        in body
    )
    assert '<snapshot name="unique" session_count="4" task_preview_count="1">' in body
    assert (
        '<task_preview account_id="acc-1" preview="Investigate merged telemetry" />'
        in body
    )


@pytest.mark.asyncio
async def test_live_usage_surfaces_unattributed_cli_sessions():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"thedailyscooby": 2},
                unattributed_session_pids=[701, 702],
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api.utcnow",
            return_value=datetime(2026, 4, 5, 0, 0, 0),
        ),
    ):
        response = await live_usage()

    body = response.body.decode("utf-8")
    assert (
        '<live_usage generated_at="2026-04-05T00:00:00Z" total_sessions="4" mapped_sessions="2" unattributed_sessions="2" total_task_previews="0">'
        in body
    )
    assert '<snapshot name="thedailyscooby" session_count="2" />' in body
    assert '<unattributed_sessions count="2">' in body
    assert '<session pid="701" />' in body
    assert '<session pid="702" />' in body


@pytest.mark.asyncio
async def test_read_live_usage_task_previews_by_snapshot_merges_local_preview_when_db_preview_missing():
    from app.modules.accounts.codex_auth_switcher import CodexAuthSnapshotIndex
    from app.modules.accounts.codex_live_usage import LocalCodexTaskPreview
    from app.modules.health.api import _read_live_usage_task_previews_by_snapshot

    now = datetime(2026, 4, 5, 0, 0, 0)
    account = SimpleNamespace(
        id="acc-1",
        email="owner@example.com",
        chatgpt_account_id="chatgpt-1",
    )
    repo = AsyncMock()
    repo.list_accounts = AsyncMock(return_value=[account])
    repo.list_codex_current_task_preview_by_account = AsyncMock(return_value={})

    async def _fake_session():
        yield AsyncMock()

    with (
        patch("app.modules.health.api.AccountsRepository", return_value=repo),
        patch("app.modules.health.api.get_session", return_value=_fake_session()),
        patch(
            "app.modules.health.api.build_snapshot_index",
            return_value=CodexAuthSnapshotIndex(
                snapshots_by_account_id={"acc-1": ["unique"]},
                active_snapshot_name="unique",
            ),
        ),
        patch(
            "app.modules.health.api.resolve_snapshot_names_for_account",
            return_value=["unique"],
        ),
        patch(
            "app.modules.health.api.select_snapshot_name",
            return_value="unique",
        ),
        patch(
            "app.modules.health.api.read_local_codex_task_previews_by_snapshot",
            return_value={
                "unique": LocalCodexTaskPreview(
                    text="Show local codex task preview in XML feed",
                    recorded_at=now,
                )
            },
        ),
        patch("app.modules.health.api.utcnow", return_value=now),
    ):
        previews = await _read_live_usage_task_previews_by_snapshot()

    assert "unique" in previews
    assert len(previews["unique"]) == 1
    assert previews["unique"][0].account_id == "acc-1"
    assert previews["unique"][0].preview == "Show local codex task preview in XML feed"


@pytest.mark.asyncio
async def test_read_live_usage_task_previews_by_snapshot_uses_local_preview_without_accounts():
    from app.modules.accounts.codex_live_usage import LocalCodexTaskPreview
    from app.modules.health.api import _read_live_usage_task_previews_by_snapshot

    now = datetime(2026, 4, 5, 0, 0, 0)
    repo = AsyncMock()
    repo.list_accounts = AsyncMock(return_value=[])
    repo.list_codex_current_task_preview_by_account = AsyncMock(return_value={})

    async def _fake_session():
        yield AsyncMock()

    with (
        patch("app.modules.health.api.AccountsRepository", return_value=repo),
        patch("app.modules.health.api.get_session", return_value=_fake_session()),
        patch(
            "app.modules.health.api.read_local_codex_task_previews_by_snapshot",
            return_value={
                "thedailyscooby": LocalCodexTaskPreview(
                    text="Show preview even before account import completes",
                    recorded_at=now,
                )
            },
        ),
        patch("app.modules.health.api.utcnow", return_value=now),
    ):
        previews = await _read_live_usage_task_previews_by_snapshot()

    assert "thedailyscooby" in previews
    assert len(previews["thedailyscooby"]) == 1
    assert previews["thedailyscooby"][0].account_id == "local"
    assert (
        previews["thedailyscooby"][0].preview
        == "Show preview even before account import completes"
    )


@pytest.mark.asyncio
async def test_live_usage_mapping_returns_xml_payload():
    from app.db.models import AccountStatus
    from app.modules.accounts.codex_auth_switcher import CodexAuthSnapshotIndex
    from app.modules.health.api import live_usage_mapping

    now = datetime(2026, 4, 5, 0, 0, 0)
    account = SimpleNamespace(
        id="acc-1",
        email="owner@example.com",
        chatgpt_account_id="chatgpt-1",
        status=AccountStatus.ACTIVE,
    )
    repo = AsyncMock()
    repo.list_accounts = AsyncMock(return_value=[account])
    repo.list_codex_session_counts_by_account = AsyncMock(return_value={"acc-1": 2})
    repo.list_codex_current_task_preview_by_account = AsyncMock(
        return_value={"acc-1": "Investigating session routing"},
    )

    with (
        patch("app.modules.health.api.AccountsRepository", return_value=repo),
        patch(
            "app.modules.health.api.build_snapshot_index",
            return_value=CodexAuthSnapshotIndex(
                snapshots_by_account_id={"acc-1": ["owner-example-com"]},
                active_snapshot_name="owner-example-com",
            ),
        ),
        patch(
            "app.modules.health.api.resolve_snapshot_names_for_account",
            return_value=["owner-example-com"],
        ),
        patch(
            "app.modules.health.api.select_snapshot_name",
            return_value="owner-example-com",
        ),
        patch(
            "app.modules.health.api.read_live_codex_process_session_counts_by_snapshot",
            return_value={"owner-example-com": 1, "orphan-snapshot": 3},
        ),
        patch(
            "app.modules.health.api.read_runtime_live_session_counts_by_snapshot",
            return_value={"owner-example-com": 4},
        ),
        patch("app.modules.health.api.utcnow", return_value=now),
    ):
        response = await live_usage_mapping(session=AsyncMock())

    assert response.media_type == "application/xml"
    assert response.headers.get("cache-control") == "no-store"
    body = response.body.decode("utf-8")
    assert '<live_usage_mapping generated_at="2026-04-05T00:00:00Z"' in body
    assert 'active_snapshot="owner-example-com"' in body
    assert 'working_now_count="1"' in body
    assert 'minimal="false"' in body
    assert '<account account_id="acc-1"' in body
    assert 'email="owner@example.com"' in body
    assert 'status="active"' in body
    assert 'expected_snapshot="owner-example-com"' in body
    assert 'mapped_snapshot="owner-example-com"' in body
    assert 'snapshot_candidates="owner-example-com"' in body
    assert 'process_session_count="1"' in body
    assert 'runtime_session_count="4"' in body
    assert 'total_session_count="4"' in body
    assert 'tracked_session_count="2"' in body
    assert 'has_task_preview="true"' in body
    assert 'has_cli_signal="true"' in body
    assert 'snapshot_active="true"' in body
    assert 'working_now="true"' in body
    assert (
        '<snapshot name="orphan-snapshot" process_session_count="3" runtime_session_count="0" total_session_count="3" />'
    ) in body


@pytest.mark.asyncio
async def test_live_usage_mapping_minimal_returns_compact_account_rows():
    from app.db.models import AccountStatus
    from app.modules.accounts.codex_auth_switcher import CodexAuthSnapshotIndex
    from app.modules.health.api import live_usage_mapping

    now = datetime(2026, 4, 5, 0, 0, 0)
    account = SimpleNamespace(
        id="acc-1",
        email="owner@example.com",
        chatgpt_account_id="chatgpt-1",
        status=AccountStatus.ACTIVE,
    )
    repo = AsyncMock()
    repo.list_accounts = AsyncMock(return_value=[account])
    repo.list_codex_session_counts_by_account = AsyncMock(return_value={"acc-1": 2})
    repo.list_codex_current_task_preview_by_account = AsyncMock(
        return_value={"acc-1": "Investigating session routing"},
    )

    with (
        patch("app.modules.health.api.AccountsRepository", return_value=repo),
        patch(
            "app.modules.health.api.build_snapshot_index",
            return_value=CodexAuthSnapshotIndex(
                snapshots_by_account_id={"acc-1": ["owner-example-com"]},
                active_snapshot_name="owner-example-com",
            ),
        ),
        patch(
            "app.modules.health.api.resolve_snapshot_names_for_account",
            return_value=["owner-example-com"],
        ),
        patch(
            "app.modules.health.api.select_snapshot_name",
            return_value="owner-example-com",
        ),
        patch(
            "app.modules.health.api.read_live_codex_process_session_counts_by_snapshot",
            return_value={"owner-example-com": 1},
        ),
        patch(
            "app.modules.health.api.read_runtime_live_session_counts_by_snapshot",
            return_value={"owner-example-com": 4},
        ),
        patch("app.modules.health.api.utcnow", return_value=now),
    ):
        response = await live_usage_mapping(session=AsyncMock(), minimal=True)

    assert response.media_type == "application/xml"
    assert response.headers.get("cache-control") == "no-store"
    body = response.body.decode("utf-8")
    assert '<live_usage_mapping generated_at="2026-04-05T00:00:00Z"' in body
    assert 'minimal="true"' in body
    assert (
        '<account account_id="acc-1" mapped_snapshot="owner-example-com" process_session_count="1" '
        'runtime_session_count="4" total_session_count="4" has_cli_signal="true" working_now="true" />'
    ) in body
    assert 'snapshot_candidates=' not in body
    assert 'expected_snapshot=' not in body


@pytest.mark.asyncio
async def test_health_startup_when_complete():
    from app.modules.health.api import health_startup

    with patch("app.core.startup._startup_complete", True):
        response = await health_startup()
        assert response.status == "ok"


@pytest.mark.asyncio
async def test_health_startup_when_not_complete():
    from fastapi import HTTPException

    from app.modules.health.api import health_startup

    with patch("app.core.startup._startup_complete", False):
        with pytest.raises(HTTPException) as exc_info:
            await health_startup()
        assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_health_ready_db_ok():
    from app.modules.health.api import health_ready

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock()

    with (
        patch("app.core.draining._draining", False),
        patch("app.modules.health.api.get_session") as mock_get_session,
        patch("app.modules.health.api._get_bridge_ring_info", new=AsyncMock(return_value=_bridge_ring_ok())),
    ):

        async def mock_get_session_context():
            yield mock_session

        mock_get_session.return_value = mock_get_session_context()

        response = await health_ready()
        assert response.status == "ok"
        assert response.checks == {"database": "ok"}


@pytest.mark.asyncio
async def test_health_ready_db_error():
    from app.modules.health.api import health_ready

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(side_effect=OperationalError("Connection failed", None, Exception("DB error")))

    with patch("app.modules.health.api.get_session") as mock_get_session:

        async def mock_get_session_context():
            yield mock_session

        mock_get_session.return_value = mock_get_session_context()

        with pytest.raises(HTTPException) as exc_info:
            await health_ready()
        assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_health_ready_draining():
    from app.modules.health.api import health_ready

    with patch("builtins.__import__") as mock_import:
        mock_draining = MagicMock()
        mock_draining._draining = True

        def import_side_effect(name, *args, **kwargs):
            if name == "app.core.draining":
                return mock_draining
            return __import__(name, *args, **kwargs)

        mock_import.side_effect = import_side_effect

        with pytest.raises(HTTPException) as exc_info:
            await health_ready()
        assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_health_ready_ignores_upstream_state():
    from app.core.resilience.degradation import set_degraded
    from app.modules.health.api import health_ready

    set_degraded("upstream circuit breaker is open")

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock()

    with (
        patch("app.core.draining._draining", False),
        patch("app.modules.health.api.get_session") as mock_get_session,
        patch("app.modules.health.api._get_bridge_ring_info", new=AsyncMock(return_value=_bridge_ring_ok())),
    ):

        async def mock_get_session_context():
            yield mock_session

        mock_get_session.return_value = mock_get_session_context()

        response = await health_ready()

    assert response.status == "ok"
    assert response.checks == {"database": "ok"}


@pytest.mark.asyncio
async def test_health_ready_circuit_breaker_disabled_returns_200():
    from types import SimpleNamespace

    from app.modules.health.api import health_ready

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock()

    with (
        patch("app.core.draining._draining", False),
        patch("app.modules.health.api.get_session") as mock_get_session,
        patch("app.modules.health.api._get_bridge_ring_info", new=AsyncMock(return_value=_bridge_ring_ok())),
    ):
        with patch("app.modules.health.api.get_settings", return_value=SimpleNamespace(circuit_breaker_enabled=False)):

            async def mock_get_session_context():
                yield mock_session

            mock_get_session.return_value = mock_get_session_context()

            response = await health_ready()

    assert response.status == "ok"
    assert response.checks == {"database": "ok"}


@pytest.mark.asyncio
async def test_health_ready_fails_when_active_ring_exists_but_instance_is_missing():
    from app.modules.health.api import health_ready
    from app.modules.health.schemas import BridgeRingInfo

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock()

    with (
        patch("app.core.draining._draining", False),
        patch("app.modules.health.api.get_session") as mock_get_session,
        patch("app.modules.health.api.get_settings") as mock_get_settings,
        patch("app.modules.health.api._get_bridge_ring_info", new=AsyncMock()) as mock_bridge_ring,
    ):
        mock_get_settings.return_value = MagicMock(http_responses_session_bridge_enabled=True)
        mock_bridge_ring.return_value = BridgeRingInfo(
            ring_fingerprint="abc",
            ring_size=2,
            instance_id="pod-a",
            is_member=False,
        )

        async def mock_get_session_context():
            yield mock_session

        mock_get_session.return_value = mock_get_session_context()

        with pytest.raises(HTTPException) as exc_info:
            await health_ready()

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "Service is not an active bridge ring member"


@pytest.mark.asyncio
async def test_health_ready_allows_empty_bridge_ring_while_instance_registers():
    from app.modules.health.api import health_ready
    from app.modules.health.schemas import BridgeRingInfo

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock()

    with (
        patch("app.core.draining._draining", False),
        patch("app.modules.health.api.get_session") as mock_get_session,
        patch("app.modules.health.api.get_settings") as mock_get_settings,
        patch("app.modules.health.api._get_bridge_ring_info", new=AsyncMock()) as mock_bridge_ring,
    ):
        mock_get_settings.return_value = MagicMock(http_responses_session_bridge_enabled=True)
        mock_bridge_ring.return_value = BridgeRingInfo(
            ring_fingerprint="abc",
            ring_size=0,
            instance_id="pod-a",
            is_member=False,
        )

        async def mock_get_session_context():
            yield mock_session

        mock_get_session.return_value = mock_get_session_context()

        response = await health_ready()

    assert response.status == "ok"


@pytest.mark.asyncio
async def test_health_ready_fails_when_bridge_ring_lookup_errors():
    from app.modules.health.api import health_ready
    from app.modules.health.schemas import BridgeRingInfo

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock()

    with (
        patch("app.core.draining._draining", False),
        patch("app.modules.health.api.get_session") as mock_get_session,
        patch("app.modules.health.api.get_settings") as mock_get_settings,
        patch("app.modules.health.api._get_bridge_ring_info", new=AsyncMock()) as mock_bridge_ring,
    ):
        mock_get_settings.return_value = MagicMock(http_responses_session_bridge_enabled=True)
        mock_bridge_ring.return_value = BridgeRingInfo(
            ring_fingerprint=None,
            ring_size=0,
            instance_id="pod-a",
            is_member=False,
            error="unavailable: ProgrammingError",
        )

        async def mock_get_session_context():
            yield mock_session

        mock_get_session.return_value = mock_get_session_context()

        with pytest.raises(HTTPException) as exc_info:
            await health_ready()

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "Service bridge ring metadata is unavailable"
