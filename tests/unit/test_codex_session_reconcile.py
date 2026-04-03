from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.tools import codex_session_reconcile as reconcile

pytestmark = pytest.mark.unit


def test_parse_rollout_filename_extracts_session_id_and_start_ts(tmp_path: Path) -> None:
    file_path = tmp_path / "rollout-2026-04-03T16-22-44-019d53b9-933b-7a43-8d61-66df9bfc1253.jsonl"
    file_path.write_text("\n", encoding="utf-8")

    parsed = reconcile._parse_rollout_filename(file_path)

    assert parsed is not None
    session_id, start_ts = parsed
    assert session_id == "019d53b9-933b-7a43-8d61-66df9bfc1253"
    assert start_ts > 0


def test_extract_latest_fingerprint_uses_latest_token_count_line(tmp_path: Path) -> None:
    file_path = tmp_path / "rollout-2026-04-03T16-22-44-019d53b9-933b-7a43-8d61-66df9bfc1253.jsonl"
    rows = [
        {
            "payload": {
                "type": "token_count",
                "rate_limits": {
                    "primary": {"resets_at": 111},
                    "secondary": {"resets_at": 222},
                    "plan_type": "team",
                },
            }
        },
        {
            "payload": {
                "type": "token_count",
                "rate_limits": {
                    "primary": {"resets_at": 333},
                    "secondary": {"resets_at": 444},
                    "plan_type": "business",
                },
            }
        },
    ]
    file_path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")

    fingerprint = reconcile._extract_latest_fingerprint(file_path)

    assert fingerprint == reconcile.SessionFingerprint(
        primary_reset_at=333,
        secondary_reset_at=444,
        plan_type="business",
    )


def test_match_rollout_for_process_returns_ambiguous_when_candidates_are_too_close() -> None:
    process = reconcile.RunningProcess(pid=100, cmd="codex", start_ts=1_000.0, cwd=Path("/tmp"))
    rollouts = [
        reconcile.RolloutSession("keep-a", Path("a"), 1_004.0, None),
        reconcile.RolloutSession("keep-b", Path("b"), 1_010.0, None),
    ]

    state, matched = reconcile._match_rollout_for_process(
        process,
        rollouts,
        max_skew_seconds=60,
        ambiguity_window_seconds=10,
    )

    assert state == "ambiguous"
    assert matched is None


def test_build_decisions_marks_only_mismatched_sessions_for_restart(monkeypatch: pytest.MonkeyPatch) -> None:
    keep_fingerprint = reconcile.SessionFingerprint(111, 222, "team")
    mismatch_fingerprint = reconcile.SessionFingerprint(999, 222, "team")

    rollouts = [
        reconcile.RolloutSession("keep-session", Path("keep"), 1_000.0, keep_fingerprint),
        reconcile.RolloutSession("match-session", Path("match"), 1_050.0, keep_fingerprint),
        reconcile.RolloutSession("restart-session", Path("restart"), 1_100.0, mismatch_fingerprint),
    ]

    processes = [
        reconcile.RunningProcess(pid=10, cmd="codex", start_ts=1_000.0, cwd=Path("/repo")),
        reconcile.RunningProcess(pid=11, cmd="codex", start_ts=1_050.0, cwd=Path("/repo/sub")),
        reconcile.RunningProcess(pid=12, cmd="codex", start_ts=1_100.0, cwd=Path("/repo")),
        reconcile.RunningProcess(pid=13, cmd="codex", start_ts=2_000.0, cwd=Path("/other")),
    ]

    monkeypatch.setattr(reconcile.os, "getpid", lambda: 99999)
    monkeypatch.setattr(reconcile.os, "getppid", lambda: 88888)

    decisions, fingerprint = reconcile._build_decisions(
        processes,
        rollouts,
        keep_session_id="keep-session",
        scope="repo",
        repo_root=Path("/repo"),
    )

    by_pid = {process.pid: process for process in decisions}
    assert fingerprint == keep_fingerprint
    assert by_pid[10].decision == "keep"
    assert by_pid[11].decision == "match"
    assert by_pid[12].decision == "restart"
    assert by_pid[13].decision == "skipped_out_of_scope"


def test_restart_process_escalates_to_sigkill_when_needed(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[tuple[int, object]] = []
    monkeypatch.setattr(reconcile, "_send_signal", lambda pid, sig: sent.append((pid, sig)))

    monotonic_values = iter([0.0, 2.0])
    monkeypatch.setattr(reconcile.time, "monotonic", lambda: next(monotonic_values))
    monkeypatch.setattr(reconcile.time, "sleep", lambda _seconds: None)

    state = iter([True, False])
    monkeypatch.setattr(reconcile, "_is_pid_alive", lambda _pid: next(state))

    terminated, forced = reconcile._restart_process(42, grace_seconds=1)

    assert terminated is True
    assert forced is True
    assert len(sent) == 2
    assert sent[0][0] == 42
    assert sent[1][0] == 42
