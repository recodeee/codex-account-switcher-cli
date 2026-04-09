from __future__ import annotations

from datetime import datetime, timezone

from app.modules.accounts.schemas import AccountLiveQuotaDebug, AccountLiveQuotaDebugSample
from app.modules.dashboard.service import _should_overlay_live_task_previews


def _debug_with_samples(count: int) -> AccountLiveQuotaDebug:
    return AccountLiveQuotaDebug(
        snapshots_considered=["snap-a"],
        override_applied=False,
        override_reason=None,
        merged=None,
        raw_samples=[
            AccountLiveQuotaDebugSample(
                source=f"/tmp/rollout-{idx}.jsonl",
                snapshot_name="snap-a",
                recorded_at=datetime(2026, 4, 9, tzinfo=timezone.utc),
                stale=False,
                primary=None,
                secondary=None,
            )
            for idx in range(count)
        ],
    )


def test_should_overlay_live_task_previews_returns_false_without_signals() -> None:
    should_overlay = _should_overlay_live_task_previews(
        codex_live_session_counts_by_account={"acc-a": 0},
        codex_tracked_session_counts_by_account={"acc-a": 0},
        codex_current_task_preview_by_account={},
        codex_session_task_previews_by_account={"acc-a": []},
        live_quota_debug_by_account={"acc-a": _debug_with_samples(0)},
    )

    assert should_overlay is False


def test_should_overlay_live_task_previews_returns_true_when_live_session_exists() -> None:
    should_overlay = _should_overlay_live_task_previews(
        codex_live_session_counts_by_account={"acc-a": 1},
        codex_tracked_session_counts_by_account={"acc-a": 0},
        codex_current_task_preview_by_account={},
        codex_session_task_previews_by_account={"acc-a": []},
        live_quota_debug_by_account={"acc-a": _debug_with_samples(0)},
    )

    assert should_overlay is True


def test_should_overlay_live_task_previews_returns_true_when_debug_samples_exist() -> None:
    should_overlay = _should_overlay_live_task_previews(
        codex_live_session_counts_by_account={"acc-a": 0},
        codex_tracked_session_counts_by_account={"acc-a": 0},
        codex_current_task_preview_by_account={},
        codex_session_task_previews_by_account={"acc-a": []},
        live_quota_debug_by_account={"acc-a": _debug_with_samples(1)},
    )

    assert should_overlay is True
