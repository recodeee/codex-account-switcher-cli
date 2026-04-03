from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.modules.accounts.codex_live_usage import (
    read_local_codex_live_usage,
    read_local_codex_live_usage_by_snapshot,
)


def _sessions_day_dir(root: Path, now: datetime) -> Path:
    day = now.date()
    path = root / f"{day.year:04d}" / f"{day.month:02d}" / f"{day.day:02d}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_rollout(
    path: Path,
    *,
    timestamp: datetime,
    primary_used: float,
    secondary_used: float,
) -> None:
    payload = {
        "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "rate_limits": {
                "primary": {
                    "used_percent": primary_used,
                    "window_minutes": 300,
                    "resets_at": int((timestamp + timedelta(minutes=30)).timestamp()),
                },
                "secondary": {
                    "used_percent": secondary_used,
                    "window_minutes": 10080,
                    "resets_at": int((timestamp + timedelta(days=7)).timestamp()),
                },
            },
        },
    }
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    ts = timestamp.timestamp()
    os.utime(path, (ts, ts))


def _write_rollout_without_usage(path: Path, *, timestamp: datetime) -> None:
    payload = {
        "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
        "type": "event_msg",
        "payload": {
            "type": "task_started",
        },
    }
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    ts = timestamp.timestamp()
    os.utime(path, (ts, ts))


def test_read_local_codex_live_usage_uses_latest_rate_limit_and_counts_active_sessions(
    monkeypatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))

    day_dir = _sessions_day_dir(sessions_root, now)
    older = day_dir / "rollout-older.jsonl"
    latest = day_dir / "rollout-latest.jsonl"
    _write_rollout(
        older,
        timestamp=now - timedelta(minutes=5),
        primary_used=66.0,
        secondary_used=44.0,
    )
    _write_rollout(
        latest,
        timestamp=now - timedelta(minutes=1),
        primary_used=12.0,
        secondary_used=34.0,
    )

    usage = read_local_codex_live_usage(now=now)
    assert usage is not None
    assert usage.active_session_count == 2
    assert usage.primary is not None
    assert usage.secondary is not None
    assert usage.primary.used_percent == 12.0
    assert usage.secondary.used_percent == 34.0


def test_read_local_codex_live_usage_ignores_stale_rollout_files(monkeypatch, tmp_path: Path) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "60")

    day_dir = _sessions_day_dir(sessions_root, now - timedelta(hours=2))
    stale = day_dir / "rollout-stale.jsonl"
    _write_rollout(
        stale,
        timestamp=now - timedelta(hours=2),
        primary_used=77.0,
        secondary_used=55.0,
    )

    usage = read_local_codex_live_usage(now=now)
    assert usage is None


def test_read_local_codex_live_usage_prefers_newest_session_file_over_older_active_session(
    monkeypatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))

    day_dir = _sessions_day_dir(sessions_root, now)
    # Older session file still emits fresh token_count events (stale account).
    older_active = day_dir / "rollout-2026-04-03T16-13-25-older-session.jsonl"
    _write_rollout(
        older_active,
        timestamp=now - timedelta(seconds=10),
        primary_used=88.0,
        secondary_used=23.0,
    )

    # Newest session file corresponds to the currently selected account.
    newest_active = day_dir / "rollout-2026-04-03T16-22-44-newest-session.jsonl"
    _write_rollout(
        newest_active,
        timestamp=now - timedelta(seconds=20),
        primary_used=0.0,
        secondary_used=0.0,
    )

    usage = read_local_codex_live_usage(now=now)
    assert usage is not None
    assert usage.active_session_count == 2
    assert usage.primary is not None
    assert usage.secondary is not None
    assert usage.primary.used_percent == 0.0
    assert usage.secondary.used_percent == 0.0


def test_read_local_codex_live_usage_falls_back_to_recent_known_usage_before_first_token_count(
    monkeypatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "120")

    day_dir = _sessions_day_dir(sessions_root, now)
    recent_known = day_dir / "rollout-recent-known.jsonl"
    new_active_without_usage = day_dir / "rollout-new-active.jsonl"
    _write_rollout(
        recent_known,
        timestamp=now - timedelta(minutes=8),
        primary_used=45.0,
        secondary_used=62.0,
    )
    _write_rollout_without_usage(
        new_active_without_usage,
        timestamp=now - timedelta(seconds=20),
    )

    usage = read_local_codex_live_usage(now=now)
    assert usage is not None
    assert usage.active_session_count == 1
    assert usage.primary is not None
    assert usage.secondary is not None
    assert usage.primary.used_percent == 45.0
    assert usage.secondary.used_percent == 62.0


def test_read_local_codex_live_usage_reports_live_session_even_without_rate_limits(
    monkeypatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "120")

    day_dir = _sessions_day_dir(sessions_root, now)
    new_active_without_usage = day_dir / "rollout-new-active.jsonl"
    _write_rollout_without_usage(
        new_active_without_usage,
        timestamp=now - timedelta(seconds=10),
    )

    usage = read_local_codex_live_usage(now=now)
    assert usage is not None
    assert usage.active_session_count == 1
    assert usage.primary is None
    assert usage.secondary is None


def test_read_local_codex_live_usage_by_snapshot_reads_multiple_runtime_profiles(
    monkeypatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    runtime_root = tmp_path / "runtimes"
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    work_runtime = runtime_root / "terminal-work"
    work_runtime.mkdir(parents=True, exist_ok=True)
    (work_runtime / "current").write_text("work", encoding="utf-8")
    work_day_dir = _sessions_day_dir(work_runtime / "sessions", now)
    _write_rollout(
        work_day_dir / "rollout-work.jsonl",
        timestamp=now - timedelta(minutes=2),
        primary_used=10.0,
        secondary_used=20.0,
    )

    personal_runtime = runtime_root / "terminal-personal"
    personal_runtime.mkdir(parents=True, exist_ok=True)
    (personal_runtime / "current").write_text("personal", encoding="utf-8")
    personal_day_dir = _sessions_day_dir(personal_runtime / "sessions", now)
    _write_rollout(
        personal_day_dir / "rollout-personal.jsonl",
        timestamp=now - timedelta(minutes=1),
        primary_used=30.0,
        secondary_used=40.0,
    )

    usage_by_snapshot = read_local_codex_live_usage_by_snapshot(now=now)

    assert set(usage_by_snapshot.keys()) == {"work", "personal"}
    assert usage_by_snapshot["work"].active_session_count == 1
    assert usage_by_snapshot["work"].primary is not None
    assert usage_by_snapshot["work"].primary.used_percent == 10.0
    assert usage_by_snapshot["personal"].active_session_count == 1
    assert usage_by_snapshot["personal"].secondary is not None
    assert usage_by_snapshot["personal"].secondary.used_percent == 40.0


def test_read_local_codex_live_usage_by_snapshot_merges_same_snapshot_across_runtimes(
    monkeypatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    runtime_root = tmp_path / "runtimes"
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    runtime_a = runtime_root / "terminal-a"
    runtime_a.mkdir(parents=True, exist_ok=True)
    (runtime_a / "current").write_text("work", encoding="utf-8")
    day_dir_a = _sessions_day_dir(runtime_a / "sessions", now)
    _write_rollout(
        day_dir_a / "rollout-a.jsonl",
        timestamp=now - timedelta(minutes=3),
        primary_used=11.0,
        secondary_used=22.0,
    )

    runtime_b = runtime_root / "terminal-b"
    runtime_b.mkdir(parents=True, exist_ok=True)
    (runtime_b / "current").write_text("work", encoding="utf-8")
    day_dir_b = _sessions_day_dir(runtime_b / "sessions", now)
    _write_rollout(
        day_dir_b / "rollout-b.jsonl",
        timestamp=now - timedelta(minutes=1),
        primary_used=33.0,
        secondary_used=44.0,
    )

    usage_by_snapshot = read_local_codex_live_usage_by_snapshot(now=now)

    assert set(usage_by_snapshot.keys()) == {"work"}
    merged = usage_by_snapshot["work"]
    assert merged.active_session_count == 2
    assert merged.primary is not None
    assert merged.secondary is not None
    assert merged.primary.used_percent == 33.0
    assert merged.secondary.used_percent == 44.0
