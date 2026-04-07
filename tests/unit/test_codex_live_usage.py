from __future__ import annotations

import base64
import json
import os
import signal
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

import app.modules.accounts.codex_live_usage as codex_live_usage_module
from app.modules.accounts.codex_live_usage import (
    has_recent_active_snapshot_process_fallback,
    read_live_codex_process_session_attribution,
    read_live_codex_process_session_counts_by_snapshot,
    read_local_codex_live_usage,
    read_local_codex_live_usage_by_snapshot,
    read_local_codex_live_usage_samples,
    read_local_codex_live_usage_samples_by_snapshot,
    read_local_codex_task_previews_by_session_id,
    read_local_codex_task_previews_by_snapshot,
    read_runtime_live_session_counts_by_snapshot,
    terminate_live_codex_processes_for_snapshot,
)


@pytest.fixture(autouse=True)
def _reset_unlabeled_process_owner_cache() -> None:
    codex_live_usage_module._unlabeled_default_scope_process_owner_cache.clear()
    codex_live_usage_module._unlabeled_default_scope_session_owner_cache.clear()
    yield
    codex_live_usage_module._unlabeled_default_scope_process_owner_cache.clear()
    codex_live_usage_module._unlabeled_default_scope_session_owner_cache.clear()


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


def _write_rollout_with_user_task(path: Path, *, timestamp: datetime, task: str) -> None:
    payload = {
        "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": task}],
        },
    }
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    ts = timestamp.timestamp()
    os.utime(path, (ts, ts))


def _encode_jwt(payload: dict[str, object]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    body = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
    return f"header.{body}.sig"


def _write_auth_json(path: Path, *, email: str, account_id: str, access_token: str = "access") -> None:
    payload = {"email": email}
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": access_token,
            "refreshToken": "refresh",
            "accountId": account_id,
        },
    }
    path.write_text(json.dumps(auth_json), encoding="utf-8")


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


def test_read_local_codex_live_usage_recovers_rate_limit_outside_tail_window(
    monkeypatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "600")

    day_dir = _sessions_day_dir(sessions_root, now)
    noisy_rollout = day_dir / "rollout-noisy.jsonl"

    first_snapshot_ts = now - timedelta(minutes=2)
    first_payload = {
        "timestamp": first_snapshot_ts.isoformat().replace("+00:00", "Z"),
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "rate_limits": {
                "primary": {
                    "used_percent": 36.0,
                    "window_minutes": 300,
                    "resets_at": int((first_snapshot_ts + timedelta(minutes=30)).timestamp()),
                },
                "secondary": {
                    "used_percent": 4.0,
                    "window_minutes": 10_080,
                    "resets_at": int((first_snapshot_ts + timedelta(days=7)).timestamp()),
                },
            },
        },
    }
    noisy_lines = [json.dumps(first_payload)]
    for index in range(450):
        noisy_lines.append(
            json.dumps(
                {
                    "timestamp": (now - timedelta(seconds=index)).isoformat().replace("+00:00", "Z"),
                    "type": "event_msg",
                    "payload": {"type": "task_progress", "step": index},
                }
            )
        )
    noisy_rollout.write_text("\n".join(noisy_lines) + "\n", encoding="utf-8")
    ts = (now - timedelta(seconds=5)).timestamp()
    os.utime(noisy_rollout, (ts, ts))

    usage = read_local_codex_live_usage(now=now)
    assert usage is not None
    assert usage.active_session_count == 1
    assert usage.primary is not None
    assert usage.secondary is not None
    assert usage.primary.used_percent == pytest.approx(36.0)
    assert usage.secondary.used_percent == pytest.approx(4.0)


def test_read_local_codex_live_usage_samples_drops_stale_token_count_fingerprints(
    monkeypatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "120")

    day_dir = _sessions_day_dir(sessions_root, now)
    stale_usage = day_dir / "rollout-stale-usage.jsonl"
    _write_rollout(
        stale_usage,
        timestamp=now - timedelta(minutes=10),
        primary_used=97.0,
        secondary_used=75.0,
    )
    # Simulate non-token activity touching the file recently.
    fresh_mtime = (now - timedelta(seconds=15)).timestamp()
    os.utime(stale_usage, (fresh_mtime, fresh_mtime))

    samples = read_local_codex_live_usage_samples(now=now)
    assert len(samples) == 1
    assert samples[0].active_session_count == 1
    assert samples[0].primary is None
    assert samples[0].secondary is None


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
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="work"),
    )

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


def test_read_local_codex_live_usage_by_snapshot_default_scope_prefers_newest_sample_within_cycle(
    monkeypatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    runtime_root = tmp_path / "runtimes"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="viktor"),
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [],
    )

    day_dir = _sessions_day_dir(sessions_root, now)
    _write_rollout(
        day_dir / "rollout-2026-04-03T16-13-25-older-session.jsonl",
        timestamp=now - timedelta(seconds=12),
        primary_used=95.0,
        secondary_used=37.0,
    )
    _write_rollout(
        day_dir / "rollout-2026-04-03T16-22-44-newer-session.jsonl",
        timestamp=now - timedelta(seconds=6),
        primary_used=76.0,
        secondary_used=34.0,
    )

    usage_by_snapshot = read_local_codex_live_usage_by_snapshot(now=now)

    assert set(usage_by_snapshot.keys()) == {"viktor"}
    usage = usage_by_snapshot["viktor"]
    assert usage.active_session_count == 2
    assert usage.primary is not None
    assert usage.secondary is not None
    assert usage.primary.used_percent == 76.0
    assert usage.secondary.used_percent == 34.0


def test_read_runtime_live_session_counts_by_snapshot_reads_runtime_profiles(
    monkeypatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    runtime_root = tmp_path / "runtimes"
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))

    work_runtime = runtime_root / "terminal-work"
    work_runtime.mkdir(parents=True, exist_ok=True)
    (work_runtime / "current").write_text("work", encoding="utf-8")
    work_day_dir = _sessions_day_dir(work_runtime / "sessions", now)
    _write_rollout(
        work_day_dir / "rollout-work.jsonl",
        timestamp=now - timedelta(minutes=1),
        primary_used=10.0,
        secondary_used=20.0,
    )

    personal_runtime = runtime_root / "terminal-personal"
    personal_runtime.mkdir(parents=True, exist_ok=True)
    (personal_runtime / "current").write_text("personal", encoding="utf-8")
    personal_day_dir = _sessions_day_dir(personal_runtime / "sessions", now)
    _write_rollout(
        personal_day_dir / "rollout-personal.jsonl",
        timestamp=now - timedelta(seconds=30),
        primary_used=30.0,
        secondary_used=40.0,
    )

    counts = read_runtime_live_session_counts_by_snapshot(now=now)

    assert counts == {"work": 1, "personal": 1}


def test_read_runtime_live_session_counts_by_snapshot_ignores_stale_runtime_sessions(
    monkeypatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    runtime_root = tmp_path / "runtimes"
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "60")

    runtime = runtime_root / "terminal-work"
    runtime.mkdir(parents=True, exist_ok=True)
    (runtime / "current").write_text("work", encoding="utf-8")
    day_dir = _sessions_day_dir(runtime / "sessions", now - timedelta(hours=2))
    _write_rollout(
        day_dir / "rollout-stale.jsonl",
        timestamp=now - timedelta(hours=2),
        primary_used=77.0,
        secondary_used=55.0,
    )

    counts = read_runtime_live_session_counts_by_snapshot(now=now)

    assert counts == {}


def test_read_runtime_live_session_counts_by_snapshot_keeps_pre_switch_runtime_sessions_on_previous_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime(2026, 4, 6, 12, 0, tzinfo=timezone.utc)
    runtime_root = tmp_path / "runtimes"
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))
    registry_path = tmp_path / "accounts" / "registry.json"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(
        json.dumps(
            {
                "activeAccountName": "personal",
                "previousActiveAccountName": "work",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("CODEX_AUTH_REGISTRY_PATH", str(registry_path))

    runtime = runtime_root / "terminal-main"
    runtime.mkdir(parents=True, exist_ok=True)
    current_path = runtime / "current"
    current_path.write_text("personal", encoding="utf-8")
    switch_ts = (now - timedelta(seconds=45)).timestamp()
    os.utime(current_path, (switch_ts, switch_ts))

    day_dir = _sessions_day_dir(runtime / "sessions", now)
    _write_rollout(
        day_dir / "rollout-2026-04-06T11-56-10-11111111-1111-1111-1111-111111111111.jsonl",
        timestamp=now - timedelta(minutes=3, seconds=50),
        primary_used=60.0,
        secondary_used=30.0,
    )
    _write_rollout(
        day_dir / "rollout-2026-04-06T11-59-30-22222222-2222-2222-2222-222222222222.jsonl",
        timestamp=now - timedelta(seconds=30),
        primary_used=22.0,
        secondary_used=12.0,
    )

    counts = read_runtime_live_session_counts_by_snapshot(now=now)

    assert counts == {"work": 1, "personal": 1}


def test_read_local_codex_live_usage_by_snapshot_runtime_prefers_newest_sample_within_runtime(
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

    runtime = runtime_root / "terminal-work"
    runtime.mkdir(parents=True, exist_ok=True)
    (runtime / "current").write_text("work", encoding="utf-8")
    day_dir = _sessions_day_dir(runtime / "sessions", now)
    _write_rollout(
        day_dir / "rollout-2026-04-03T16-13-25-older-session.jsonl",
        timestamp=now - timedelta(seconds=12),
        primary_used=95.0,
        secondary_used=80.0,
    )
    _write_rollout(
        day_dir / "rollout-2026-04-03T16-22-44-newer-session.jsonl",
        timestamp=now - timedelta(seconds=6),
        primary_used=12.0,
        secondary_used=25.0,
    )

    usage_by_snapshot = read_local_codex_live_usage_by_snapshot(now=now)

    assert set(usage_by_snapshot.keys()) == {"work"}
    work_usage = usage_by_snapshot["work"]
    assert work_usage.active_session_count == 2
    assert work_usage.primary is not None
    assert work_usage.secondary is not None
    assert work_usage.primary.used_percent == 12.0
    assert work_usage.secondary.used_percent == 25.0


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


def test_read_local_codex_live_usage_by_snapshot_merges_same_snapshot_using_newest_runtime_sample(
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
        timestamp=now - timedelta(minutes=2),
        primary_used=81.0,
        secondary_used=66.0,
    )

    runtime_b = runtime_root / "terminal-b"
    runtime_b.mkdir(parents=True, exist_ok=True)
    (runtime_b / "current").write_text("work", encoding="utf-8")
    day_dir_b = _sessions_day_dir(runtime_b / "sessions", now)
    _write_rollout(
        day_dir_b / "rollout-b.jsonl",
        timestamp=now - timedelta(minutes=1),
        primary_used=14.0,
        secondary_used=22.0,
    )

    usage_by_snapshot = read_local_codex_live_usage_by_snapshot(now=now)

    assert set(usage_by_snapshot.keys()) == {"work"}
    merged = usage_by_snapshot["work"]
    assert merged.active_session_count == 2
    assert merged.primary is not None
    assert merged.secondary is not None
    assert merged.primary.used_percent == 14.0
    assert merged.secondary.used_percent == 22.0


def test_read_local_codex_live_usage_samples_by_snapshot_returns_runtime_and_default_samples(
    monkeypatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    runtime_root = tmp_path / "runtimes"
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))

    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    current_path = tmp_path / "current"
    current_path.write_text("work", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="work"),
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [],
    )

    default_day_dir = _sessions_day_dir(sessions_root, now)
    _write_rollout(
        default_day_dir / "rollout-default.jsonl",
        timestamp=now - timedelta(minutes=1),
        primary_used=12.0,
        secondary_used=31.0,
    )

    runtime = runtime_root / "terminal-work"
    runtime.mkdir(parents=True, exist_ok=True)
    (runtime / "current").write_text("work", encoding="utf-8")
    runtime_day_dir = _sessions_day_dir(runtime / "sessions", now)
    _write_rollout(
        runtime_day_dir / "rollout-runtime.jsonl",
        timestamp=now - timedelta(seconds=30),
        primary_used=91.0,
        secondary_used=72.0,
    )

    samples_by_snapshot = read_local_codex_live_usage_samples_by_snapshot(now=now)

    assert set(samples_by_snapshot.keys()) == {"work"}
    samples = samples_by_snapshot["work"]
    assert len(samples) == 2
    used_primary = sorted(sample.primary.used_percent for sample in samples if sample.primary is not None)
    assert used_primary == [12.0, 91.0]


def test_read_local_codex_live_usage_by_snapshot_assigns_default_fallback_to_dominant_mapped_snapshot_when_rollouts_are_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="amodeus@nagyviktor.com"),
    )

    day_dir = _sessions_day_dir(sessions_root, now)
    _write_rollout(
        day_dir / "rollout-2026-04-05T10-07-46-019d5caf-03d1-7791-abd3-0694d6bb1357.jsonl",
        timestamp=now - timedelta(seconds=10),
        primary_used=25.0,
        secondary_used=78.0,
    )

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(901, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {"CODEX_AUTH_ACTIVE_SNAPSHOT": "perzeus@nagyviktor.com"},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._resolve_process_rollout_path",
        lambda _pid: None,
    )

    usage_by_snapshot = read_local_codex_live_usage_by_snapshot(now=now)

    assert set(usage_by_snapshot.keys()) == {"perzeus@nagyviktor.com"}
    usage = usage_by_snapshot["perzeus@nagyviktor.com"]
    assert usage.primary is not None
    assert usage.secondary is not None
    assert usage.primary.used_percent == 25.0
    assert usage.secondary.used_percent == 78.0


def test_read_local_codex_live_usage_samples_by_snapshot_assigns_default_fallback_to_dominant_mapped_snapshot_when_rollouts_are_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="amodeus@nagyviktor.com"),
    )

    day_dir = _sessions_day_dir(sessions_root, now)
    _write_rollout(
        day_dir / "rollout-2026-04-05T10-07-46-019d5caf-03d1-7791-abd3-0694d6bb1357.jsonl",
        timestamp=now - timedelta(seconds=10),
        primary_used=25.0,
        secondary_used=78.0,
    )

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(902, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {"CODEX_AUTH_ACTIVE_SNAPSHOT": "perzeus@nagyviktor.com"},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._resolve_process_rollout_path",
        lambda _pid: None,
    )

    samples_by_snapshot = read_local_codex_live_usage_samples_by_snapshot(now=now)

    assert set(samples_by_snapshot.keys()) == {"perzeus@nagyviktor.com"}
    samples = samples_by_snapshot["perzeus@nagyviktor.com"]
    assert len(samples) == 1
    assert samples[0].primary is not None
    assert samples[0].secondary is not None
    assert samples[0].primary.used_percent == 25.0
    assert samples[0].secondary.used_percent == 78.0


def test_read_local_codex_live_usage_by_snapshot_keeps_default_fallback_unattributed_when_mapped_snapshot_counts_tie(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="amodeus@nagyviktor.com"),
    )

    day_dir = _sessions_day_dir(sessions_root, now)
    _write_rollout(
        day_dir / "rollout-2026-04-05T10-07-46-019d5caf-03d1-7791-abd3-0694d6bb1357.jsonl",
        timestamp=now - timedelta(seconds=10),
        primary_used=25.0,
        secondary_used=78.0,
    )

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [
            (903, ["/usr/bin/codex", "model_instructions_file=agents"]),
            (904, ["/usr/bin/codex", "model_instructions_file=agents"]),
        ],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda pid: (
            {"CODEX_AUTH_ACTIVE_SNAPSHOT": "perzeus@nagyviktor.com"}
            if pid == 903
            else {"CODEX_AUTH_ACTIVE_SNAPSHOT": "itrexsale@gmail.com"}
        ),
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._resolve_process_rollout_path",
        lambda _pid: None,
    )

    usage_by_snapshot = read_local_codex_live_usage_by_snapshot(now=now)

    assert usage_by_snapshot == {}


def test_read_local_codex_live_usage_by_snapshot_splits_default_scope_samples_by_live_process_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="thedailyscooby@gmail.com"),
    )

    day_dir = _sessions_day_dir(sessions_root, now)
    scooby_rollout = day_dir / "rollout-2026-04-05T10-25-55-019d5cbf-9e4e-7113-a3b7-de101ac1615c.jsonl"
    perzeus_rollout = day_dir / "rollout-2026-04-05T10-07-46-019d5caf-03d1-7791-abd3-0694d6bb1357.jsonl"
    _write_rollout(
        scooby_rollout,
        timestamp=now - timedelta(seconds=30),
        primary_used=97.0,
        secondary_used=83.0,
    )
    _write_rollout(
        perzeus_rollout,
        timestamp=now - timedelta(seconds=20),
        primary_used=59.0,
        secondary_used=82.0,
    )

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [
            (201, ["/usr/bin/codex", "model_instructions_file=agents"]),
            (202, ["/usr/bin/codex", "model_instructions_file=agents"]),
        ],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda pid: (
            {"CODEX_AUTH_ACTIVE_SNAPSHOT": "thedailyscooby@gmail.com"}
            if pid == 201
            else {"CODEX_AUTH_ACTIVE_SNAPSHOT": "perzeus@nagyviktor.com"}
        ),
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._resolve_process_rollout_path",
        lambda pid: scooby_rollout if pid == 201 else perzeus_rollout,
    )

    usage_by_snapshot = read_local_codex_live_usage_by_snapshot(now=now)

    assert set(usage_by_snapshot.keys()) == {
        "thedailyscooby@gmail.com",
        "perzeus@nagyviktor.com",
    }
    assert usage_by_snapshot["thedailyscooby@gmail.com"].primary is not None
    assert usage_by_snapshot["thedailyscooby@gmail.com"].secondary is not None
    assert usage_by_snapshot["thedailyscooby@gmail.com"].primary.used_percent == 97.0
    assert usage_by_snapshot["thedailyscooby@gmail.com"].secondary.used_percent == 83.0
    assert usage_by_snapshot["perzeus@nagyviktor.com"].primary is not None
    assert usage_by_snapshot["perzeus@nagyviktor.com"].secondary is not None
    assert usage_by_snapshot["perzeus@nagyviktor.com"].primary.used_percent == 59.0
    assert usage_by_snapshot["perzeus@nagyviktor.com"].secondary.used_percent == 82.0


def test_read_local_codex_live_usage_samples_by_snapshot_splits_default_scope_samples_by_live_process_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="thedailyscooby@gmail.com"),
    )

    day_dir = _sessions_day_dir(sessions_root, now)
    scooby_rollout = day_dir / "rollout-2026-04-05T10-25-03-019d5cbe-d5f8-78d0-b3fd-272f24bafc82.jsonl"
    perzeus_rollout = day_dir / "rollout-2026-04-05T10-06-51-019d5cae-2c1e-7493-b08d-20a4ebf98a27.jsonl"
    _write_rollout(
        scooby_rollout,
        timestamp=now - timedelta(seconds=25),
        primary_used=99.0,
        secondary_used=83.0,
    )
    _write_rollout(
        perzeus_rollout,
        timestamp=now - timedelta(seconds=15),
        primary_used=48.0,
        secondary_used=81.0,
    )

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [
            (301, ["/usr/bin/codex", "model_instructions_file=agents"]),
            (302, ["/usr/bin/codex", "model_instructions_file=agents"]),
        ],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda pid: (
            {"CODEX_AUTH_ACTIVE_SNAPSHOT": "thedailyscooby@gmail.com"}
            if pid == 301
            else {"CODEX_AUTH_ACTIVE_SNAPSHOT": "perzeus@nagyviktor.com"}
        ),
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._resolve_process_rollout_path",
        lambda pid: scooby_rollout if pid == 301 else perzeus_rollout,
    )

    samples_by_snapshot = read_local_codex_live_usage_samples_by_snapshot(now=now)

    assert set(samples_by_snapshot.keys()) == {
        "thedailyscooby@gmail.com",
        "perzeus@nagyviktor.com",
    }
    scooby_samples = samples_by_snapshot["thedailyscooby@gmail.com"]
    perzeus_samples = samples_by_snapshot["perzeus@nagyviktor.com"]
    assert len(scooby_samples) == 1
    assert len(perzeus_samples) == 1
    assert scooby_samples[0].primary is not None
    assert perzeus_samples[0].primary is not None
    assert scooby_samples[0].primary.used_percent == 99.0
    assert perzeus_samples[0].primary.used_percent == 48.0


def test_read_local_codex_live_usage_by_snapshot_maps_host_proc_rollout_paths_into_mounted_sessions_dir(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="thedailyscooby@gmail.com"),
    )

    day_dir = _sessions_day_dir(sessions_root, now)
    rollout_name = "rollout-2026-04-05T10-07-46-019d5caf-03d1-7791-abd3-0694d6bb1357.jsonl"
    mounted_rollout = day_dir / rollout_name
    _write_rollout(
        mounted_rollout,
        timestamp=now - timedelta(seconds=20),
        primary_used=59.0,
        secondary_used=82.0,
    )

    host_rollout = Path("/home/deadpool/.codex/sessions/2026/04/05") / rollout_name

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(401, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {"CODEX_AUTH_ACTIVE_SNAPSHOT": "perzeus@nagyviktor.com"},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._resolve_process_rollout_path",
        lambda _pid: host_rollout,
    )

    usage_by_snapshot = read_local_codex_live_usage_by_snapshot(now=now)

    assert set(usage_by_snapshot.keys()) == {"perzeus@nagyviktor.com"}
    perzeus_usage = usage_by_snapshot["perzeus@nagyviktor.com"]
    assert perzeus_usage.primary is not None
    assert perzeus_usage.secondary is not None
    assert perzeus_usage.primary.used_percent == 59.0
    assert perzeus_usage.secondary.used_percent == 82.0


def test_recent_active_snapshot_process_fallback_requires_recent_snapshot_switch(
    monkeypatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc)
    current_path = tmp_path / "current"
    current_path.write_text("work", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._has_running_default_scope_codex_process",
        lambda: True,
    )

    assert has_recent_active_snapshot_process_fallback(now=now) is True

    stale = now - timedelta(minutes=10)
    os.utime(current_path, (stale.timestamp(), stale.timestamp()))
    assert has_recent_active_snapshot_process_fallback(now=now) is False


def test_read_live_codex_process_session_counts_by_snapshot_uses_explicit_snapshot_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(101, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {"CODEX_AUTH_ACTIVE_SNAPSHOT": "work"},
    )

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"work": 1}


def test_read_live_codex_process_session_attribution_maps_host_rollout_path_for_task_preview(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    day_dir = _sessions_day_dir(sessions_root, now)
    session_id = "019d5caf-03d1-7791-abd3-0694d6bb1357"
    rollout_name = f"rollout-2026-04-05T10-07-46-{session_id}.jsonl"
    mounted_rollout = day_dir / rollout_name
    _write_rollout_with_user_task(
        mounted_rollout,
        timestamp=now - timedelta(seconds=5),
        task="Map this task from mounted sessions path",
    )

    host_rollout = Path("/home/deadpool/.codex/sessions/2026/04/05") / rollout_name

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(901, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {"CODEX_AUTH_ACTIVE_SNAPSHOT": "viktor@edixai.com"},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._resolve_process_rollout_path",
        lambda _pid: host_rollout,
    )

    attribution = read_live_codex_process_session_attribution()

    assert attribution.counts_by_snapshot == {"viktor@edixai.com": 1}
    assert attribution.task_preview_by_pid[901] == "Map this task from mounted sessions path"
    assert attribution.task_previews_by_pid[901] == [
        "Map this task from mounted sessions path"
    ]


def test_resolve_session_rollout_started_at_reads_start_from_rollout_filename(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    day_dir = sessions_root / "2026" / "04" / "05"
    day_dir.mkdir(parents=True, exist_ok=True)
    session_id = "019d5caf-03d1-7791-abd3-0694d6bb1357"
    rollout_path = day_dir / f"rollout-2026-04-05T10-07-46-{session_id}.jsonl"
    rollout_path.write_text("", encoding="utf-8")

    started_at = codex_live_usage_module._resolve_session_rollout_started_at(session_id)

    assert started_at is not None
    assert datetime.fromtimestamp(started_at, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H-%M-%S"
    ) == "2026-04-05T10-07-46"


def test_read_live_codex_process_session_attribution_does_not_reuse_recent_session_previews_when_proc_fd_rollout_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    base_time = datetime(2026, 4, 5, 9, 50, tzinfo=timezone.utc)
    started_at_by_pid = {
        393963: (base_time - timedelta(minutes=14)).timestamp(),
        408006: (base_time - timedelta(minutes=10)).timestamp(),
        450971: base_time.timestamp(),
    }

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [
            (393963, ["/usr/bin/codex"]),
            (408006, ["/usr/bin/codex"]),
            (450971, ["/usr/bin/codex"]),
        ],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda pid: (
            {"CODEX_AUTH_ACTIVE_SNAPSHOT": "odin@edixai.com"}
            if pid == 393963
            else {"CODEX_AUTH_ACTIVE_SNAPSHOT": "viktor@edixai.com"}
        ),
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._resolve_process_task_previews",
        lambda _pid, **_kwargs: [],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda pid: started_at_by_pid.get(pid),
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.read_local_codex_task_previews_by_session_id",
        lambda **_kwargs: {
            "019d5d03-6ce7-7632-8fae-cba240fc8774": codex_live_usage_module.LocalCodexTaskPreview(
                text="Task from Viktor session #1",
                recorded_at=base_time + timedelta(minutes=1),
            ),
            "019d5d0c-c00f-7b91-802e-ccce1b6074bd": codex_live_usage_module.LocalCodexTaskPreview(
                text="Task from Viktor session #2",
                recorded_at=base_time + timedelta(minutes=3),
            ),
        },
    )

    attribution = read_live_codex_process_session_attribution()

    assert attribution.counts_by_snapshot == {
        "odin@edixai.com": 1,
        "viktor@edixai.com": 2,
    }
    assert attribution.task_preview_by_pid == {}
    assert attribution.task_previews_by_pid == {}


def test_terminate_live_codex_processes_for_snapshot_only_targets_matching_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [
            (101, ["/usr/bin/codex", "model_instructions_file=agents"]),
            (102, ["/usr/bin/codex", "model_instructions_file=agents"]),
            (103, ["/usr/bin/codex", "model_instructions_file=agents"]),
        ],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda pid: (
            {"CODEX_AUTH_ACTIVE_SNAPSHOT": "work"}
            if pid in {101, 103}
            else {"CODEX_AUTH_ACTIVE_SNAPSHOT": "other"}
        ),
    )
    terminated: list[int] = []
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._terminate_codex_process",
        lambda pid: terminated.append(pid) or True,
    )

    terminated_count = terminate_live_codex_processes_for_snapshot("work")

    assert terminated_count == 2
    assert terminated == [101, 103]


def test_terminate_live_codex_processes_for_snapshot_respects_max_target_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CODEX_LB_TERMINATE_SESSION_MAX_TARGETS", "1")
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [
            (201, ["/usr/bin/codex", "model_instructions_file=agents"]),
            (202, ["/usr/bin/codex", "model_instructions_file=agents"]),
        ],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {"CODEX_AUTH_ACTIVE_SNAPSHOT": "work"},
    )
    terminated: list[int] = []
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._terminate_codex_process",
        lambda pid: terminated.append(pid) or True,
    )

    terminated_count = terminate_live_codex_processes_for_snapshot("work")

    assert terminated_count == 1
    assert terminated == [201]


def test_terminate_codex_process_sends_sigint_before_forceful_shutdown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent_signals: list[signal.Signals] = []
    wait_calls: list[int] = []

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._is_pid_alive",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._session_terminate_grace_seconds",
        lambda: 3,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._send_process_signal",
        lambda _pid, sig: sent_signals.append(sig),
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._wait_for_process_exit",
        lambda _pid, *, timeout_seconds: wait_calls.append(timeout_seconds) or True,
    )

    terminated = codex_live_usage_module._terminate_codex_process(321)

    assert terminated is True
    assert sent_signals == [signal.SIGINT]
    assert wait_calls == [3]


def test_terminate_codex_process_falls_back_from_sigint_to_sigterm_and_sigkill(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent_signals: list[signal.Signals] = []
    wait_results = iter([False, False])
    alive_checks = iter([True, True, True, False])

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._is_pid_alive",
        lambda _pid: next(alive_checks),
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._session_terminate_grace_seconds",
        lambda: 2,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._send_process_signal",
        lambda _pid, sig: sent_signals.append(sig),
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._wait_for_process_exit",
        lambda _pid, *, timeout_seconds: next(wait_results),
    )
    monkeypatch.setattr("app.modules.accounts.codex_live_usage.time.sleep", lambda _seconds: None)

    terminated = codex_live_usage_module._terminate_codex_process(654)

    assert terminated is True
    assert sent_signals == [signal.SIGINT, signal.SIGTERM, signal.SIGKILL]


def test_read_live_codex_process_session_counts_prefers_current_path_over_stale_explicit_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "current"
    current_path.write_text("odin", encoding="utf-8")
    auth_path = tmp_path / "auth.json"
    auth_path.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(111, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {
            "CODEX_AUTH_ACTIVE_SNAPSHOT": "bia",
            "CODEX_AUTH_CURRENT_PATH": str(current_path),
            "CODEX_AUTH_JSON_PATH": str(auth_path),
        },
    )

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"odin": 1}


def test_read_live_codex_process_session_counts_by_snapshot_uses_runtime_current_path(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    default_current = tmp_path / "default" / "current"
    default_current.parent.mkdir(parents=True, exist_ok=True)
    default_current.write_text("default", encoding="utf-8")
    default_auth = tmp_path / "default" / "auth.json"
    default_auth.parent.mkdir(parents=True, exist_ok=True)
    default_auth.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(default_current))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(default_auth))

    runtime_current = tmp_path / "runtimes" / "terminal-b" / "current"
    runtime_current.parent.mkdir(parents=True, exist_ok=True)
    runtime_current.write_text("personal", encoding="utf-8")
    runtime_auth = tmp_path / "runtimes" / "terminal-b" / "auth.json"
    runtime_auth.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(202, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {
            "CODEX_AUTH_CURRENT_PATH": str(runtime_current),
            "CODEX_AUTH_JSON_PATH": str(runtime_auth),
        },
    )

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"personal": 1}


def test_read_live_codex_process_session_counts_by_snapshot_maps_unlabeled_default_scope_processes_without_start_time_gate(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    default_current = tmp_path / "default" / "current"
    default_current.parent.mkdir(parents=True, exist_ok=True)
    default_current.write_text("work", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(default_current))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(303, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"work": 1}


def test_read_live_codex_process_session_counts_by_snapshot_uses_uid_home_when_home_env_differs(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    uid_home = tmp_path / "uid-home"
    default_current = uid_home / ".codex" / "current"
    default_current.parent.mkdir(parents=True, exist_ok=True)
    default_current.write_text("work", encoding="utf-8")

    monkeypatch.delenv("CODEX_AUTH_CURRENT_PATH", raising=False)
    monkeypatch.delenv("CODEX_AUTH_JSON_PATH", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path / "service-home"))
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.pwd.getpwuid",
        lambda _uid: SimpleNamespace(pw_dir=str(uid_home)),
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(404, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"work": 1}


def test_read_live_codex_process_session_counts_by_snapshot_uses_configured_proc_root(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    default_current = tmp_path / "default" / "current"
    default_current.parent.mkdir(parents=True, exist_ok=True)
    default_current.write_text("work", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(default_current))

    proc_root = tmp_path / "proc"
    pid_dir = proc_root / "123"
    pid_dir.mkdir(parents=True, exist_ok=True)
    (pid_dir / "cmdline").write_bytes(b"/usr/bin/codex\x00model_instructions_file=agents\x00")
    (pid_dir / "environ").write_bytes(b"")
    monkeypatch.setenv("CODEX_LB_PROC_ROOT", str(proc_root))

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"work": 1}


def test_read_live_codex_process_session_counts_by_snapshot_deduplicates_node_wrapper_with_native_child(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    default_current = tmp_path / "default" / "current"
    default_current.parent.mkdir(parents=True, exist_ok=True)
    default_current.write_text("work", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(default_current))

    proc_root = tmp_path / "proc"

    wrapper_pid_dir = proc_root / "123"
    wrapper_pid_dir.mkdir(parents=True, exist_ok=True)
    (wrapper_pid_dir / "cmdline").write_bytes(
        b"/usr/bin/node\x00/home/deadpool/.nvm/versions/node/v22/bin/codex\x00"
        b"--dangerously-bypass-approvals-and-sandbox\x00model_instructions_file=agents\x00"
    )
    (wrapper_pid_dir / "environ").write_bytes(b"")
    (wrapper_pid_dir / "status").write_text("Name:\tnode\nPPid:\t1\n", encoding="utf-8")

    child_pid_dir = proc_root / "124"
    child_pid_dir.mkdir(parents=True, exist_ok=True)
    (child_pid_dir / "cmdline").write_bytes(
        b"/opt/codex/codex\x00--dangerously-bypass-approvals-and-sandbox\x00"
        b"model_instructions_file=agents\x00"
    )
    (child_pid_dir / "environ").write_bytes(b"")
    (child_pid_dir / "status").write_text("Name:\tcodex\nPPid:\t123\n", encoding="utf-8")

    monkeypatch.setenv("CODEX_LB_PROC_ROOT", str(proc_root))

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"work": 1}


def test_read_live_codex_process_session_counts_by_snapshot_keeps_node_wrapper_without_native_child(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    default_current = tmp_path / "default" / "current"
    default_current.parent.mkdir(parents=True, exist_ok=True)
    default_current.write_text("work", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(default_current))

    proc_root = tmp_path / "proc"
    wrapper_pid_dir = proc_root / "123"
    wrapper_pid_dir.mkdir(parents=True, exist_ok=True)
    (wrapper_pid_dir / "cmdline").write_bytes(
        b"/usr/bin/node\x00/home/deadpool/.nvm/versions/node/v22/bin/codex\x00"
        b"--dangerously-bypass-approvals-and-sandbox\x00model_instructions_file=agents\x00"
    )
    (wrapper_pid_dir / "environ").write_bytes(b"")
    (wrapper_pid_dir / "status").write_text("Name:\tnode\nPPid:\t1\n", encoding="utf-8")

    monkeypatch.setenv("CODEX_LB_PROC_ROOT", str(proc_root))

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"work": 1}


def test_read_live_codex_process_session_counts_by_snapshot_maps_unlabeled_default_scope_processes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    default_current = tmp_path / "default" / "current"
    default_current.parent.mkdir(parents=True, exist_ok=True)
    default_current.write_text("work", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(default_current))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(404, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda _pid: default_current.stat().st_mtime + 1,
    )

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"work": 1}


def test_read_live_codex_process_session_counts_by_snapshot_maps_multiple_unlabeled_default_scope_processes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    default_current = tmp_path / "default" / "current"
    default_current.parent.mkdir(parents=True, exist_ok=True)
    default_current.write_text("work", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(default_current))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [
            (404, ["/usr/bin/codex", "model_instructions_file=agents"]),
            (405, ["/usr/bin/codex", "model_instructions_file=agents"]),
        ],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda _pid: default_current.stat().st_mtime + 1,
    )

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"work": 2}


def test_read_live_codex_process_session_counts_by_snapshot_maps_multiple_unlabeled_default_scope_processes_without_start_time_gate(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    default_current = tmp_path / "default" / "current"
    default_current.parent.mkdir(parents=True, exist_ok=True)
    default_current.write_text("work", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(default_current))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [
            (404, ["/usr/bin/codex", "model_instructions_file=agents"]),
            (405, ["/usr/bin/codex", "model_instructions_file=agents"]),
        ],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )

    attribution = read_live_codex_process_session_attribution()
    counts = read_live_codex_process_session_counts_by_snapshot()
    assert attribution.counts_by_snapshot == {}
    assert attribution.unattributed_session_pids == [404, 405]
    assert counts == {}


def test_read_live_codex_process_session_counts_by_snapshot_maps_multiple_pre_switch_unlabeled_processes_to_previous_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "default" / "current"
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text("unique", encoding="utf-8")
    os.utime(current_path, (1_500.0, 1_500.0))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_LB_UNLABELED_PROCESS_START_TOLERANCE_SECONDS", "0")

    registry_path = tmp_path / "accounts" / "registry.json"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(
        json.dumps(
            {
                "activeAccountName": "unique",
                "previousActiveAccountName": "tokio",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("CODEX_AUTH_REGISTRY_PATH", str(registry_path))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [
            (404, ["/usr/bin/codex", "model_instructions_file=agents"]),
            (405, ["/usr/bin/codex", "model_instructions_file=agents"]),
        ],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda _pid: 1_491.0,
    )

    attribution = read_live_codex_process_session_attribution()
    counts = read_live_codex_process_session_counts_by_snapshot()
    assert attribution.counts_by_snapshot == {"tokio": 2}
    assert attribution.unattributed_session_pids == []
    assert counts == {"tokio": 2}


def test_read_live_codex_process_session_counts_by_snapshot_skips_ambiguous_post_switch_unlabeled_processes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "default" / "current"
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text("unique", encoding="utf-8")

    now_ts = 2_000.0
    switch_ts = now_ts - 10.0
    os.utime(current_path, (switch_ts, switch_ts))

    monkeypatch.setattr("app.modules.accounts.codex_live_usage.time.time", lambda: now_ts)
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_LB_UNLABELED_PROCESS_START_TOLERANCE_SECONDS", "0")

    registry_path = tmp_path / "accounts" / "registry.json"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(
        json.dumps(
            {
                "activeAccountName": "unique",
                "previousActiveAccountName": "tokio",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("CODEX_AUTH_REGISTRY_PATH", str(registry_path))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [
            (911, ["/usr/bin/codex", "model_instructions_file=agents"]),
            (912, ["/usr/bin/codex", "model_instructions_file=agents"]),
        ],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda _pid: switch_ts + 1.0,
    )

    attribution = read_live_codex_process_session_attribution()
    counts = read_live_codex_process_session_counts_by_snapshot()
    assert attribution.counts_by_snapshot == {}
    assert attribution.unattributed_session_pids == [911, 912]
    assert counts == {}


def test_read_live_codex_process_session_counts_by_snapshot_infers_recent_previous_snapshot_from_registry_usage(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "default" / "current"
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text("perzeus@nagyviktor.com", encoding="utf-8")
    os.utime(current_path, (1_500.0, 1_500.0))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_LB_UNLABELED_PROCESS_START_TOLERANCE_SECONDS", "0")

    registry_path = tmp_path / "accounts" / "registry.json"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(
        json.dumps(
            {
                "activeAccountName": "perzeus@nagyviktor.com",
                "accounts": {
                    "perzeus@nagyviktor.com": {
                        "name": "perzeus@nagyviktor.com",
                        "lastUsageAt": "1970-01-01T00:24:59Z",
                    },
                    "itrexsale@gmail.com": {
                        "name": "itrexsale@gmail.com",
                        "lastUsageAt": "1970-01-01T00:24:50Z",
                    },
                    "admin@edixai.com": {
                        "name": "admin@edixai.com",
                        "lastUsageAt": "1970-01-01T00:22:30Z",
                    },
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("CODEX_AUTH_REGISTRY_PATH", str(registry_path))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(901, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda _pid: 1_491.0,
    )

    attribution = read_live_codex_process_session_attribution()
    counts = read_live_codex_process_session_counts_by_snapshot()
    assert attribution.counts_by_snapshot == {"itrexsale@gmail.com": 1}
    assert attribution.unattributed_session_pids == []
    assert counts == {"itrexsale@gmail.com": 1}


def test_read_live_codex_process_session_counts_by_snapshot_prefers_registry_usage_closest_to_process_start(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "default" / "current"
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text("thedailyscooby@gmail.com", encoding="utf-8")
    os.utime(current_path, (2_000.0, 2_000.0))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_LB_UNLABELED_PROCESS_START_TOLERANCE_SECONDS", "0")

    registry_path = tmp_path / "accounts" / "registry.json"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(
        json.dumps(
            {
                "activeAccountName": "thedailyscooby@gmail.com",
                "accounts": {
                    "thedailyscooby@gmail.com": {
                        "name": "thedailyscooby@gmail.com",
                        "lastUsageAt": "1970-01-01T00:33:15Z",
                    },
                    "perzeus@nagyviktor.com": {
                        "name": "perzeus@nagyviktor.com",
                        "lastUsageAt": "1970-01-01T00:16:50Z",
                    },
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("CODEX_AUTH_REGISTRY_PATH", str(registry_path))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(903, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda _pid: 1_010.0,
    )

    attribution = read_live_codex_process_session_attribution()
    counts = read_live_codex_process_session_counts_by_snapshot()
    assert attribution.counts_by_snapshot == {"perzeus@nagyviktor.com": 1}
    assert attribution.unattributed_session_pids == []
    assert counts == {"perzeus@nagyviktor.com": 1}


def test_read_live_codex_process_session_counts_by_snapshot_leaves_unattributed_when_registry_usage_is_ambiguous(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "default" / "current"
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text("perzeus@nagyviktor.com", encoding="utf-8")
    os.utime(current_path, (1_500.0, 1_500.0))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_LB_UNLABELED_PROCESS_START_TOLERANCE_SECONDS", "0")

    registry_path = tmp_path / "accounts" / "registry.json"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(
        json.dumps(
            {
                "activeAccountName": "perzeus@nagyviktor.com",
                "accounts": {
                    "itrexsale@gmail.com": {
                        "name": "itrexsale@gmail.com",
                        "lastUsageAt": "1970-01-01T00:24:50Z",
                    },
                    "admin@edixai.com": {
                        "name": "admin@edixai.com",
                        "lastUsageAt": "1970-01-01T00:24:50Z",
                    },
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("CODEX_AUTH_REGISTRY_PATH", str(registry_path))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(902, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda _pid: 1_000.0,
    )

    attribution = read_live_codex_process_session_attribution()
    counts = read_live_codex_process_session_counts_by_snapshot()
    assert attribution.counts_by_snapshot == {}
    assert attribution.unattributed_session_pids == [902]
    assert counts == {}


def test_read_live_codex_process_session_counts_by_snapshot_ignores_unlabeled_foreign_processes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    default_current = tmp_path / "default" / "current"
    default_current.parent.mkdir(parents=True, exist_ok=True)
    default_current.write_text("work", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(default_current))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(505, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: False,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda _pid: default_current.stat().st_mtime + 1,
    )

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {}


def test_read_live_codex_process_session_counts_by_snapshot_uses_explicit_default_scope_env_paths(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "current"
    current_path.write_text("work", encoding="utf-8")
    auth_path = tmp_path / "auth.json"
    auth_path.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(303, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {
            "CODEX_AUTH_CURRENT_PATH": str(current_path),
            "CODEX_AUTH_JSON_PATH": str(auth_path),
        },
    )

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"work": 1}


def test_read_live_codex_process_session_counts_by_snapshot_materializes_email_snapshot_from_auth_json(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "current"
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))

    auth_path = tmp_path / "process" / "auth.json"
    auth_path.parent.mkdir(parents=True, exist_ok=True)
    _write_auth_json(
        auth_path,
        email="new.user@example.com",
        account_id="acc-new",
        access_token="token-new",
    )
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(tmp_path / "accounts"))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(606, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {
            "CODEX_AUTH_JSON_PATH": str(auth_path),
        },
    )

    counts = read_live_codex_process_session_counts_by_snapshot()

    assert counts == {"new.user@example.com": 1}
    materialized_snapshot_path = tmp_path / "accounts" / "new.user@example.com.json"
    assert materialized_snapshot_path.exists()
    assert (
        json.loads(materialized_snapshot_path.read_text(encoding="utf-8"))["tokens"]["accessToken"]
        == "token-new"
    )


def test_read_live_codex_process_session_counts_by_snapshot_keeps_cached_unlabeled_mapping_after_switch(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "default" / "current"
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text("tokio", encoding="utf-8")
    os.utime(current_path, (900.0, 900.0))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))

    start_times = {701: 1_000.0}
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(701, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda pid: start_times.get(pid),
    )

    counts_before_switch = read_live_codex_process_session_counts_by_snapshot()
    assert counts_before_switch == {"tokio": 1}

    current_path.write_text("unique", encoding="utf-8")
    os.utime(current_path, (1_200.0, 1_200.0))

    counts_after_switch = read_live_codex_process_session_counts_by_snapshot()
    assert counts_after_switch == {"tokio": 1}


def test_read_live_codex_process_session_counts_by_snapshot_preserves_rollout_session_owner_across_pid_switch_and_maps_new_sessions(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "default" / "current"
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text("perzeus@recodee.com", encoding="utf-8")
    os.utime(current_path, (1_000.0, 1_000.0))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_LB_UNLABELED_PROCESS_START_TOLERANCE_SECONDS", "0")

    old_rollout_path = (
        tmp_path
        / "sessions"
        / "2026"
        / "04"
        / "06"
        / "rollout-2026-04-06T12-00-00-11111111-1111-1111-1111-111111111111.jsonl"
    )
    old_rollout_path.parent.mkdir(parents=True, exist_ok=True)
    old_rollout_path.write_text('{"type":"event_msg"}\n', encoding="utf-8")
    new_rollout_path = (
        tmp_path
        / "sessions"
        / "2026"
        / "04"
        / "06"
        / "rollout-2026-04-06T12-05-00-22222222-2222-2222-2222-222222222222.jsonl"
    )
    new_rollout_path.write_text('{"type":"event_msg"}\n', encoding="utf-8")

    phase = {"value": 1}
    start_times = {
        9_101: 1_010.0,  # old account session before switch
        9_102: 2_010.0,  # same rollout session, new pid after switch
        9_103: 2_015.0,  # brand new rollout session after switch
    }
    rollout_paths_by_pid = {
        9_101: old_rollout_path,
        9_102: old_rollout_path,
        9_103: new_rollout_path,
    }

    def iter_processes(_proc_root: Path) -> list[tuple[int, list[str]]]:
        if phase["value"] == 1:
            return [(9_101, ["/usr/bin/codex", "model_instructions_file=agents"])]
        if phase["value"] == 2:
            return [(9_102, ["/usr/bin/codex", "model_instructions_file=agents"])]
        return [
            (9_102, ["/usr/bin/codex", "model_instructions_file=agents"]),
            (9_103, ["/usr/bin/codex", "model_instructions_file=agents"]),
        ]

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        iter_processes,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda pid: start_times.get(pid),
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._resolve_process_rollout_path",
        lambda pid: rollout_paths_by_pid.get(pid),
    )

    counts_before_switch = read_live_codex_process_session_counts_by_snapshot()
    assert counts_before_switch == {"perzeus@recodee.com": 1}

    current_path.write_text("odin@recodee.com", encoding="utf-8")
    os.utime(current_path, (2_000.0, 2_000.0))
    phase["value"] = 2

    counts_after_pid_switch = read_live_codex_process_session_counts_by_snapshot()
    assert counts_after_pid_switch == {"perzeus@recodee.com": 1}

    phase["value"] = 3
    counts_with_new_session = read_live_codex_process_session_counts_by_snapshot()
    assert counts_with_new_session == {"perzeus@recodee.com": 1, "odin@recodee.com": 1}


def test_read_live_codex_process_session_counts_by_snapshot_skips_uncached_unlabeled_processes_started_before_switch(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "default" / "current"
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text("unique", encoding="utf-8")
    os.utime(current_path, (1_500.0, 1_500.0))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_LB_UNLABELED_PROCESS_START_TOLERANCE_SECONDS", "0")

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(801, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda _pid: 1_000.0,
    )

    attribution = read_live_codex_process_session_attribution()
    counts = read_live_codex_process_session_counts_by_snapshot()
    assert attribution.counts_by_snapshot == {}
    assert attribution.unattributed_session_pids == [801]
    assert counts == {}


def test_read_live_codex_process_session_counts_by_snapshot_uses_previous_active_snapshot_from_registry_for_pre_switch_process(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "default" / "current"
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text("unique", encoding="utf-8")
    os.utime(current_path, (1_500.0, 1_500.0))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_LB_UNLABELED_PROCESS_START_TOLERANCE_SECONDS", "0")

    registry_path = tmp_path / "accounts" / "registry.json"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(
        json.dumps(
            {
                "activeAccountName": "unique",
                "previousActiveAccountName": "tokio",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("CODEX_AUTH_REGISTRY_PATH", str(registry_path))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(851, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda _pid: 1_000.0,
    )

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"tokio": 1}


def test_read_live_codex_process_session_counts_by_snapshot_uses_rollout_start_for_pre_switch_session_ownership(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "default" / "current"
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text("odin@edixai.com", encoding="utf-8")
    os.utime(current_path, (1_500.0, 1_500.0))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_LB_UNLABELED_PROCESS_START_TOLERANCE_SECONDS", "0")

    registry_path = tmp_path / "accounts" / "registry.json"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(
        json.dumps(
            {
                "activeAccountName": "odin@edixai.com",
                "previousActiveAccountName": "zeus@edixai.com",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("CODEX_AUTH_REGISTRY_PATH", str(registry_path))

    rollout_path = (
        tmp_path
        / "sessions"
        / "1970"
        / "01"
        / "01"
        / "rollout-1970-01-01T00-16-40-019d5a6a-4665-7873-9714-9efb95b24268.jsonl"
    )
    rollout_path.parent.mkdir(parents=True, exist_ok=True)
    rollout_path.write_text("{\"type\":\"event_msg\"}\n", encoding="utf-8")
    os.utime(rollout_path, (1_000.0, 1_000.0))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(852, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda _pid: 1_600.0,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._resolve_process_rollout_path",
        lambda _pid: rollout_path,
    )

    counts = read_live_codex_process_session_counts_by_snapshot()

    assert counts == {"zeus@edixai.com": 1}


def test_read_live_codex_process_session_counts_by_snapshot_uses_process_home_default_scope_paths(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    service_current = tmp_path / "service" / "current"
    service_current.parent.mkdir(parents=True, exist_ok=True)
    service_current.write_text("amodeus@nagyviktor.com", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(service_current))

    process_home = tmp_path / "process-home"
    process_current = process_home / ".codex" / "current"
    process_current.parent.mkdir(parents=True, exist_ok=True)
    process_current.write_text("korona@nagyviktor.com", encoding="utf-8")

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(861, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {"HOME": str(process_home)},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"korona@nagyviktor.com": 1}


def test_read_live_codex_process_session_counts_by_snapshot_falls_back_to_auth_pointer_when_registry_previous_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "default" / "current"
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text("amodeus@nagyviktor.com", encoding="utf-8")
    os.utime(current_path, (1_500.0, 1_500.0))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_LB_UNLABELED_PROCESS_START_TOLERANCE_SECONDS", "0")

    auth_path = tmp_path / "default" / "auth.json"
    auth_path.parent.mkdir(parents=True, exist_ok=True)
    auth_path.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(862, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda _pid: 1_000.0,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._infer_snapshot_name_from_auth_path",
        lambda _path: "cica",
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_previous_active_snapshot_name_from_registry",
        lambda: None,
    )

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"cica": 1}


def test_read_live_codex_process_session_counts_by_snapshot_uses_registry_near_custom_current_path(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "runtime" / "auth" / "current"
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text("unique", encoding="utf-8")
    os.utime(current_path, (1_500.0, 1_500.0))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.delenv("CODEX_AUTH_REGISTRY_PATH", raising=False)
    monkeypatch.setenv("CODEX_LB_UNLABELED_PROCESS_START_TOLERANCE_SECONDS", "0")

    registry_path = current_path.parent / "accounts" / "registry.json"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(
        json.dumps(
            {
                "activeAccountName": "unique",
                "previousActiveAccountName": "tokio",
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(852, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda _pid: 1_000.0,
    )

    counts = read_live_codex_process_session_counts_by_snapshot()
    assert counts == {"tokio": 1}


def test_read_live_codex_process_session_counts_by_snapshot_preserves_previous_unlabeled_process_owners(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    current_path = tmp_path / "default" / "current"
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text("tokio", encoding="utf-8")
    os.utime(current_path, (1_000.0, 1_000.0))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_LB_UNLABELED_PROCESS_START_TOLERANCE_SECONDS", "0")

    phase = {"value": 1}
    start_times = {901: 1_010.0, 902: 1_011.0, 903: 2_005.0}

    def iter_processes(_proc_root: Path) -> list[tuple[int, list[str]]]:
        if phase["value"] == 1:
            return [
                (901, ["/usr/bin/codex", "model_instructions_file=agents"]),
                (902, ["/usr/bin/codex", "model_instructions_file=agents"]),
            ]
        return [
            (901, ["/usr/bin/codex", "model_instructions_file=agents"]),
            (902, ["/usr/bin/codex", "model_instructions_file=agents"]),
            (903, ["/usr/bin/codex", "model_instructions_file=agents"]),
        ]

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        iter_processes,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._process_belongs_to_current_user",
        lambda _pid: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_started_at",
        lambda pid: start_times.get(pid),
    )

    counts_before_switch = read_live_codex_process_session_counts_by_snapshot()
    assert counts_before_switch == {"tokio": 2}

    current_path.write_text("nagy.viktordp@gmail.com", encoding="utf-8")
    os.utime(current_path, (2_000.0, 2_000.0))
    phase["value"] = 2

    counts_after_switch = read_live_codex_process_session_counts_by_snapshot()
    assert counts_after_switch == {"tokio": 2, "nagy.viktordp@gmail.com": 1}


def test_read_local_codex_task_previews_by_snapshot_reads_default_and_runtime_profiles(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    runtime_root = tmp_path / "runtimes"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="alpha"),
    )

    default_day_dir = _sessions_day_dir(sessions_root, now)
    _write_rollout_with_user_task(
        default_day_dir / "rollout-2026-04-04T21-33-27-019d5a6a-4665-7873-9714-9efb95b24268.jsonl",
        timestamp=now - timedelta(seconds=5),
        task="Investigate alpha session drift",
    )

    runtime_dir = runtime_root / "runtime-b"
    (runtime_dir / "sessions").mkdir(parents=True, exist_ok=True)
    (runtime_dir / "current").write_text("beta", encoding="utf-8")
    runtime_day_dir = _sessions_day_dir(runtime_dir / "sessions", now)
    _write_rollout_with_user_task(
        runtime_day_dir / "rollout-2026-04-04T21-34-03-019d5a6a-d136-74e2-9e55-88305d4eed83.jsonl",
        timestamp=now - timedelta(seconds=3),
        task="Fix beta websocket retry task",
    )

    previews = read_local_codex_task_previews_by_snapshot(now=now)
    assert previews["alpha"].text == "Investigate alpha session drift"
    assert previews["beta"].text == "Fix beta websocket retry task"


def test_read_local_codex_task_previews_by_snapshot_keeps_pre_switch_runtime_tasks_on_previous_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime(2026, 4, 6, 12, 0, tzinfo=timezone.utc).replace(microsecond=0)
    runtime_root = tmp_path / "runtimes"
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(tmp_path / "sessions"))
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name=None),
    )

    registry_path = tmp_path / "accounts" / "registry.json"
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(
        json.dumps(
            {
                "activeAccountName": "personal",
                "previousActiveAccountName": "work",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("CODEX_AUTH_REGISTRY_PATH", str(registry_path))

    runtime_dir = runtime_root / "runtime-main"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    current_path = runtime_dir / "current"
    current_path.write_text("personal", encoding="utf-8")
    switch_ts = (now - timedelta(seconds=45)).timestamp()
    os.utime(current_path, (switch_ts, switch_ts))

    runtime_day_dir = _sessions_day_dir(runtime_dir / "sessions", now)
    _write_rollout_with_user_task(
        runtime_day_dir / "rollout-2026-04-06T11-56-10-11111111-1111-1111-1111-111111111111.jsonl",
        timestamp=now - timedelta(minutes=3, seconds=50),
        task="Keep this work task on previous snapshot",
    )
    _write_rollout_with_user_task(
        runtime_day_dir / "rollout-2026-04-06T11-59-30-22222222-2222-2222-2222-222222222222.jsonl",
        timestamp=now - timedelta(seconds=30),
        task="Show this personal task on active snapshot",
    )

    previews = read_local_codex_task_previews_by_snapshot(now=now)

    assert previews["work"].text == "Keep this work task on previous snapshot"
    assert previews["personal"].text == "Show this personal task on active snapshot"


def test_read_local_codex_task_previews_by_snapshot_keeps_latest_task_when_session_is_live_but_file_is_stale(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "300")
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="alpha"),
    )

    day_dir = _sessions_day_dir(sessions_root, now)
    rollout_path = day_dir / "rollout-2026-04-04T21-33-27-019d5a6a-4665-7873-9714-9efb95b24268.jsonl"
    _write_rollout_with_user_task(
        rollout_path,
        timestamp=now - timedelta(minutes=20),
        task="Keep showing this task while terminal session stays live",
    )

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [(901, ["/usr/bin/codex", "model_instructions_file=agents"])],
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_env",
        lambda _pid: {"CODEX_AUTH_ACTIVE_SNAPSHOT": "alpha"},
    )

    previews = read_local_codex_task_previews_by_snapshot(now=now)
    assert (
        previews["alpha"].text
        == "Keep showing this task while terminal session stays live"
    )


def test_read_local_codex_task_previews_by_snapshot_ignores_stale_task_without_live_session(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "300")
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage.build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="alpha"),
    )

    day_dir = _sessions_day_dir(sessions_root, now)
    rollout_path = day_dir / "rollout-2026-04-04T21-33-27-019d5a6a-4665-7873-9714-9efb95b24268.jsonl"
    _write_rollout_with_user_task(
        rollout_path,
        timestamp=now - timedelta(minutes=20),
        task="Do not surface this task when there is no live session",
    )

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._iter_running_codex_commands",
        lambda _proc_root: [],
    )

    previews = read_local_codex_task_previews_by_snapshot(now=now)
    assert previews == {}


def test_read_local_codex_task_previews_by_session_id_ignores_bootstrap_and_sanitizes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    day_dir = _sessions_day_dir(sessions_root, now)
    session_id = "019d5a6a-4665-7873-9714-9efb95b24268"
    rollout_path = day_dir / f"rollout-2026-04-04T21-33-27-{session_id}.jsonl"

    task_payload = {
        "timestamp": (now - timedelta(seconds=6)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "<image name=[Image #1]></image> Build bridge for foo@example.com token=abc123",
                }
            ],
        },
    }
    bootstrap_payload = {
        "timestamp": (now - timedelta(seconds=4)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "# AGENTS.md instructions for /repo\n<INSTRUCTIONS>\nAUTONOMY DIRECTIVE\n",
                }
            ],
        },
    }
    rollout_path.write_text(
        "\n".join([json.dumps(task_payload), json.dumps(bootstrap_payload)]) + "\n",
        encoding="utf-8",
    )
    ts = now.timestamp()
    os.utime(rollout_path, (ts, ts))

    previews = read_local_codex_task_previews_by_session_id(now=now)
    assert previews[session_id].text == "Build bridge for [redacted-email] token=[redacted]"


def test_read_local_codex_task_previews_by_session_id_extracts_task_from_bootstrap_wrapped_message(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    day_dir = _sessions_day_dir(sessions_root, now)
    session_id = "019d5a6a-4665-7873-9714-9efb95b24270"
    rollout_path = day_dir / f"rollout-2026-04-04T21-33-29-{session_id}.jsonl"

    wrapped_task_payload = {
        "timestamp": (now - timedelta(seconds=2)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": (
                        "# AGENTS.md instructions for /repo\n"
                        "<INSTRUCTIONS>\n"
                        "AUTONOMY DIRECTIVE\n"
                        "</INSTRUCTIONS>\n"
                        "<environment_context>\n"
                        "<cwd>/repo</cwd>\n"
                        "</environment_context>\n"
                        "Fix task mapping for foo@example.com token=abc123"
                    ),
                }
            ],
        },
    }

    rollout_path.write_text(json.dumps(wrapped_task_payload) + "\n", encoding="utf-8")
    ts = now.timestamp()
    os.utime(rollout_path, (ts, ts))

    previews = read_local_codex_task_previews_by_session_id(now=now)
    assert previews[session_id].text == "Fix task mapping for [redacted-email] token=[redacted]"


def test_read_local_codex_task_previews_by_session_id_extracts_user_request_from_omx_explore_wrapper(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    day_dir = _sessions_day_dir(sessions_root, now)
    session_id = "019d5a6a-4665-7873-9714-9efb95b24272"
    rollout_path = day_dir / f"rollout-2026-04-04T21-33-33-{session_id}.jsonl"

    wrapped_task_payload = {
        "timestamp": (now - timedelta(seconds=2)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": (
                        "You are OMX Explore, a low-cost read-only repository exploration harness.\n"
                        "Operate strictly in read-only mode.\n"
                        "User request:\n"
                        "hide the snapshot name too because that is email"
                    ),
                }
            ],
        },
    }

    rollout_path.write_text(json.dumps(wrapped_task_payload) + "\n", encoding="utf-8")
    ts = now.timestamp()
    os.utime(rollout_path, (ts, ts))

    previews = read_local_codex_task_previews_by_session_id(now=now)
    assert session_id in previews
    assert previews[session_id].text == "hide the snapshot name too because that is email"


def test_read_local_codex_task_previews_by_session_id_keeps_full_task_text_without_short_truncation(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    day_dir = _sessions_day_dir(sessions_root, now)
    session_id = "019d5a6a-4665-7873-9714-9efb95b24273"
    rollout_path = day_dir / f"rollout-2026-04-04T21-33-35-{session_id}.jsonl"

    long_task_preview = (
        "can we regroup this account card task preview and keep the full user message visible "
        "without cutting it early because the current sentence is still meaningful and should "
        "be readable end to end on the dashboard"
    )

    payload = {
        "timestamp": (now - timedelta(seconds=3)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": long_task_preview}],
        },
    }

    rollout_path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    ts = now.timestamp()
    os.utime(rollout_path, (ts, ts))

    previews = read_local_codex_task_previews_by_session_id(now=now)
    assert session_id in previews
    assert previews[session_id].text == long_task_preview
    assert not previews[session_id].text.endswith("…")


def test_read_local_codex_task_previews_by_session_id_ignores_warning_and_status_only_done(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    day_dir = _sessions_day_dir(sessions_root, now)
    warning_session_id = "019d5a6a-4665-7873-9714-9efb95b24268"
    done_session_id = "019d5a6a-4665-7873-9714-9efb95b24269"

    warning_path = day_dir / f"rollout-2026-04-04T21-33-27-{warning_session_id}.jsonl"
    done_path = day_dir / f"rollout-2026-04-04T21-33-28-{done_session_id}.jsonl"

    warning_payload = {
        "timestamp": (now - timedelta(seconds=5)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "Warning: apply_patch was requested via exec_command. Use the apply_patch tool instead of exec_command.",
                }
            ],
        },
    }
    done_payload = {
        "timestamp": (now - timedelta(seconds=4)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "Task is done already.",
                }
            ],
        },
    }

    warning_path.write_text(json.dumps(warning_payload) + "\n", encoding="utf-8")
    done_path.write_text(json.dumps(done_payload) + "\n", encoding="utf-8")
    ts = now.timestamp()
    os.utime(warning_path, (ts, ts))
    os.utime(done_path, (ts, ts))

    previews = read_local_codex_task_previews_by_session_id(now=now)
    assert warning_session_id not in previews
    assert done_session_id not in previews


def test_read_local_codex_task_previews_by_session_id_ignores_live_usage_xml_payload(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    day_dir = _sessions_day_dir(sessions_root, now)
    session_id = "019d5a6a-4665-7873-9714-9efb95b24280"
    rollout_path = day_dir / f"rollout-2026-04-04T21-33-31-{session_id}.jsonl"

    live_usage_payload = {
        "timestamp": (now - timedelta(seconds=3)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": '<live_usage generated_at="2026-04-05T08:05:39.199074Z" total_sessions="2" mapped_sessions="2" unattributed_sessions="0">',
                }
            ],
        },
    }

    rollout_path.write_text(json.dumps(live_usage_payload) + "\n", encoding="utf-8")
    ts = now.timestamp()
    os.utime(rollout_path, (ts, ts))

    previews = read_local_codex_task_previews_by_session_id(now=now)
    assert session_id not in previews


def test_read_local_codex_task_previews_by_session_id_extracts_task_from_live_usage_xml_prefix(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    day_dir = _sessions_day_dir(sessions_root, now)
    session_id = "019d5a6a-4665-7873-9714-9efb95b24281"
    rollout_path = day_dir / f"rollout-2026-04-04T21-33-32-{session_id}.jsonl"

    mixed_payload = {
        "timestamp": (now - timedelta(seconds=3)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": (
                        '<live_usage generated_at="2026-04-05T08:05:39.199074Z" '
                        'total_sessions="2" mapped_sessions="2" '
                        'unattributed_sessions="0"></live_usage> '
                        "both are waiting for tasks when we set tasks for the session so improve this"
                    ),
                }
            ],
        },
    }

    rollout_path.write_text(json.dumps(mixed_payload) + "\n", encoding="utf-8")
    ts = now.timestamp()
    os.utime(rollout_path, (ts, ts))

    previews = read_local_codex_task_previews_by_session_id(now=now)
    assert session_id in previews
    assert (
        previews[session_id].text
        == "both are waiting for tasks when we set tasks for the session so improve this"
    )


def test_read_local_codex_task_previews_by_session_id_strips_trailing_live_usage_xml_payload(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    day_dir = _sessions_day_dir(sessions_root, now)
    session_id = "019d5a6a-4665-7873-9714-9efb95b24282"
    rollout_path = day_dir / f"rollout-2026-04-04T21-33-34-{session_id}.jsonl"

    mixed_payload = {
        "timestamp": (now - timedelta(seconds=2)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": (
                        "task should map per session in dashboard card "
                        '<live_usage generated_at="2026-04-05T09:51:36.510585Z" total_sessions="3"></live_usage>'
                    ),
                }
            ],
        },
    }

    rollout_path.write_text(json.dumps(mixed_payload) + "\n", encoding="utf-8")
    ts = now.timestamp()
    os.utime(rollout_path, (ts, ts))

    previews = read_local_codex_task_previews_by_session_id(now=now)
    assert session_id in previews
    assert previews[session_id].text == "task should map per session in dashboard card"


def test_read_local_codex_task_previews_by_session_id_keeps_latest_task_when_warning_follows(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    day_dir = _sessions_day_dir(sessions_root, now)
    session_id = "019d5a6a-4665-7873-9714-9efb95b24271"
    rollout_path = day_dir / f"rollout-2026-04-04T21-33-30-{session_id}.jsonl"

    task_payload = {
        "timestamp": (now - timedelta(seconds=10)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": "Investigate stale snapshot mapping"}],
        },
    }
    warning_payload = {
        "timestamp": (now - timedelta(seconds=2)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "Warning: apply_patch was requested via exec_command. Use the apply_patch tool instead of exec_command.",
                }
            ],
        },
    }
    rollout_path.write_text(
        "\n".join([json.dumps(task_payload), json.dumps(warning_payload)]) + "\n",
        encoding="utf-8",
    )
    ts = now.timestamp()
    os.utime(rollout_path, (ts, ts))

    previews = read_local_codex_task_previews_by_session_id(now=now)
    assert session_id in previews
    assert previews[session_id].text == "Investigate stale snapshot mapping"


def test_read_local_codex_task_previews_by_session_id_does_not_fallback_to_old_task_after_done_message(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    day_dir = _sessions_day_dir(sessions_root, now)
    session_id = "019d5a6a-4665-7873-9714-9efb95b24270"
    rollout_path = day_dir / f"rollout-2026-04-04T21-33-29-{session_id}.jsonl"

    task_payload = {
        "timestamp": (now - timedelta(seconds=10)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": "Investigate stale snapshot mapping"}],
        },
    }
    done_payload = {
        "timestamp": (now - timedelta(seconds=2)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": "Task is done already."}],
        },
    }
    rollout_path.write_text(
        "\n".join([json.dumps(task_payload), json.dumps(done_payload)]) + "\n",
        encoding="utf-8",
    )
    ts = now.timestamp()
    os.utime(rollout_path, (ts, ts))

    previews = read_local_codex_task_previews_by_session_id(now=now)
    assert session_id not in previews


def test_read_local_codex_task_previews_by_session_id_marks_task_finished_after_response_completed_event(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    sessions_root = tmp_path / "sessions"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    day_dir = _sessions_day_dir(sessions_root, now)
    session_id = "019d5a6a-4665-7873-9714-9efb95b24272"
    rollout_path = day_dir / f"rollout-2026-04-04T21-33-31-{session_id}.jsonl"

    task_payload = {
        "timestamp": (now - timedelta(seconds=10)).isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": "Investigate stale snapshot mapping"}],
        },
    }
    completed_payload = {
        "timestamp": (now - timedelta(seconds=2)).isoformat().replace("+00:00", "Z"),
        "type": "response.completed",
        "response": {"id": "resp_1", "status": "completed"},
    }
    rollout_path.write_text(
        "\n".join([json.dumps(task_payload), json.dumps(completed_payload)]) + "\n",
        encoding="utf-8",
    )
    ts = now.timestamp()
    os.utime(rollout_path, (ts, ts))

    previews = read_local_codex_task_previews_by_session_id(now=now)
    assert session_id in previews
    assert previews[session_id].text == "Task finished"


def test_iter_running_codex_commands_includes_plain_codex_terminal_session_via_rollout_fd(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    proc_root = tmp_path / "proc"
    for pid in (101, 102, 103):
        (proc_root / str(pid)).mkdir(parents=True, exist_ok=True)

    command_by_pid = {
        101: ["/usr/bin/codex", "app-server", "--analytics-default-enabled"],
        102: ["/usr/bin/codex", "--dangerously-bypass-approvals-and-sandbox"],
        103: ["/usr/bin/codex", "-c", "model_instructions_file=agents"],
    }
    rollout_path = (
        tmp_path
        / "sessions"
        / "rollout-2026-04-07T01-00-00-019d6513-fa60-7411-9cf7-3fa19d152d68.jsonl"
    )
    rollout_path.parent.mkdir(parents=True, exist_ok=True)
    rollout_path.write_text("", encoding="utf-8")

    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_cmdline",
        lambda pid: command_by_pid.get(pid, []),
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._resolve_process_rollout_path",
        lambda pid: rollout_path if pid == 102 else None,
    )
    monkeypatch.setattr(
        "app.modules.accounts.codex_live_usage._read_process_ppid",
        lambda _pid: None,
    )

    running = codex_live_usage_module._iter_running_codex_commands(proc_root)
    running_pids = [pid for pid, _command in running]

    assert sorted(running_pids) == [102, 103]
