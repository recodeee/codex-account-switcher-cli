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
                mapped_session_pids_by_snapshot={
                    "viktoredixaicom": [100, 101, 102, 103, 104, 105, 106, 107]
                },
                task_preview_by_pid={},
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
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
        '<live_usage generated_at="2026-04-05T00:00:00Z" total_sessions="8" mapped_sessions="8" unattributed_sessions="0" total_task_previews="0" account_task_previews="0" session_task_previews="0">'
        in body
    )
    assert (
        '<snapshot name="viktoredixaicom" session_count="8" session_row_count="8" session_task_preview_count="0">'
        in body
    )
    assert '<session pid="100" state="waiting_for_new_task" />' in body
    assert '<session pid="107" state="waiting_for_new_task" />' in body


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
                mapped_session_pids_by_snapshot={"unique": [401, 402, 403, 404]},
                task_preview_by_pid={
                    401: "Investigate merged telemetry",
                    402: "Investigate merged telemetry",
                    403: "Investigate merged telemetry",
                    404: "Investigate merged telemetry",
                },
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
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
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
        '<live_usage generated_at="2026-04-05T00:00:00Z" total_sessions="4" mapped_sessions="4" unattributed_sessions="0" total_task_previews="4" account_task_previews="1" session_task_previews="4">'
        in body
    )
    assert (
        '<snapshot name="unique" session_count="4" task_preview_count="1" session_row_count="4" session_task_preview_count="4">'
        in body
    )
    assert (
        '<task_preview account_id="acc-1" preview="Investigate merged telemetry" />'
        in body
    )
    assert '<session pid="401" task_preview="Investigate merged telemetry" />' in body
    assert '<session pid="404" task_preview="Investigate merged telemetry" />' in body


@pytest.mark.asyncio
async def test_live_usage_does_not_backfill_session_preview_from_stale_account_preview():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"unique": 2},
                unattributed_session_pids=[],
                mapped_session_pids_by_snapshot={"unique": [501, 502]},
                task_preview_by_pid={},
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(
                return_value={
                    "unique": [
                        SimpleNamespace(
                            account_id="acc-1",
                            preview="Stale persisted account preview",
                        )
                    ]
                }
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
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
        '<live_usage generated_at="2026-04-05T00:00:00Z" total_sessions="2" mapped_sessions="2" unattributed_sessions="0" total_task_previews="0" account_task_previews="0" session_task_previews="0">'
        in body
    )
    assert (
        '<snapshot name="unique" session_count="2" session_row_count="2" session_task_preview_count="0">'
        in body
    )
    assert '<task_preview account_id="acc-1" preview="Stale persisted account preview" />' not in body
    assert '<session pid="501" state="waiting_for_new_task" />' in body
    assert '<session pid="502" state="waiting_for_new_task" />' in body


@pytest.mark.asyncio
async def test_live_usage_orders_snapshots_by_activity_descending():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={
                    "admin@edixai.com": 2,
                    "bia@edixai.com": 3,
                },
                unattributed_session_pids=[],
                mapped_session_pids_by_snapshot={
                    "admin@edixai.com": [1339125, 1395441],
                    "bia@edixai.com": [482487, 1442879, 1445806],
                },
                task_preview_by_pid={},
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(
                return_value={
                    "admin@edixai.com": ["admin@edixai.com"],
                    "bia@edixai.com": ["bia@edixai.com"],
                }
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api.utcnow",
            return_value=datetime(2026, 4, 5, 0, 0, 0),
        ),
    ):
        response = await live_usage()

    body = response.body.decode("utf-8")
    bia_idx = body.index('<snapshot name="bia@edixai.com"')
    admin_idx = body.index('<snapshot name="admin@edixai.com"')
    assert bia_idx < admin_idx


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
                mapped_session_pids_by_snapshot={"thedailyscooby": [601, 602]},
                task_preview_by_pid={
                    602: "Mapped session preview",
                    701: "Unattributed session preview",
                },
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
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
        '<live_usage generated_at="2026-04-05T00:00:00Z" total_sessions="4" mapped_sessions="2" unattributed_sessions="2" total_task_previews="2" account_task_previews="1" session_task_previews="2">'
        in body
    )
    assert (
        '<snapshot name="thedailyscooby" session_count="2" task_preview_count="1" session_row_count="2" session_task_preview_count="1">'
        in body
    )
    assert '<task_preview account_id="session" preview="Mapped session preview" />' in body
    assert '<session pid="601" state="waiting_for_new_task" />' in body
    assert '<session pid="602" task_preview="Mapped session preview" />' in body
    assert '<unattributed_sessions count="2" task_preview_count="1">' in body
    assert '<session pid="701" task_preview="Unattributed session preview" />' in body
    assert '<session pid="702" state="waiting_for_new_task" />' in body


@pytest.mark.asyncio
async def test_live_usage_reattributes_unattributed_session_when_task_preview_matches_single_snapshot():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"new@example.com": 1},
                unattributed_session_pids=[1702],
                mapped_session_pids_by_snapshot={"new@example.com": [1601]},
                task_preview_by_pid={
                    1601: "new account active task",
                    1702: "old account long-running task",
                },
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(
                return_value={
                    "old@example.com": [
                        SimpleNamespace(
                            account_id="acc-old",
                            preview="old account long-running task",
                        )
                    ]
                }
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(
                return_value={
                    "old@example.com": ["old@example.com"],
                    "new@example.com": ["new@example.com"],
                }
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
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
        '<live_usage generated_at="2026-04-05T00:00:00Z" total_sessions="2" mapped_sessions="2" unattributed_sessions="0" total_task_previews="2" account_task_previews="2" session_task_previews="2">'
        in body
    )
    assert (
        '<snapshot name="old@example.com" session_count="1" task_preview_count="1" session_row_count="1" session_task_preview_count="1" account_emails="old@example.com">'
        in body
    )
    assert '<session pid="1702" task_preview="old account long-running task" />' in body
    assert "<unattributed_sessions" not in body


@pytest.mark.asyncio
async def test_live_usage_reattributes_fallback_mapped_session_when_task_preview_matches_single_snapshot():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"old@example.com": 1, "new@example.com": 1},
                unattributed_session_pids=[],
                mapped_session_pids_by_snapshot={
                    "old@example.com": [2601],
                    "new@example.com": [2602],
                },
                fallback_mapped_session_pids_by_snapshot={"old@example.com": [2601]},
                task_preview_by_pid={
                    2601: "new account long-running task",
                },
                task_previews_by_pid={
                    2601: ["new account long-running task"],
                    2602: [],
                },
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(
                return_value={
                    "old@example.com": [
                        SimpleNamespace(
                            account_id="acc-old",
                            preview="old account active task",
                        )
                    ],
                    "new@example.com": [
                        SimpleNamespace(
                            account_id="acc-new",
                            preview="new account long-running task",
                        )
                    ],
                }
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(
                return_value={
                    "old@example.com": ["old@example.com"],
                    "new@example.com": ["new@example.com"],
                }
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
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
        '<live_usage generated_at="2026-04-05T00:00:00Z" total_sessions="2" mapped_sessions="2" unattributed_sessions="0" total_task_previews="2" account_task_previews="2" session_task_previews="1">'
        in body
    )
    assert (
        '<snapshot name="new@example.com" session_count="2" task_preview_count="1" session_row_count="2" session_task_preview_count="1" account_emails="new@example.com">'
        in body
    )
    assert '<session pid="2601" task_preview="new account long-running task" />' in body
    assert '<session pid="2602" state="waiting_for_new_task" />' in body
    assert (
        '<snapshot name="old@example.com" session_count="0" task_preview_count="1" session_row_count="0" session_task_preview_count="0" account_emails="old@example.com">'
        in body
    )
    assert '<task_preview account_id="acc-old" preview="old account active task" />' in body


@pytest.mark.asyncio
async def test_live_usage_keeps_unattributed_session_when_task_preview_matches_multiple_snapshots():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"new@example.com": 1},
                unattributed_session_pids=[1802],
                mapped_session_pids_by_snapshot={"new@example.com": [1801]},
                task_preview_by_pid={
                    1801: "new account active task",
                    1802: "shared preview text",
                },
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(
                return_value={
                    "old@example.com": [
                        SimpleNamespace(
                            account_id="acc-old",
                            preview="shared preview text",
                        )
                    ],
                    "another@example.com": [
                        SimpleNamespace(
                            account_id="acc-another",
                            preview="shared preview text",
                        )
                    ],
                }
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
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
        '<live_usage generated_at="2026-04-05T00:00:00Z" total_sessions="2" mapped_sessions="1" unattributed_sessions="1" total_task_previews="3" account_task_previews="3" session_task_previews="2">'
        in body
    )
    assert '<session pid="1802" task_preview="shared preview text" />' in body
    assert '<unattributed_sessions count="1" task_preview_count="1">' in body


@pytest.mark.asyncio
async def test_live_usage_lists_multiple_tasks_per_session_and_waiting_state():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"koronanagyviktorcom": 2},
                unattributed_session_pids=[],
                mapped_session_pids_by_snapshot={"koronanagyviktorcom": [1325536, 1329526]},
                task_preview_by_pid={1325536: "latest task"},
                task_previews_by_pid={
                    1325536: [
                        "latest task",
                        "previous task still active",
                    ]
                },
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
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
        '<snapshot name="koronanagyviktorcom" session_count="2" task_preview_count="2" session_row_count="2" session_task_preview_count="2">'
        in body
    )
    assert '<task_preview account_id="session" preview="latest task" />' in body
    assert '<task_preview account_id="session" preview="previous task still active" />' in body
    assert '<session pid="1325536" task_preview="latest task" task_count="2">' in body
    assert '<task preview="latest task" />' in body
    assert '<task preview="previous task still active" />' in body
    assert '<session pid="1329526" state="waiting_for_new_task" />' in body


@pytest.mark.asyncio
async def test_live_usage_waiting_session_can_include_last_task_preview():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import _LiveUsageTaskPreview, live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"zeus": 1},
                unattributed_session_pids=[],
                mapped_session_pids_by_snapshot={"zeus": [41001]},
                task_preview_by_pid={},
                task_previews_by_pid={},
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(
                return_value={
                    "zeus": [
                        _LiveUsageTaskPreview(
                            account_id="acc-zeus",
                            preview="Investigate Zeus quota overlay mapping",
                        )
                    ]
                }
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
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
        '<session pid="41001" state="waiting_for_new_task"'
        ' last_task_preview="Investigate Zeus quota overlay mapping" />'
    ) in body


@pytest.mark.asyncio
async def test_live_usage_remaps_alias_snapshot_counts_to_selected_snapshot():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"koronanagyviktorcom": 2},
                unattributed_session_pids=[],
                mapped_session_pids_by_snapshot={"koronanagyviktorcom": [1325536, 1329526]},
                task_preview_by_pid={},
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(return_value={"korona@nagyviktor.com": ["korona@nagyviktor.com"]}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
            new=AsyncMock(return_value={"koronanagyviktorcom": "korona@nagyviktor.com"}),
        ),
        patch(
            "app.modules.health.api.utcnow",
            return_value=datetime(2026, 4, 5, 0, 0, 0),
        ),
    ):
        response = await live_usage()

    body = response.body.decode("utf-8")
    assert (
        '<snapshot name="korona@nagyviktor.com" session_count="2" session_row_count="2" session_task_preview_count="0" account_emails="korona@nagyviktor.com">'
        in body
    )
    assert '<snapshot name="koronanagyviktorcom"' not in body


@pytest.mark.asyncio
async def test_live_usage_remaps_alias_snapshot_account_emails_to_selected_snapshot():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"legacy-alias": 2},
                unattributed_session_pids=[],
                mapped_session_pids_by_snapshot={"legacy-alias": [3201, 3202]},
                task_preview_by_pid={},
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(return_value={"legacy-alias": ["itrexsale@gmail.com"]}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
            new=AsyncMock(return_value={"legacy-alias": "itrexsale@gmail.com"}),
        ),
        patch(
            "app.modules.health.api.utcnow",
            return_value=datetime(2026, 4, 5, 0, 0, 0),
        ),
    ):
        response = await live_usage()

    body = response.body.decode("utf-8")
    assert (
        '<snapshot name="itrexsale@gmail.com" session_count="2" session_row_count="2" session_task_preview_count="0" account_emails="itrexsale@gmail.com">'
        in body
    )
    assert '<snapshot name="legacy-alias"' not in body


@pytest.mark.asyncio
async def test_live_usage_ignores_live_usage_xml_payload_as_session_task_preview():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"itrexsale@gmail.com": 1},
                unattributed_session_pids=[],
                mapped_session_pids_by_snapshot={"itrexsale@gmail.com": [901]},
                task_preview_by_pid={
                    901: '<live_usage generated_at="2026-04-05T08:05:39.199074Z" total_sessions="2" mapped_sessions="2" unattributed_sessions="0">'
                },
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(return_value={"itrexsale@gmail.com": ["itrexsale@gmail.com"]}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
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
        '<snapshot name="itrexsale@gmail.com" session_count="1" session_row_count="1" session_task_preview_count="0" account_emails="itrexsale@gmail.com">'
        in body
    )
    assert '<session pid="901" state="waiting_for_new_task" />' in body
    assert 'task_preview="&lt;live_usage generated_at=' not in body


@pytest.mark.asyncio
async def test_live_usage_extracts_task_after_live_usage_xml_prefix():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"itrexsale@gmail.com": 1},
                unattributed_session_pids=[],
                mapped_session_pids_by_snapshot={"itrexsale@gmail.com": [902]},
                task_preview_by_pid={
                    902: (
                        '<live_usage generated_at="2026-04-05T08:05:39.199074Z" '
                        'total_sessions="2" mapped_sessions="2" '
                        'unattributed_sessions="0"></live_usage> '
                        "both are waiting for tasks when we set tasks for the session so improve this"
                    )
                },
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(return_value={"itrexsale@gmail.com": ["itrexsale@gmail.com"]}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api.utcnow",
            return_value=datetime(2026, 4, 5, 0, 0, 0),
        ),
    ):
        response = await live_usage()

    body = response.body.decode("utf-8")
    assert '<snapshot name="itrexsale@gmail.com" session_count="1"' in body
    assert 'session_row_count="1"' in body
    assert 'session_task_preview_count="1"' in body
    assert 'account_emails="itrexsale@gmail.com"' in body
    assert (
        'task_preview="both are waiting for tasks when we set tasks for the session so improve this"'
        in body
    )
    assert '<session pid="902" state="waiting_for_new_task" />' not in body


@pytest.mark.asyncio
async def test_live_usage_strips_trailing_live_usage_xml_from_session_task_preview():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"viktor@edixai.com": 1},
                unattributed_session_pids=[],
                mapped_session_pids_by_snapshot={"viktor@edixai.com": [408006]},
                task_preview_by_pid={
                    408006: (
                        "task should map per session in dashboard card "
                        '<live_usage generated_at="2026-04-05T09:51:36.510585Z" total_sessions="3"></live_usage>'
                    )
                },
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(return_value={"viktor@edixai.com": ["viktor@edixai.com"]}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api.utcnow",
            return_value=datetime(2026, 4, 5, 0, 0, 0),
        ),
    ):
        response = await live_usage()

    body = response.body.decode("utf-8")
    assert 'task_preview="task should map per session in dashboard card"' in body
    assert "&lt;live_usage generated_at=" not in body


@pytest.mark.asyncio
async def test_live_usage_extracts_user_request_from_omx_explore_task_preview():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"viktor@edixai.com": 1},
                unattributed_session_pids=[],
                mapped_session_pids_by_snapshot={"viktor@edixai.com": [408006]},
                task_preview_by_pid={
                    408006: (
                        "You are OMX Explore, a low-cost read-only repository exploration harness.\n"
                        "Operate strictly in read-only mode.\n"
                        "User request:\n"
                        "hide the snapshot name too because that is email"
                    )
                },
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(return_value={"viktor@edixai.com": ["viktor@edixai.com"]}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
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
        '<session pid="408006" task_preview="hide the snapshot name too because that is email" />'
        in body
    )
    assert "You are OMX Explore" not in body


@pytest.mark.asyncio
async def test_live_usage_includes_account_emails_mapped_to_snapshot():
    from app.modules.accounts.codex_live_usage import LocalCodexProcessSessionAttribution
    from app.modules.health.api import live_usage

    with (
        patch(
            "app.modules.health.api.read_live_codex_process_session_attribution",
            return_value=LocalCodexProcessSessionAttribution(
                counts_by_snapshot={"unique": 1},
                unattributed_session_pids=[],
                mapped_session_pids_by_snapshot={},
                task_preview_by_pid={},
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_task_previews_by_snapshot",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "app.modules.health.api._read_live_usage_account_emails_by_snapshot",
            new=AsyncMock(
                return_value={"unique": ["nagy.viktordp@gmail.com", "tokio@edixai.com"]}
            ),
        ),
        patch(
            "app.modules.health.api._read_live_usage_snapshot_alias_map",
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
        '<snapshot name="unique" session_count="1" account_emails="nagy.viktordp@gmail.com,tokio@edixai.com" />'
        in body
    )


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
async def test_read_live_usage_snapshot_alias_map_uses_canonical_snapshot_candidates():
    from app.modules.accounts.codex_auth_switcher import CodexAuthSnapshotIndex
    from app.modules.health.api import _read_live_usage_snapshot_alias_map

    account_a = SimpleNamespace(
        id="legacy-a",
        chatgpt_account_id="chatgpt-a",
        email="a@example.com",
    )
    account_b = SimpleNamespace(
        id="legacy-b",
        chatgpt_account_id="chatgpt-b",
        email="b@example.com",
    )

    repo = AsyncMock()
    repo.list_accounts = AsyncMock(return_value=[account_a, account_b])

    async def _fake_session():
        yield AsyncMock()

    def _resolve_candidates(*, account_id: str, **_kwargs):
        if account_id == "legacy-a":
            return ["a-main", "a-legacy-alias"]
        if account_id == "legacy-b":
            return ["b-main"]
        return []

    with (
        patch("app.modules.health.api.AccountsRepository", return_value=repo),
        patch("app.modules.health.api.get_session", return_value=_fake_session()),
        patch(
            "app.modules.health.api.build_snapshot_index",
            return_value=CodexAuthSnapshotIndex(
                snapshots_by_account_id={},
                active_snapshot_name="a-main",
            ),
        ),
        patch(
            "app.modules.health.api.resolve_snapshot_name_candidates_for_account",
            side_effect=_resolve_candidates,
        ),
        patch(
            "app.modules.health.api.select_snapshot_name",
            side_effect=lambda snapshot_candidates, *_args, **_kwargs: snapshot_candidates[0]
            if snapshot_candidates
            else None,
        ),
    ):
        alias_map = await _read_live_usage_snapshot_alias_map()

    assert alias_map == {
        "a-main": "a-main",
        "a-legacy-alias": "a-main",
        "b-main": "b-main",
    }


@pytest.mark.asyncio
async def test_read_live_usage_snapshot_alias_map_drops_ambiguous_alias_conflicts():
    from app.modules.accounts.codex_auth_switcher import CodexAuthSnapshotIndex
    from app.modules.health.api import _read_live_usage_snapshot_alias_map

    account_a = SimpleNamespace(
        id="legacy-a",
        chatgpt_account_id="chatgpt-shared",
        email="a@example.com",
    )
    account_b = SimpleNamespace(
        id="legacy-b",
        chatgpt_account_id="chatgpt-shared",
        email="b@example.com",
    )

    repo = AsyncMock()
    repo.list_accounts = AsyncMock(return_value=[account_a, account_b])

    async def _fake_session():
        yield AsyncMock()

    def _resolve_candidates(*, account_id: str, **_kwargs):
        if account_id == "legacy-a":
            return ["shared-alias", "a-main"]
        if account_id == "legacy-b":
            return ["shared-alias", "b-main"]
        return []

    def _select_snapshot(snapshot_candidates: list[str], *_args, email: str, **_kwargs):
        if email == "a@example.com":
            return "a-main"
        if email == "b@example.com":
            return "b-main"
        return snapshot_candidates[0] if snapshot_candidates else None

    with (
        patch("app.modules.health.api.AccountsRepository", return_value=repo),
        patch("app.modules.health.api.get_session", return_value=_fake_session()),
        patch(
            "app.modules.health.api.build_snapshot_index",
            return_value=CodexAuthSnapshotIndex(
                snapshots_by_account_id={},
                active_snapshot_name=None,
            ),
        ),
        patch(
            "app.modules.health.api.resolve_snapshot_name_candidates_for_account",
            side_effect=_resolve_candidates,
        ),
        patch(
            "app.modules.health.api.select_snapshot_name",
            side_effect=_select_snapshot,
        ),
    ):
        alias_map = await _read_live_usage_snapshot_alias_map()

    assert alias_map == {
        "a-main": "a-main",
        "b-main": "b-main",
    }
    assert "shared-alias" not in alias_map


@pytest.mark.asyncio
async def test_read_live_usage_snapshot_alias_map_does_not_claim_another_accounts_email_snapshot():
    from app.modules.accounts.codex_auth_switcher import CodexAuthSnapshotIndex
    from app.modules.health.api import _read_live_usage_snapshot_alias_map

    grepolis = SimpleNamespace(
        id="acc-grepolis",
        chatgpt_account_id="chatgpt-megkapja",
        email="grepolis@megkapja.hu",
    )
    odin = SimpleNamespace(
        id="acc-odin",
        chatgpt_account_id="chatgpt-megkapja",
        email="odin@megkapja.hu",
    )

    repo = AsyncMock()
    repo.list_accounts = AsyncMock(return_value=[grepolis, odin])

    async def _fake_session():
        yield AsyncMock()

    def _resolve_candidates(*, account_id: str, **_kwargs):
        if account_id == "acc-grepolis":
            return ["grepolis@megkapja.hu", "odin@megkapja.hu"]
        if account_id == "acc-odin":
            return []
        return []

    with (
        patch("app.modules.health.api.AccountsRepository", return_value=repo),
        patch("app.modules.health.api.get_session", return_value=_fake_session()),
        patch(
            "app.modules.health.api.build_snapshot_index",
            return_value=CodexAuthSnapshotIndex(
                snapshots_by_account_id={},
                active_snapshot_name="grepolis@megkapja.hu",
            ),
        ),
        patch(
            "app.modules.health.api.resolve_snapshot_name_candidates_for_account",
            side_effect=_resolve_candidates,
        ),
        patch(
            "app.modules.health.api.select_snapshot_name",
            side_effect=lambda snapshot_candidates, *_args, **_kwargs: snapshot_candidates[0]
            if snapshot_candidates
            else None,
        ),
    ):
        alias_map = await _read_live_usage_snapshot_alias_map()

    assert alias_map == {"grepolis@megkapja.hu": "grepolis@megkapja.hu"}
    assert "odin@megkapja.hu" not in alias_map


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
    assert 'expected_snapshot="owner@example.com"' in body
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
async def test_live_usage_mapping_uses_expected_email_snapshot_when_live_snapshot_is_unindexed():
    from app.db.models import AccountStatus
    from app.modules.accounts.codex_auth_switcher import CodexAuthSnapshotIndex
    from app.modules.health.api import live_usage_mapping

    now = datetime(2026, 4, 8, 0, 0, 0)
    account = SimpleNamespace(
        id="acc-odin",
        email="odin@megkapja.hu",
        chatgpt_account_id="chatgpt-odin",
        status=AccountStatus.ACTIVE,
    )
    repo = AsyncMock()
    repo.list_accounts = AsyncMock(return_value=[account])
    repo.list_codex_session_counts_by_account = AsyncMock(return_value={"acc-odin": 0})
    repo.list_codex_current_task_preview_by_account = AsyncMock(return_value={})

    with (
        patch("app.modules.health.api.AccountsRepository", return_value=repo),
        patch(
            "app.modules.health.api.build_snapshot_index",
            return_value=CodexAuthSnapshotIndex(
                snapshots_by_account_id={},
                active_snapshot_name="grepolis@megkapja.hu",
            ),
        ),
        patch(
            "app.modules.health.api.resolve_snapshot_names_for_account",
            return_value=[],
        ),
        patch(
            "app.modules.health.api.read_live_codex_process_session_counts_by_snapshot",
            return_value={"odin@megkapja.hu": 2, "grepolis@megkapja.hu": 1},
        ),
        patch(
            "app.modules.health.api.read_runtime_live_session_counts_by_snapshot",
            return_value={},
        ),
        patch("app.modules.health.api.utcnow", return_value=now),
    ):
        response = await live_usage_mapping(session=AsyncMock())

    body = response.body.decode("utf-8")
    assert 'mapped_snapshot="odin@megkapja.hu"' in body
    assert 'process_session_count="2"' in body
    assert 'working_now="true"' in body
    assert '<snapshot name="odin@megkapja.hu"' not in body


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
async def test_live_usage_mapping_ignores_warning_and_done_task_preview_for_cli_signal():
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
    repo.list_codex_session_counts_by_account = AsyncMock(return_value={"acc-1": 0})
    repo.list_codex_current_task_preview_by_account = AsyncMock(
        return_value={"acc-1": "Warning: apply_patch was requested via exec_command."},
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
            return_value={"owner-example-com": 0},
        ),
        patch(
            "app.modules.health.api.read_runtime_live_session_counts_by_snapshot",
            return_value={"owner-example-com": 0},
        ),
        patch("app.modules.health.api.utcnow", return_value=now),
    ):
        response = await live_usage_mapping(session=AsyncMock())

    body = response.body.decode("utf-8")
    assert 'working_now_count="0"' in body
    assert 'has_task_preview="false"' in body
    assert 'has_cli_signal="false"' in body
    assert 'working_now="false"' in body


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
