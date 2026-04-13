from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import app.modules.accounts.codex_runtime_usage as runtime_usage_module
from app.modules.accounts.codex_runtime_usage import read_local_codex_runtime_usage_summary_by_snapshot


def _sessions_day_dir(root: Path, date: datetime) -> Path:
    day = date.date()
    path = root / f"{day.year:04d}" / f"{day.month:02d}" / f"{day.day:02d}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_token_count_rollout(
    path: Path,
    *,
    usages: list[dict[str, int]],
    timestamp: datetime,
) -> None:
    lines: list[str] = []
    for usage in usages:
        payload = {
            "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {"total_token_usage": usage},
            },
        }
        lines.append(json.dumps(payload))
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    ts = timestamp.timestamp()
    # Keep deterministic ordering for scanner fallback sorts.
    os.utime(path, (ts, ts))


def test_runtime_usage_scanner_uses_latest_token_count_per_session(monkeypatch, tmp_path: Path) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    day_dir = _sessions_day_dir(sessions_root, now)
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))
    monkeypatch.setattr(
        runtime_usage_module,
        "build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="snap-main"),
    )
    monkeypatch.setattr(
        runtime_usage_module,
        "_read_default_scope_rollout_paths_by_snapshot_from_live_processes",
        lambda: SimpleNamespace(rollout_paths_by_snapshot={}, has_mapped_processes=False),
    )

    file_a = day_dir / "rollout-a.jsonl"
    file_b = day_dir / "rollout-b.jsonl"
    _write_token_count_rollout(
        file_a,
        usages=[
            {"input_tokens": 10, "output_tokens": 2, "cached_input_tokens": 3},
            {"input_tokens": 25, "output_tokens": 4, "reasoning_output_tokens": 1, "cache_read_input_tokens": 9},
        ],
        timestamp=now - timedelta(minutes=2),
    )
    _write_token_count_rollout(
        file_b,
        usages=[{"input_tokens": 8, "output_tokens": 3, "cached_input_tokens": 2}],
        timestamp=now - timedelta(minutes=1),
    )

    usage = read_local_codex_runtime_usage_summary_by_snapshot(now=now, days=7)
    assert "snap-main" in usage
    summary = usage["snap-main"]
    assert summary.session_count == 2
    assert summary.input_tokens == 33
    # output_tokens already includes reasoning details in current Codex rollouts.
    assert summary.output_tokens == 7
    assert summary.cache_read_tokens == 11


def test_runtime_usage_scanner_falls_back_to_reasoning_output_when_output_missing(
    monkeypatch, tmp_path: Path
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    day_dir = _sessions_day_dir(sessions_root, now)
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))
    monkeypatch.setattr(
        runtime_usage_module,
        "build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="snap-main"),
    )
    monkeypatch.setattr(
        runtime_usage_module,
        "_read_default_scope_rollout_paths_by_snapshot_from_live_processes",
        lambda: SimpleNamespace(rollout_paths_by_snapshot={}, has_mapped_processes=False),
    )

    _write_token_count_rollout(
        day_dir / "rollout-reasoning-only.jsonl",
        usages=[
            {"input_tokens": 4, "output_tokens": 0, "reasoning_output_tokens": 6},
        ],
        timestamp=now - timedelta(minutes=1),
    )

    usage = read_local_codex_runtime_usage_summary_by_snapshot(now=now, days=7)
    summary = usage["snap-main"]
    assert summary.output_tokens == 6


def test_runtime_usage_scanner_reads_runtime_scoped_sessions(monkeypatch, tmp_path: Path) -> None:
    now = datetime.now(timezone.utc)
    runtime_root = tmp_path / "runtimes"
    runtime_dir = runtime_root / "runtime-a"
    runtime_sessions = _sessions_day_dir(runtime_dir / "sessions", now)
    (runtime_dir / "current").parent.mkdir(parents=True, exist_ok=True)
    (runtime_dir / "current").write_text("snap-runtime\n", encoding="utf-8")

    rollout = runtime_sessions / "rollout-runtime.jsonl"
    _write_token_count_rollout(
        rollout,
        usages=[{"input_tokens": 19, "output_tokens": 7, "cached_input_tokens": 5}],
        timestamp=now - timedelta(seconds=30),
    )

    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(tmp_path / "empty-sessions"))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setattr(
        runtime_usage_module,
        "build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name=None),
    )
    monkeypatch.setattr(
        runtime_usage_module,
        "_read_default_scope_rollout_paths_by_snapshot_from_live_processes",
        lambda: SimpleNamespace(rollout_paths_by_snapshot={}, has_mapped_processes=False),
    )

    usage = read_local_codex_runtime_usage_summary_by_snapshot(now=now, days=7)
    assert usage["snap-runtime"].input_tokens == 19
    assert usage["snap-runtime"].output_tokens == 7
    assert usage["snap-runtime"].cache_read_tokens == 5
    assert usage["snap-runtime"].session_count == 1


def test_runtime_usage_scanner_attributes_default_scope_rollouts_to_multiple_snapshots(
    monkeypatch, tmp_path: Path
) -> None:
    now = datetime.now(timezone.utc)
    sessions_root = tmp_path / "sessions"
    day_dir = _sessions_day_dir(sessions_root, now)
    runtime_root = tmp_path / "runtimes"
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setattr(
        runtime_usage_module,
        "build_snapshot_index",
        lambda: SimpleNamespace(active_snapshot_name="snap-active"),
    )

    rollout_a = day_dir / "rollout-a.jsonl"
    rollout_b = day_dir / "rollout-b.jsonl"
    _write_token_count_rollout(
        rollout_a,
        usages=[{"input_tokens": 110, "output_tokens": 12, "cached_input_tokens": 30, "cache_write_tokens": 4}],
        timestamp=now - timedelta(minutes=2),
    )
    _write_token_count_rollout(
        rollout_b,
        usages=[{"input_tokens": 70, "output_tokens": 9, "cached_input_tokens": 20, "cache_write_tokens": 3}],
        timestamp=now - timedelta(minutes=1),
    )

    monkeypatch.setattr(
        runtime_usage_module,
        "_read_default_scope_rollout_paths_by_snapshot_from_live_processes",
        lambda: SimpleNamespace(
            rollout_paths_by_snapshot={
                "snap-a": [rollout_a],
                "snap-b": [rollout_b],
            },
            has_mapped_processes=True,
        ),
    )

    usage = read_local_codex_runtime_usage_summary_by_snapshot(now=now, days=7)
    assert usage["snap-a"].session_count == 1
    assert usage["snap-a"].input_tokens == 110
    assert usage["snap-a"].output_tokens == 12
    assert usage["snap-a"].cache_read_tokens == 30
    assert usage["snap-a"].cache_write_tokens == 4

    assert usage["snap-b"].session_count == 1
    assert usage["snap-b"].input_tokens == 70
    assert usage["snap-b"].output_tokens == 9
    assert usage["snap-b"].cache_read_tokens == 20
    assert usage["snap-b"].cache_write_tokens == 3
