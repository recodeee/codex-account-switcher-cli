from __future__ import annotations

import json
import os
import pwd
import re
import signal
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from app.core.auth import DEFAULT_EMAIL, claims_from_auth, generate_unique_account_id, parse_auth_json
from app.modules.accounts.codex_auth_switcher import (
    build_email_snapshot_name,
    build_snapshot_index,
    select_snapshot_name,
)


_DEFAULT_ACTIVE_WINDOW_SECONDS = 300
_DEFAULT_SWITCH_PROCESS_FALLBACK_SECONDS = 60
_DEFAULT_UNLABELED_PROCESS_START_TOLERANCE_SECONDS = 5
_DEFAULT_SESSION_TERMINATE_GRACE_SECONDS = 2
_DEFAULT_SESSION_TERMINATE_MAX_TARGETS = 20
_TAIL_LINE_LIMIT = 400
_FALLBACK_SCAN_LIMIT = 200
_RATE_LIMIT_SNAPSHOTS_PER_FILE = 8
_ROLLOUT_SESSION_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$")
_ROLLOUT_SESSION_FILE_RE = re.compile(
    r"^rollout-(?P<start>\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(?P<session>[0-9a-fA-F-]{36})\.jsonl$"
)
_RESET_AT_MATCH_TOLERANCE_SECONDS = 30
_TASK_PREVIEW_MAX_LENGTH = 120
_TASK_PREVIEW_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_TASK_PREVIEW_BEARER_RE = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._-]+")
_TASK_PREVIEW_SECRET_ASSIGNMENT_RE = re.compile(
    r"(?i)\b(api[_-]?key|token|password|secret)\b\s*[:=]\s*([^\s,;]+)"
)
_TASK_PREVIEW_IMAGE_TAG_RE = re.compile(r"(?is)</?image[^>]*>")
_TASK_PREVIEW_IMAGE_LABEL_RE = re.compile(r"\[Image\s*#\d+\]", re.IGNORECASE)
_TASK_PREVIEW_STATUS_ONLY_RE = re.compile(
    r"(?i)^(?:task\s+)?(?:is\s+)?(?:already\s+)?(?:done|complete(?:d)?|finished)(?:\s+already)?[.!]?$"
)
_TASK_PREVIEW_WARNING_PREFIX_RE = re.compile(r"(?i)^warning\b")
_TASK_PREVIEW_LIVE_USAGE_XML_RE = re.compile(r"(?is)^<live_usage(?:\s|>)")
_TASK_PREVIEW_LIVE_USAGE_MAPPING_XML_RE = re.compile(r"(?is)^<live_usage_mapping(?:\s|>)")
_TASK_PREVIEW_LEADING_LIVE_USAGE_BLOCK_RE = re.compile(
    r"(?is)^\s*<live_usage\b[^>]*>.*?</live_usage>\s*"
)
_TASK_PREVIEW_LEADING_LIVE_USAGE_MAPPING_BLOCK_RE = re.compile(
    r"(?is)^\s*<live_usage_mapping\b[^>]*>.*?</live_usage_mapping>\s*"
)
_TASK_PREVIEW_BOOTSTRAP_AGENTS_HEADER_RE = re.compile(
    r"(?is)^\s*#\s*agents\.md\s+instructions\s+for[^\n]*\n?"
)
_TASK_PREVIEW_BOOTSTRAP_INSTRUCTIONS_BLOCK_RE = re.compile(
    r"(?is)^\s*<instructions>.*?</instructions>\s*"
)
_TASK_PREVIEW_BOOTSTRAP_ENVIRONMENT_BLOCK_RE = re.compile(
    r"(?is)^\s*<environment_context>.*?</environment_context>\s*"
)
_TASK_PREVIEW_BOOTSTRAP_LIVE_USAGE_BLOCK_RE = re.compile(
    r"(?is)^\s*<live_usage\b.*?</live_usage>\s*"
)
_DEFAULT_PROC_ROOT = Path("/proc")


@dataclass(frozen=True)
class LocalCodexTaskPreview:
    text: str
    recorded_at: datetime


@dataclass(frozen=True)
class LocalUsageWindow:
    used_percent: float
    reset_at: int | None
    window_minutes: int | None


@dataclass(frozen=True)
class LocalCodexLiveUsage:
    recorded_at: datetime
    active_session_count: int
    primary: LocalUsageWindow | None
    secondary: LocalUsageWindow | None


@dataclass(frozen=True)
class LocalCodexLiveUsageSample:
    source: str
    recorded_at: datetime
    primary: LocalUsageWindow | None
    secondary: LocalUsageWindow | None
    stale: bool = False


@dataclass(frozen=True)
class _UnlabeledDefaultScopeProcessOwner:
    snapshot_name: str
    started_at: float
    observed_at: float


@dataclass(frozen=True)
class LocalCodexProcessSessionAttribution:
    counts_by_snapshot: dict[str, int]
    unattributed_session_pids: list[int]
    mapped_session_pids_by_snapshot: dict[str, list[int]] = field(default_factory=dict)
    task_preview_by_pid: dict[int, str] = field(default_factory=dict)
    task_previews_by_pid: dict[int, list[str]] = field(default_factory=dict)


@dataclass(frozen=True)
class _DefaultScopeLiveProcessRolloutState:
    rollout_paths_by_snapshot: dict[str, list[Path]]
    has_mapped_processes: bool


_UNLABELED_DEFAULT_SCOPE_PROCESS_OWNER_CACHE_TTL_SECONDS = 6 * 60 * 60
_UNLABELED_DEFAULT_SCOPE_PROCESS_OWNER_CACHE_MAX_ENTRIES = 2048
_unlabeled_default_scope_process_owner_cache: dict[int, _UnlabeledDefaultScopeProcessOwner] = {}


def read_local_codex_live_usage(*, now: datetime | None = None) -> LocalCodexLiveUsage | None:
    current = now or datetime.now(timezone.utc)
    sessions_dir = _resolve_sessions_dir()
    return _read_local_codex_live_usage_for_sessions_dir(sessions_dir=sessions_dir, now=current)


def read_local_codex_live_usage_samples(*, now: datetime | None = None) -> list[LocalCodexLiveUsage]:
    current = now or datetime.now(timezone.utc)
    sessions_dir = _resolve_sessions_dir()
    return _read_local_codex_live_usage_samples_for_sessions_dir(sessions_dir=sessions_dir, now=current)


def read_local_codex_live_usage_by_snapshot(*, now: datetime | None = None) -> dict[str, LocalCodexLiveUsage]:
    current = now or datetime.now(timezone.utc)
    usage_by_snapshot: dict[str, LocalCodexLiveUsage] = {}

    default_usage_by_snapshot, has_mapped_default_scope_processes = (
        _read_default_scope_live_usage_by_snapshot_from_live_processes(
            now=current
        )
    )
    if default_usage_by_snapshot:
        usage_by_snapshot.update(default_usage_by_snapshot)
    elif not has_mapped_default_scope_processes:
        active_snapshot_name = build_snapshot_index().active_snapshot_name
        if active_snapshot_name:
            default_usage = _read_local_codex_live_usage_for_sessions_dir(
                sessions_dir=_resolve_sessions_dir(),
                now=current,
                aggregation_mode="latest",
            )
            if default_usage is not None:
                usage_by_snapshot[active_snapshot_name] = default_usage

    runtime_root = _resolve_runtime_root()
    if not runtime_root.exists() or not runtime_root.is_dir():
        return usage_by_snapshot

    for runtime_dir in runtime_root.iterdir():
        if not runtime_dir.is_dir():
            continue

        snapshot_name = _read_runtime_current_snapshot(runtime_dir)
        if not snapshot_name:
            continue

        runtime_usage = _read_local_codex_live_usage_for_sessions_dir(
            sessions_dir=runtime_dir / "sessions",
            now=current,
            aggregation_mode="latest",
        )
        if runtime_usage is None:
            continue

        previous = usage_by_snapshot.get(snapshot_name)
        usage_by_snapshot[snapshot_name] = _merge_live_usage(previous, runtime_usage)

    return usage_by_snapshot


def read_local_codex_live_usage_samples_by_snapshot(
    *,
    now: datetime | None = None,
) -> dict[str, list[LocalCodexLiveUsageSample]]:
    current = now or datetime.now(timezone.utc)
    samples_by_snapshot: dict[str, list[LocalCodexLiveUsageSample]] = {}

    default_samples_by_snapshot, has_mapped_default_scope_processes = (
        _read_default_scope_live_usage_samples_by_snapshot_from_live_processes(
            now=current
        )
    )
    if default_samples_by_snapshot:
        for snapshot_name, snapshot_samples in default_samples_by_snapshot.items():
            samples_by_snapshot[snapshot_name] = list(snapshot_samples)
    elif not has_mapped_default_scope_processes:
        active_snapshot_name = build_snapshot_index().active_snapshot_name
        if active_snapshot_name:
            default_samples = _read_local_codex_live_usage_sample_entries_for_sessions_dir(
                sessions_dir=_resolve_sessions_dir(),
                now=current,
            )
            if default_samples:
                samples_by_snapshot[active_snapshot_name] = default_samples

    runtime_root = _resolve_runtime_root()
    if not runtime_root.exists() or not runtime_root.is_dir():
        return samples_by_snapshot

    for runtime_dir in runtime_root.iterdir():
        if not runtime_dir.is_dir():
            continue

        snapshot_name = _read_runtime_current_snapshot(runtime_dir)
        if not snapshot_name:
            continue

        runtime_samples = _read_local_codex_live_usage_sample_entries_for_sessions_dir(
            sessions_dir=runtime_dir / "sessions",
            now=current,
        )
        if not runtime_samples:
            continue

        samples_by_snapshot.setdefault(snapshot_name, []).extend(runtime_samples)

    return samples_by_snapshot


def _read_default_scope_live_usage_by_snapshot_from_live_processes(
    *,
    now: datetime,
) -> tuple[dict[str, LocalCodexLiveUsage], bool]:
    rollout_state = _read_default_scope_rollout_paths_by_snapshot_from_live_processes()
    if not rollout_state.rollout_paths_by_snapshot:
        return {}, rollout_state.has_mapped_processes

    usage_by_snapshot: dict[str, LocalCodexLiveUsage] = {}
    for snapshot_name, rollout_paths in rollout_state.rollout_paths_by_snapshot.items():
        live_usage = _read_local_codex_live_usage_for_rollout_paths(
            rollout_paths=rollout_paths,
            now=now,
            aggregation_mode="latest",
        )
        if live_usage is None:
            continue
        usage_by_snapshot[snapshot_name] = live_usage
    return usage_by_snapshot, rollout_state.has_mapped_processes


def _read_default_scope_live_usage_samples_by_snapshot_from_live_processes(
    *,
    now: datetime,
) -> tuple[dict[str, list[LocalCodexLiveUsageSample]], bool]:
    rollout_state = _read_default_scope_rollout_paths_by_snapshot_from_live_processes()
    if not rollout_state.rollout_paths_by_snapshot:
        return {}, rollout_state.has_mapped_processes

    samples_by_snapshot: dict[str, list[LocalCodexLiveUsageSample]] = {}
    for snapshot_name, rollout_paths in rollout_state.rollout_paths_by_snapshot.items():
        samples = _read_local_codex_live_usage_sample_entries_for_rollout_paths(
            rollout_paths=rollout_paths,
            now=now,
        )
        if not samples:
            continue
        samples_by_snapshot[snapshot_name] = samples
    return samples_by_snapshot, rollout_state.has_mapped_processes


def _read_default_scope_rollout_paths_by_snapshot_from_live_processes() -> _DefaultScopeLiveProcessRolloutState:
    sessions_dir = _resolve_sessions_dir()
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return _DefaultScopeLiveProcessRolloutState(
            rollout_paths_by_snapshot={},
            has_mapped_processes=False,
        )

    proc_root = _resolve_proc_root()
    if not proc_root.exists() or not proc_root.is_dir():
        return _DefaultScopeLiveProcessRolloutState(
            rollout_paths_by_snapshot={},
            has_mapped_processes=False,
        )

    default_current_path = _resolve_current_path()
    default_auth_path = _resolve_auth_path()
    processes: list[tuple[int, dict[str, str]]] = []
    for pid, _command in _iter_running_codex_commands(proc_root):
        processes.append((pid, _read_process_env(pid) or {}))
    _prune_unlabeled_default_scope_process_owner_cache(active_pids={pid for pid, _env in processes})
    ambiguous_uncached_unlabeled_default_scope_pids = (
        _resolve_ambiguous_uncached_unlabeled_default_scope_pids(
            processes=processes,
            default_current_path=default_current_path,
            default_auth_path=default_auth_path,
        )
    )

    rollout_paths_by_snapshot: dict[str, set[Path]] = {}
    has_mapped_processes = False
    for pid, env in processes:
        snapshot_name = _resolve_process_snapshot_name_for_accounting(
            pid,
            env=env,
            default_current_path=default_current_path,
            default_auth_path=default_auth_path,
            suppress_unlabeled_default_scope_fallback=(
                pid in ambiguous_uncached_unlabeled_default_scope_pids
            ),
        )
        if not snapshot_name:
            continue
        has_mapped_processes = True

        # In containerized deployments the process-side /proc symlink can
        # expose host paths (for example /home/user/.codex/sessions/...)
        # while this service reads mounted paths (for example
        # /home/app/.codex/sessions/...). Reconcile by filename/date and keep
        # only paths that resolve inside the configured sessions dir.
        rollout_path = _resolve_sessions_scoped_rollout_path(
            rollout_path=_resolve_process_rollout_path(pid),
            sessions_dir=sessions_dir,
        )
        if rollout_path is None:
            continue

        rollout_paths_by_snapshot.setdefault(snapshot_name, set()).add(rollout_path)

    return _DefaultScopeLiveProcessRolloutState(
        rollout_paths_by_snapshot={
            snapshot_name: _prefer_newest_sessions(list(paths))
            for snapshot_name, paths in rollout_paths_by_snapshot.items()
            if paths
        },
        has_mapped_processes=has_mapped_processes,
    )


def _path_within_directory(path: Path, directory: Path) -> bool:
    try:
        path.resolve().relative_to(directory.resolve())
    except ValueError:
        return False
    except OSError:
        return False
    return True


def _resolve_sessions_scoped_rollout_path(*, rollout_path: Path | None, sessions_dir: Path) -> Path | None:
    if rollout_path is None:
        return None

    if rollout_path.exists() and rollout_path.is_file() and _path_within_directory(rollout_path, sessions_dir):
        try:
            return rollout_path.resolve()
        except OSError:
            return rollout_path

    from_filename = _resolve_rollout_path_in_sessions_dir_by_filename(
        filename=rollout_path.name,
        sessions_dir=sessions_dir,
    )
    if from_filename is not None:
        return from_filename

    return None


def _resolve_rollout_path_in_sessions_dir_by_filename(*, filename: str, sessions_dir: Path) -> Path | None:
    match = _ROLLOUT_SESSION_FILE_RE.match(filename)
    if match is not None:
        start = match.group("start")
        date_prefix = start[:10]
        try:
            year, month, day = date_prefix.split("-")
        except ValueError:
            year = month = day = ""
        if year and month and day:
            candidate = sessions_dir / year / month / day / filename
            if candidate.exists() and candidate.is_file():
                try:
                    return candidate.resolve()
                except OSError:
                    return candidate

    fallback_matches = sorted(sessions_dir.rglob(filename), key=_safe_mtime, reverse=True)
    for candidate in fallback_matches[:1]:
        if candidate.is_file():
            try:
                return candidate.resolve()
            except OSError:
                return candidate
    return None


def read_live_codex_process_session_counts_by_snapshot() -> dict[str, int]:
    attribution = read_live_codex_process_session_attribution()
    return attribution.counts_by_snapshot


def read_live_codex_process_session_attribution() -> LocalCodexProcessSessionAttribution:
    proc_root = _resolve_proc_root()
    if not proc_root.exists() or not proc_root.is_dir():
        return LocalCodexProcessSessionAttribution(
            counts_by_snapshot={},
            unattributed_session_pids=[],
            mapped_session_pids_by_snapshot={},
            task_preview_by_pid={},
            task_previews_by_pid={},
        )

    default_current_path = _resolve_current_path()
    default_auth_path = _resolve_auth_path()
    processes: list[tuple[int, dict[str, str]]] = []
    for pid, _command in _iter_running_codex_commands(proc_root):
        processes.append((pid, _read_process_env(pid) or {}))
    _prune_unlabeled_default_scope_process_owner_cache(active_pids={pid for pid, _env in processes})
    ambiguous_uncached_unlabeled_default_scope_pids = (
        _resolve_ambiguous_uncached_unlabeled_default_scope_pids(
            processes=processes,
            default_current_path=default_current_path,
            default_auth_path=default_auth_path,
        )
    )

    counts: dict[str, int] = {}
    unattributed_session_pids: list[int] = []
    mapped_session_pids_by_snapshot: dict[str, list[int]] = {}
    task_preview_by_pid: dict[int, str] = {}
    task_previews_by_pid: dict[int, list[str]] = {}
    for pid, env in processes:
        snapshot_name = _resolve_process_snapshot_name_for_accounting(
            pid,
            env=env,
            default_current_path=default_current_path,
            default_auth_path=default_auth_path,
            suppress_unlabeled_default_scope_fallback=(
                pid in ambiguous_uncached_unlabeled_default_scope_pids
            ),
        )
        task_previews = _resolve_process_task_previews(pid, env=env, limit=2)
        if task_previews:
            task_previews_by_pid[pid] = task_previews
            task_preview_by_pid[pid] = task_previews[0]
        if not snapshot_name:
            unattributed_session_pids.append(pid)
            continue
        counts[snapshot_name] = counts.get(snapshot_name, 0) + 1
        mapped_session_pids_by_snapshot.setdefault(snapshot_name, []).append(pid)

    for session_pids in mapped_session_pids_by_snapshot.values():
        session_pids.sort()

    return LocalCodexProcessSessionAttribution(
        counts_by_snapshot=counts,
        unattributed_session_pids=sorted(unattributed_session_pids),
        mapped_session_pids_by_snapshot=mapped_session_pids_by_snapshot,
        task_preview_by_pid=task_preview_by_pid,
        task_previews_by_pid=task_previews_by_pid,
    )


def terminate_live_codex_processes_for_snapshot(snapshot_name: str) -> int:
    normalized_snapshot_name = snapshot_name.strip()
    if not normalized_snapshot_name:
        return 0

    proc_root = _resolve_proc_root()
    if not proc_root.exists() or not proc_root.is_dir():
        return 0

    default_current_path = _resolve_current_path()
    default_auth_path = _resolve_auth_path()
    processes: list[tuple[int, dict[str, str]]] = []
    for pid, _command in _iter_running_codex_commands(proc_root):
        processes.append((pid, _read_process_env(pid) or {}))
    _prune_unlabeled_default_scope_process_owner_cache(active_pids={pid for pid, _env in processes})
    ambiguous_uncached_unlabeled_default_scope_pids = (
        _resolve_ambiguous_uncached_unlabeled_default_scope_pids(
            processes=processes,
            default_current_path=default_current_path,
            default_auth_path=default_auth_path,
        )
    )

    target_pids: list[int] = []
    for pid, env in processes:
        resolved_snapshot_name = _resolve_process_snapshot_name_for_accounting(
            pid,
            env=env,
            default_current_path=default_current_path,
            default_auth_path=default_auth_path,
            suppress_unlabeled_default_scope_fallback=(
                pid in ambiguous_uncached_unlabeled_default_scope_pids
            ),
        )
        if resolved_snapshot_name == normalized_snapshot_name:
            target_pids.append(pid)

    max_targets = _session_terminate_max_targets()
    terminated = 0
    for pid in sorted(set(target_pids))[:max_targets]:
        if _terminate_codex_process(pid):
            terminated += 1
    return terminated


def _resolve_process_snapshot_name_for_accounting(
    pid: int,
    *,
    env: dict[str, str] | None,
    default_current_path: Path,
    default_auth_path: Path,
    suppress_unlabeled_default_scope_fallback: bool = False,
) -> str | None:
    process_default_current_path, process_default_auth_path = _resolve_process_default_auth_scope_paths(
        env=env or {},
        default_current_path=default_current_path,
        default_auth_path=default_auth_path,
    )
    snapshot_name = _resolve_process_snapshot_name(
        pid,
        env=env,
        default_current_path=process_default_current_path,
        default_auth_path=process_default_auth_path,
        allow_unlabeled_default_scope_mapping=False,
    )
    if snapshot_name:
        return snapshot_name

    resolved_from_cache = _resolve_cached_unlabeled_default_scope_snapshot_name(pid)
    if resolved_from_cache:
        return resolved_from_cache

    if not _is_eligible_unlabeled_default_scope_process(
        pid=pid,
        env=env or {},
        default_current_path=process_default_current_path,
        default_auth_path=process_default_auth_path,
    ):
        return None

    if suppress_unlabeled_default_scope_fallback:
        return None

    fallback_snapshot = _resolve_process_snapshot_name(
        pid,
        env=env,
        default_current_path=process_default_current_path,
        default_auth_path=process_default_auth_path,
        allow_unlabeled_default_scope_mapping=True,
    )
    if fallback_snapshot:
        _remember_unlabeled_default_scope_snapshot_name(pid, fallback_snapshot)
    return fallback_snapshot


def _resolve_ambiguous_uncached_unlabeled_default_scope_pids(
    *,
    processes: list[tuple[int, dict[str, str]]],
    default_current_path: Path,
    default_auth_path: Path,
) -> set[int]:
    ambiguous_uncached_pids: list[int] = []

    for pid, env in processes:
        process_default_current_path, process_default_auth_path = _resolve_process_default_auth_scope_paths(
            env=env,
            default_current_path=default_current_path,
            default_auth_path=default_auth_path,
        )

        if _resolve_cached_unlabeled_default_scope_snapshot_name(pid):
            continue

        if not _is_eligible_unlabeled_default_scope_process(
            pid=pid,
            env=env,
            default_current_path=process_default_current_path,
            default_auth_path=process_default_auth_path,
        ):
            continue

        if not _is_unlabeled_default_scope_fallback_ambiguous_for_pid(
            pid=pid,
            default_current_path=process_default_current_path,
            default_auth_path=process_default_auth_path,
        ):
            continue

        ambiguous_uncached_pids.append(pid)

    if len(ambiguous_uncached_pids) > 1:
        return set(ambiguous_uncached_pids)
    return set()


def _is_unlabeled_default_scope_fallback_ambiguous_for_pid(
    *,
    pid: int,
    default_current_path: Path,
    default_auth_path: Path,
) -> bool:
    if not _process_belongs_to_current_user(pid):
        return False

    selection_changed_at = _safe_mtime(default_current_path)
    if selection_changed_at <= 0:
        return False

    started_at = _read_process_started_at(pid)
    if started_at is None:
        return True

    tolerance_seconds = float(_unlabeled_process_start_tolerance_seconds())
    if (started_at + tolerance_seconds) >= selection_changed_at:
        return False

    # Pre-switch processes with known start times are not treated as ambiguous:
    # fallback resolution uses previousActiveAccountName first, then auth.json
    # identity inference, which are deterministic for the active auth scope.
    return False


def _resolve_process_default_auth_scope_paths(
    *,
    env: dict[str, str],
    default_current_path: Path,
    default_auth_path: Path,
) -> tuple[Path, Path]:
    process_home = (env.get("HOME") or "").strip()
    if not process_home:
        return default_current_path, default_auth_path

    process_codex_dir = Path(process_home).expanduser().resolve() / ".codex"
    process_current_path = process_codex_dir / "current"
    process_auth_path = process_codex_dir / "auth.json"
    if process_current_path.exists() or process_auth_path.exists():
        return process_current_path, process_auth_path

    return default_current_path, default_auth_path


def _resolve_cached_unlabeled_default_scope_snapshot_name(pid: int) -> str | None:
    owner = _unlabeled_default_scope_process_owner_cache.get(pid)
    if owner is None:
        return None

    started_at = _read_process_started_at(pid)
    if started_at is None:
        _unlabeled_default_scope_process_owner_cache.pop(pid, None)
        return None

    if abs(started_at - owner.started_at) > 1e-6:
        _unlabeled_default_scope_process_owner_cache.pop(pid, None)
        return None

    _unlabeled_default_scope_process_owner_cache[pid] = _UnlabeledDefaultScopeProcessOwner(
        snapshot_name=owner.snapshot_name,
        started_at=owner.started_at,
        observed_at=time.time(),
    )
    return owner.snapshot_name


def _remember_unlabeled_default_scope_snapshot_name(pid: int, snapshot_name: str) -> None:
    started_at = _read_process_started_at(pid)
    if started_at is None:
        return

    _unlabeled_default_scope_process_owner_cache[pid] = _UnlabeledDefaultScopeProcessOwner(
        snapshot_name=snapshot_name,
        started_at=started_at,
        observed_at=time.time(),
    )
    _prune_unlabeled_default_scope_process_owner_cache()


def _prune_unlabeled_default_scope_process_owner_cache(*, active_pids: set[int] | None = None) -> None:
    if not _unlabeled_default_scope_process_owner_cache:
        return

    now_ts = time.time()
    ttl_cutoff = now_ts - _UNLABELED_DEFAULT_SCOPE_PROCESS_OWNER_CACHE_TTL_SECONDS

    for pid, owner in list(_unlabeled_default_scope_process_owner_cache.items()):
        if active_pids is not None and pid not in active_pids:
            _unlabeled_default_scope_process_owner_cache.pop(pid, None)
            continue
        if owner.observed_at < ttl_cutoff:
            _unlabeled_default_scope_process_owner_cache.pop(pid, None)

    overflow = len(_unlabeled_default_scope_process_owner_cache) - _UNLABELED_DEFAULT_SCOPE_PROCESS_OWNER_CACHE_MAX_ENTRIES
    if overflow <= 0:
        return

    stale_pids = sorted(
        _unlabeled_default_scope_process_owner_cache,
        key=lambda pid: _unlabeled_default_scope_process_owner_cache[pid].observed_at,
    )
    for pid in stale_pids[:overflow]:
        _unlabeled_default_scope_process_owner_cache.pop(pid, None)


def read_runtime_live_session_counts_by_snapshot(*, now: datetime | None = None) -> dict[str, int]:
    current = now or datetime.now(timezone.utc)
    runtime_root = _resolve_runtime_root()
    if not runtime_root.exists() or not runtime_root.is_dir():
        return {}

    counts: dict[str, int] = {}
    for runtime_dir in runtime_root.iterdir():
        if not runtime_dir.is_dir():
            continue

        snapshot_name = _read_runtime_current_snapshot(runtime_dir)
        if not snapshot_name:
            continue

        live_count = _count_active_rollout_sessions_for_sessions_dir(
            sessions_dir=runtime_dir / "sessions",
            now=current,
        )
        if live_count <= 0:
            continue
        counts[snapshot_name] = counts.get(snapshot_name, 0) + live_count

    return counts


def read_local_codex_task_previews_by_snapshot(
    *,
    now: datetime | None = None,
) -> dict[str, LocalCodexTaskPreview]:
    current = now or datetime.now(timezone.utc)
    previews_by_snapshot: dict[str, LocalCodexTaskPreview] = {}
    live_process_session_counts_by_snapshot = read_live_codex_process_session_counts_by_snapshot()
    runtime_live_session_counts_by_snapshot = read_runtime_live_session_counts_by_snapshot(now=current)

    def has_live_session_for_snapshot(snapshot_name: str) -> bool:
        return (
            max(0, live_process_session_counts_by_snapshot.get(snapshot_name, 0)) > 0
            or max(0, runtime_live_session_counts_by_snapshot.get(snapshot_name, 0)) > 0
        )

    active_snapshot_name = build_snapshot_index().active_snapshot_name
    if active_snapshot_name:
        default_candidates = _read_local_codex_task_preview_candidates_for_sessions_dir(
            sessions_dir=_resolve_sessions_dir(),
            now=current,
            allow_inactive_fallback=has_live_session_for_snapshot(active_snapshot_name),
        )
        _merge_task_preview_candidates_for_snapshot(
            previews_by_snapshot=previews_by_snapshot,
            snapshot_name=active_snapshot_name,
            candidates=default_candidates,
        )

    runtime_root = _resolve_runtime_root()
    if not runtime_root.exists() or not runtime_root.is_dir():
        return previews_by_snapshot

    for runtime_dir in runtime_root.iterdir():
        if not runtime_dir.is_dir():
            continue

        snapshot_name = _read_runtime_current_snapshot(runtime_dir)
        if not snapshot_name:
            continue

        runtime_candidates = _read_local_codex_task_preview_candidates_for_sessions_dir(
            sessions_dir=runtime_dir / "sessions",
            now=current,
            allow_inactive_fallback=has_live_session_for_snapshot(snapshot_name),
        )
        _merge_task_preview_candidates_for_snapshot(
            previews_by_snapshot=previews_by_snapshot,
            snapshot_name=snapshot_name,
            candidates=runtime_candidates,
        )

    return previews_by_snapshot


def read_local_codex_task_previews_by_session_id(
    *,
    now: datetime | None = None,
) -> dict[str, LocalCodexTaskPreview]:
    current = now or datetime.now(timezone.utc)
    previews_by_session_id: dict[str, LocalCodexTaskPreview] = {}

    def merge(candidates: list[tuple[str, LocalCodexTaskPreview]]) -> None:
        for session_id, candidate in candidates:
            existing = previews_by_session_id.get(session_id)
            if existing is None or candidate.recorded_at >= existing.recorded_at:
                previews_by_session_id[session_id] = candidate

    merge(
        _read_local_codex_task_preview_candidates_for_sessions_dir(
            sessions_dir=_resolve_sessions_dir(),
            now=current,
        )
    )

    runtime_root = _resolve_runtime_root()
    if runtime_root.exists() and runtime_root.is_dir():
        for runtime_dir in runtime_root.iterdir():
            if not runtime_dir.is_dir():
                continue
            merge(
                _read_local_codex_task_preview_candidates_for_sessions_dir(
                    sessions_dir=runtime_dir / "sessions",
                    now=current,
                )
            )

    return previews_by_session_id


def has_recent_active_snapshot_process_fallback(*, now: datetime | None = None) -> bool:
    current = now or datetime.now(timezone.utc)
    if not _active_snapshot_selection_changed_recently(current):
        return False
    return _has_running_default_scope_codex_process()


def _count_active_rollout_sessions_for_sessions_dir(*, sessions_dir: Path, now: datetime) -> int:
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return 0

    candidates = _candidate_rollout_files(sessions_dir, now)
    if not candidates:
        return 0

    cutoff_ts = (now - timedelta(seconds=_active_window_seconds())).timestamp()
    return sum(1 for path in candidates if _safe_mtime(path) >= cutoff_ts)


def _read_local_codex_live_usage_for_sessions_dir(
    *,
    sessions_dir: Path,
    now: datetime,
    aggregation_mode: Literal["latest", "max_used"] = "latest",
) -> LocalCodexLiveUsage | None:
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return None

    candidates = _candidate_rollout_files(sessions_dir, now)
    return _read_local_codex_live_usage_for_rollout_paths(
        rollout_paths=candidates,
        now=now,
        aggregation_mode=aggregation_mode,
    )


def _read_local_codex_live_usage_samples_for_sessions_dir(
    *,
    sessions_dir: Path,
    now: datetime,
) -> list[LocalCodexLiveUsage]:
    active_window_seconds = _active_window_seconds()
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return []

    candidates = _candidate_rollout_files(sessions_dir, now)
    if not candidates:
        return []

    cutoff_ts = (now - timedelta(seconds=active_window_seconds)).timestamp()
    active_files = [path for path in candidates if _safe_mtime(path) >= cutoff_ts]
    if not active_files:
        return []

    samples: list[LocalCodexLiveUsage] = []
    sample_cutoff = now - timedelta(seconds=active_window_seconds)
    for path in _prefer_newest_sessions(active_files):
        snapshot = _extract_latest_rate_limit_from_file(path)
        if snapshot is None:
            mtime = _safe_mtime(path)
            recorded_at = datetime.fromtimestamp(mtime, tz=timezone.utc) if mtime > 0 else now
            samples.append(
                LocalCodexLiveUsage(
                    recorded_at=recorded_at,
                    active_session_count=1,
                    primary=None,
                    secondary=None,
                )
            )
            continue

        recorded_at, primary, secondary = snapshot
        if recorded_at < sample_cutoff:
            # A session file can still be "active" by mtime while its latest
            # token_count payload is stale (for example, non-token events update
            # mtime). Keep presence-only telemetry for session counting, but do
            # not expose stale quota fingerprints that would be mis-attributed
            # across multiple accounts in mixed default-session matching.
            samples.append(
                LocalCodexLiveUsage(
                    recorded_at=recorded_at,
                    active_session_count=1,
                    primary=None,
                    secondary=None,
                )
            )
            continue

        samples.append(
            LocalCodexLiveUsage(
                recorded_at=recorded_at,
                active_session_count=1,
                primary=primary,
                secondary=secondary,
            )
        )

    return samples


def _read_local_codex_live_usage_sample_entries_for_sessions_dir(
    *,
    sessions_dir: Path,
    now: datetime,
) -> list[LocalCodexLiveUsageSample]:
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return []

    candidates = _candidate_rollout_files(sessions_dir, now)
    return _read_local_codex_live_usage_sample_entries_for_rollout_paths(
        rollout_paths=candidates,
        now=now,
    )


def _read_local_codex_live_usage_for_rollout_paths(
    *,
    rollout_paths: list[Path],
    now: datetime,
    aggregation_mode: Literal["latest", "max_used"] = "latest",
) -> LocalCodexLiveUsage | None:
    active_window_seconds = _active_window_seconds()
    if not rollout_paths:
        return None

    sorted_candidates = _prefer_newest_sessions(list(dict.fromkeys(rollout_paths)))
    cutoff_ts = (now - timedelta(seconds=active_window_seconds)).timestamp()
    active_files = [path for path in sorted_candidates if _safe_mtime(path) >= cutoff_ts]
    if not active_files:
        return None

    if aggregation_mode == "max_used":
        latest = _extract_max_used_rate_limit_from_paths(
            _prefer_newest_sessions(active_files),
            now=now,
        )
    else:
        latest = _extract_latest_rate_limit_from_paths(_prefer_newest_sessions(active_files))
    if latest is None:
        # A newly started session can be active before it emits its first token_count
        # event. In that case, fall back to the most recent known rate-limit payload
        # from nearby rollout files so the dashboard does not remain stuck at stale
        # values until the first prompt is sent.
        latest = _extract_latest_rate_limit_from_paths(_prefer_newest_sessions(sorted_candidates))

    if latest is None:
        return LocalCodexLiveUsage(
            recorded_at=now,
            active_session_count=len(active_files),
            primary=None,
            secondary=None,
        )

    recorded_at, primary, secondary = latest
    return LocalCodexLiveUsage(
        recorded_at=recorded_at,
        active_session_count=len(active_files),
        primary=primary,
        secondary=secondary,
    )


def _read_local_codex_live_usage_sample_entries_for_rollout_paths(
    *,
    rollout_paths: list[Path],
    now: datetime,
) -> list[LocalCodexLiveUsageSample]:
    active_window_seconds = _active_window_seconds()
    if not rollout_paths:
        return []

    sorted_candidates = _prefer_newest_sessions(list(dict.fromkeys(rollout_paths)))
    cutoff_ts = (now - timedelta(seconds=active_window_seconds)).timestamp()
    active_files = [path for path in sorted_candidates if _safe_mtime(path) >= cutoff_ts]
    if not active_files:
        return []

    samples: list[LocalCodexLiveUsageSample] = []
    sample_cutoff = now - timedelta(seconds=active_window_seconds)
    for path in _prefer_newest_sessions(active_files):
        source = str(path)
        snapshot = _extract_latest_rate_limit_from_file(path)
        if snapshot is None:
            mtime = _safe_mtime(path)
            recorded_at = datetime.fromtimestamp(mtime, tz=timezone.utc) if mtime > 0 else now
            samples.append(
                LocalCodexLiveUsageSample(
                    source=source,
                    recorded_at=recorded_at,
                    primary=None,
                    secondary=None,
                    stale=False,
                )
            )
            continue

        recorded_at, primary, secondary = snapshot
        samples.append(
            LocalCodexLiveUsageSample(
                source=source,
                recorded_at=recorded_at,
                primary=primary,
                secondary=secondary,
                stale=recorded_at < sample_cutoff,
            )
        )

    return samples


def _merge_live_usage(
    previous: LocalCodexLiveUsage | None,
    current: LocalCodexLiveUsage,
) -> LocalCodexLiveUsage:
    if previous is None:
        return current

    prefer_current = current.recorded_at >= previous.recorded_at
    preferred = current if prefer_current else previous
    fallback = previous if prefer_current else current

    return LocalCodexLiveUsage(
        recorded_at=max(previous.recorded_at, current.recorded_at),
        active_session_count=max(0, previous.active_session_count) + max(0, current.active_session_count),
        primary=_merge_usage_windows(
            previous=preferred.primary,
            current=fallback.primary,
            preferred_recorded_at=preferred.recorded_at,
            fallback_recorded_at=fallback.recorded_at,
            now=max(previous.recorded_at, current.recorded_at),
            prefer_max_used_within_cycle=False,
        ),
        secondary=_merge_usage_windows(
            previous=preferred.secondary,
            current=fallback.secondary,
            preferred_recorded_at=preferred.recorded_at,
            fallback_recorded_at=fallback.recorded_at,
            now=max(previous.recorded_at, current.recorded_at),
            prefer_max_used_within_cycle=False,
        ),
    )


def _prefer_newest_sessions(paths: list[Path]) -> list[Path]:
    return sorted(
        paths,
        key=lambda path: (_session_start_sort_key(path), _safe_mtime(path)),
        reverse=True,
    )


def _session_start_sort_key(path: Path) -> str:
    # rollout-<local-session-start>-<session-id>.jsonl
    # Example: rollout-2026-04-03T16-22-44-019d53...
    name = path.name
    if not name.startswith("rollout-"):
        return ""
    key = name.removeprefix("rollout-")
    # 19 chars: YYYY-MM-DDTHH-MM-SS
    if len(key) >= 19:
        prefix = key[:19]
        if _ROLLOUT_SESSION_PREFIX_RE.match(prefix):
            return prefix
    return ""


def _active_window_seconds() -> int:
    raw = os.environ.get("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS")
    if raw is None:
        return _DEFAULT_ACTIVE_WINDOW_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_ACTIVE_WINDOW_SECONDS
    return max(60, value)


def _resolve_sessions_dir() -> Path:
    sessions_raw = os.environ.get("CODEX_SESSIONS_DIR")
    if sessions_raw:
        return _resolve_path(sessions_raw)

    auth_raw = os.environ.get("CODEX_AUTH_JSON_PATH")
    if auth_raw:
        auth_path = _resolve_path(auth_raw)
        return auth_path.parent / "sessions"

    return (_resolve_default_home_path() / ".codex" / "sessions").resolve()


def _resolve_runtime_root() -> Path:
    raw = os.environ.get("CODEX_AUTH_RUNTIME_ROOT")
    if raw:
        return _resolve_path(raw)
    return (_resolve_default_home_path() / ".codex" / "runtimes").resolve()


def _resolve_current_path() -> Path:
    raw = os.environ.get("CODEX_AUTH_CURRENT_PATH")
    if raw:
        return _resolve_path(raw)
    return (_resolve_default_home_path() / ".codex" / "current").resolve()


def _resolve_auth_path() -> Path:
    raw = os.environ.get("CODEX_AUTH_JSON_PATH")
    if raw:
        return _resolve_path(raw)
    return (_resolve_default_home_path() / ".codex" / "auth.json").resolve()


def _resolve_accounts_dir() -> Path:
    raw = os.environ.get("CODEX_AUTH_ACCOUNTS_DIR")
    if raw:
        return _resolve_path(raw)

    current_raw = os.environ.get("CODEX_AUTH_CURRENT_PATH")
    if current_raw:
        current_path = _resolve_path(current_raw)
        return (current_path.parent / "accounts").resolve()

    auth_raw = os.environ.get("CODEX_AUTH_JSON_PATH")
    if auth_raw:
        auth_path = _resolve_path(auth_raw)
        return (auth_path.parent / "accounts").resolve()

    return (_resolve_default_home_path() / ".codex" / "accounts").resolve()


def _resolve_registry_path() -> Path:
    raw = os.environ.get("CODEX_AUTH_REGISTRY_PATH")
    if raw:
        return _resolve_path(raw)
    return _resolve_accounts_dir() / "registry.json"


def _resolve_default_home_path() -> Path:
    try:
        pw_home = pwd.getpwuid(os.getuid()).pw_dir
    except (KeyError, PermissionError, OSError):
        pw_home = ""

    if pw_home:
        return Path(pw_home).resolve()
    return Path.home().resolve()


def _read_runtime_current_snapshot(runtime_dir: Path) -> str | None:
    current_path = runtime_dir / "current"
    return _read_snapshot_name_from_current_path(current_path)


def _read_snapshot_name_from_current_path(current_path: Path) -> str | None:
    if not current_path.exists() or not current_path.is_file():
        return None
    try:
        value = current_path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None
    return value or None


def _resolve_path(raw: str) -> Path:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def _resolve_proc_root() -> Path:
    raw = os.environ.get("CODEX_LB_PROC_ROOT")
    if raw:
        return _resolve_path(raw)
    return _DEFAULT_PROC_ROOT


def _active_snapshot_selection_changed_recently(now: datetime) -> bool:
    current_path = _resolve_current_path()
    if not current_path.exists() or not current_path.is_file():
        return False

    changed_at = _safe_mtime(current_path)
    if changed_at <= 0:
        return False

    age_seconds = max(0.0, now.timestamp() - changed_at)
    return age_seconds <= _switch_process_fallback_seconds()


def _switch_process_fallback_seconds() -> int:
    raw = os.environ.get("CODEX_LB_SWITCH_SESSION_FALLBACK_SECONDS")
    if raw is None:
        return _DEFAULT_SWITCH_PROCESS_FALLBACK_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_SWITCH_PROCESS_FALLBACK_SECONDS
    return max(30, value)


def _has_running_default_scope_codex_process() -> bool:
    proc_root = _resolve_proc_root()
    if not proc_root.exists() or not proc_root.is_dir():
        return False

    default_current_path = _resolve_current_path()
    default_auth_path = _resolve_auth_path()
    default_home_path = _resolve_default_home_path()
    home_default_current_path = (default_home_path / ".codex" / "current").resolve()
    home_default_auth_path = (default_home_path / ".codex" / "auth.json").resolve()
    using_custom_auth_scope = (
        default_current_path != home_default_current_path
        or default_auth_path != home_default_auth_path
    )
    for pid, command in _iter_running_codex_commands(proc_root):
        env = _read_process_env(pid)
        if not env:
            continue
        if _is_non_default_auth_scope_process(
            pid,
            default_current_path=default_current_path,
            default_auth_path=default_auth_path,
            env=env,
        ):
            continue
        if using_custom_auth_scope:
            has_scope_hint = (
                "CODEX_AUTH_ACTIVE_SNAPSHOT" in env
                or "CODEX_AUTH_CURRENT_PATH" in env
                or "CODEX_AUTH_JSON_PATH" in env
            )
            if not has_scope_hint:
                # Avoid matching unrelated host-level Codex processes when a
                # test/runtime config points to a dedicated auth scope.
                continue
        if command:
            return True
    return False


def _resolve_process_snapshot_name(
    pid: int,
    *,
    env: dict[str, str] | None = None,
    default_current_path: Path,
    default_auth_path: Path,
    allow_unlabeled_default_scope_mapping: bool = True,
) -> str | None:
    env = env or {}

    explicit_snapshot = env.get("CODEX_AUTH_ACTIVE_SNAPSHOT", "").strip()

    current_override = _resolve_process_path(env.get("CODEX_AUTH_CURRENT_PATH"), pid)
    auth_override = _resolve_process_path(env.get("CODEX_AUTH_JSON_PATH"), pid)
    has_explicit_auth_scope_env = (
        "CODEX_AUTH_CURRENT_PATH" in env or "CODEX_AUTH_JSON_PATH" in env
    )
    if has_explicit_auth_scope_env or _has_runtime_scoped_auth_paths(
        current_override=current_override,
        auth_override=auth_override,
        default_current_path=default_current_path,
        default_auth_path=default_auth_path,
    ):
        snapshot_from_current = _read_current_snapshot_name(
            current_override if current_override is not None else default_current_path
        )
        if snapshot_from_current:
            return snapshot_from_current

        snapshot_from_auth_path = _infer_snapshot_name_from_auth_path(
            auth_override if auth_override is not None else default_auth_path
        )
        if snapshot_from_auth_path:
            return snapshot_from_auth_path

        if explicit_snapshot:
            return explicit_snapshot

        return None

    if explicit_snapshot:
        return explicit_snapshot

    # Some host terminals run against the default auth scope and do not expose
    # explicit snapshot/runtime env metadata. In that case, cautiously attribute
    # the process to the currently selected default snapshot only when the
    # process appears to have started at or after the latest snapshot selection.
    #
    # Guardrail: if multiple unlabeled default-scope processes are eligible at
    # the same time, attribution is ambiguous. Skip fallback mapping in that
    # case instead of remapping all processes into whichever snapshot is
    # currently selected.
    if not allow_unlabeled_default_scope_mapping:
        return None
    return _resolve_unlabeled_default_scope_snapshot_name(
        pid=pid,
        default_current_path=default_current_path,
        default_auth_path=default_auth_path,
    )


def _resolve_unlabeled_default_scope_snapshot_name(
    *,
    pid: int,
    default_current_path: Path,
    default_auth_path: Path,
) -> str | None:
    if not _process_belongs_to_current_user(pid):
        return None

    snapshot_name = _read_current_snapshot_name(default_current_path)
    if not snapshot_name:
        return None

    selection_changed_at = _safe_mtime(default_current_path)
    if selection_changed_at > 0:
        started_at = _read_process_started_at(pid)
        if started_at is not None:
            tolerance_seconds = float(_unlabeled_process_start_tolerance_seconds())
            if (started_at + tolerance_seconds) < selection_changed_at:
                previous_snapshot_name = _read_previous_active_snapshot_name_from_registry()
                if previous_snapshot_name and previous_snapshot_name != snapshot_name:
                    return previous_snapshot_name
                if default_auth_path.parent == default_current_path.parent:
                    auth_snapshot_name = _infer_snapshot_name_from_auth_path(default_auth_path)
                    if auth_snapshot_name and auth_snapshot_name != snapshot_name:
                        return auth_snapshot_name
                inferred_previous_snapshot_name = _infer_recent_previous_snapshot_name_from_registry(
                    current_snapshot_name=snapshot_name,
                    selection_changed_at=selection_changed_at,
                    process_started_at=started_at,
                )
                if inferred_previous_snapshot_name:
                    return inferred_previous_snapshot_name
                return None

    return snapshot_name


def _read_previous_active_snapshot_name_from_registry() -> str | None:
    payload = _read_registry_payload()
    if payload is None:
        return None

    previous_snapshot_name = payload.get("previousActiveAccountName")
    if not isinstance(previous_snapshot_name, str):
        return None
    normalized = previous_snapshot_name.strip()
    return normalized or None


def _read_registry_payload() -> dict[str, Any] | None:
    registry_path = _resolve_registry_path()
    if not registry_path.exists() or not registry_path.is_file():
        return None

    try:
        payload = json.loads(registry_path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError, TypeError):
        return None

    if not isinstance(payload, dict):
        return None
    return payload


def _infer_recent_previous_snapshot_name_from_registry(
    *,
    current_snapshot_name: str,
    selection_changed_at: float,
    process_started_at: float,
) -> str | None:
    payload = _read_registry_payload()
    if payload is None:
        return None

    raw_accounts = payload.get("accounts")
    if not isinstance(raw_accounts, dict):
        return None

    candidate_snapshot_name: str | None = None
    candidate_distance_seconds: float | None = None
    # Keep this fallback conservative: infer only when registry usage activity
    # occurred close to the process start time.
    max_process_distance_seconds = float(
        max(_active_window_seconds(), _switch_process_fallback_seconds() * 2)
    )
    timestamp_tie_tolerance_seconds = 1.0

    for snapshot_key, raw_account in raw_accounts.items():
        if not isinstance(raw_account, dict):
            continue

        raw_snapshot_name = raw_account.get("name", snapshot_key)
        if not isinstance(raw_snapshot_name, str):
            continue

        snapshot_name = raw_snapshot_name.strip()
        if not snapshot_name or snapshot_name == current_snapshot_name:
            continue

        parsed_last_usage = _parse_timestamp(raw_account.get("lastUsageAt"))
        if parsed_last_usage is None:
            continue
        last_usage_ts = parsed_last_usage.timestamp()
        if last_usage_ts > (selection_changed_at + timestamp_tie_tolerance_seconds):
            continue
        distance_seconds = abs(last_usage_ts - process_started_at)
        if distance_seconds > max_process_distance_seconds:
            continue

        if candidate_distance_seconds is None:
            candidate_snapshot_name = snapshot_name
            candidate_distance_seconds = distance_seconds
            continue

        if distance_seconds < (candidate_distance_seconds - timestamp_tie_tolerance_seconds):
            candidate_snapshot_name = snapshot_name
            candidate_distance_seconds = distance_seconds
            continue

        if abs(distance_seconds - candidate_distance_seconds) <= timestamp_tie_tolerance_seconds:
            if snapshot_name != candidate_snapshot_name:
                return None

    return candidate_snapshot_name


def _is_eligible_unlabeled_default_scope_process(
    *,
    pid: int,
    env: dict[str, str],
    default_current_path: Path,
    default_auth_path: Path,
) -> bool:
    explicit_snapshot = env.get("CODEX_AUTH_ACTIVE_SNAPSHOT", "").strip()

    current_override = _resolve_process_path(env.get("CODEX_AUTH_CURRENT_PATH"), pid)
    auth_override = _resolve_process_path(env.get("CODEX_AUTH_JSON_PATH"), pid)
    has_explicit_auth_scope_env = (
        "CODEX_AUTH_CURRENT_PATH" in env or "CODEX_AUTH_JSON_PATH" in env
    )
    if has_explicit_auth_scope_env or _has_runtime_scoped_auth_paths(
        current_override=current_override,
        auth_override=auth_override,
        default_current_path=default_current_path,
        default_auth_path=default_auth_path,
    ):
        return False

    if explicit_snapshot:
        return False

    if not _process_belongs_to_current_user(pid):
        return False

    return _read_current_snapshot_name(default_current_path) is not None


def _read_process_started_at(pid: int) -> float | None:
    process_path = _resolve_proc_root() / str(pid)
    try:
        return process_path.stat().st_ctime
    except OSError:
        return None


def _process_belongs_to_current_user(pid: int) -> bool:
    process_path = _resolve_proc_root() / str(pid)
    try:
        return process_path.stat().st_uid == os.getuid()
    except OSError:
        return False


def _unlabeled_process_start_tolerance_seconds() -> int:
    raw = os.environ.get("CODEX_LB_UNLABELED_PROCESS_START_TOLERANCE_SECONDS")
    if raw is None:
        return _DEFAULT_UNLABELED_PROCESS_START_TOLERANCE_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_UNLABELED_PROCESS_START_TOLERANCE_SECONDS
    return max(0, value)


def _session_terminate_grace_seconds() -> int:
    raw = os.environ.get("CODEX_LB_TERMINATE_SESSION_GRACE_SECONDS")
    if raw is None:
        return _DEFAULT_SESSION_TERMINATE_GRACE_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_SESSION_TERMINATE_GRACE_SECONDS
    return max(1, value)


def _session_terminate_max_targets() -> int:
    raw = os.environ.get("CODEX_LB_TERMINATE_SESSION_MAX_TARGETS")
    if raw is None:
        return _DEFAULT_SESSION_TERMINATE_MAX_TARGETS
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_SESSION_TERMINATE_MAX_TARGETS
    return max(1, value)


def _is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _send_process_signal(pid: int, sig: signal.Signals) -> None:
    try:
        pgid = os.getpgid(pid)
    except ProcessLookupError:
        return

    if hasattr(os, "killpg"):
        try:
            os.killpg(pgid, sig)
            return
        except ProcessLookupError:
            return
        except PermissionError:
            pass

    try:
        os.kill(pid, sig)
    except ProcessLookupError:
        return


def _terminate_codex_process(pid: int) -> bool:
    if not _is_pid_alive(pid):
        return False

    _send_process_signal(pid, signal.SIGTERM)
    deadline = time.monotonic() + _session_terminate_grace_seconds()
    while time.monotonic() < deadline:
        if not _is_pid_alive(pid):
            return True
        time.sleep(0.05)

    if _is_pid_alive(pid):
        _send_process_signal(pid, signal.SIGKILL)
        time.sleep(0.05)
    return not _is_pid_alive(pid)


def _has_runtime_scoped_auth_paths(
    *,
    current_override: Path | None,
    auth_override: Path | None,
    default_current_path: Path,
    default_auth_path: Path,
) -> bool:
    if current_override is not None and current_override != default_current_path:
        return True
    if auth_override is not None and auth_override != default_auth_path:
        return True
    return False


def _merge_task_preview_candidates_for_snapshot(
    *,
    previews_by_snapshot: dict[str, LocalCodexTaskPreview],
    snapshot_name: str,
    candidates: list[tuple[str, LocalCodexTaskPreview]],
) -> None:
    if not candidates:
        return
    latest = max(candidates, key=lambda candidate: candidate[1].recorded_at)[1]
    existing = previews_by_snapshot.get(snapshot_name)
    if existing is None or latest.recorded_at >= existing.recorded_at:
        previews_by_snapshot[snapshot_name] = latest


def _read_current_snapshot_name(current_path: Path | None) -> str | None:
    if current_path is None or not current_path.exists() or not current_path.is_file():
        return None
    try:
        value = current_path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None
    return value or None


def _infer_snapshot_name_from_auth_path(auth_path: Path | None) -> str | None:
    if auth_path is None:
        return None

    candidate = auth_path
    if candidate.is_symlink():
        try:
            candidate = candidate.resolve()
        except OSError:
            pass

    if candidate.suffix != ".json":
        return None
    if candidate.name == "auth.json":
        return _resolve_or_materialize_snapshot_name_from_auth_json(candidate)
    return candidate.stem or None


def _resolve_or_materialize_snapshot_name_from_auth_json(auth_path: Path) -> str | None:
    if not auth_path.exists() or not auth_path.is_file():
        return None

    try:
        raw = auth_path.read_bytes()
    except OSError:
        return None

    parsed = _parse_auth_identity_for_snapshot(raw)
    if parsed is None:
        return None

    account_id, normalized_email = parsed
    snapshot_index = build_snapshot_index()
    existing_snapshot_names = snapshot_index.snapshots_by_account_id.get(account_id, [])
    selected_existing_snapshot_name = select_snapshot_name(
        existing_snapshot_names,
        snapshot_index.active_snapshot_name,
        email=normalized_email,
    )
    if selected_existing_snapshot_name:
        return selected_existing_snapshot_name

    canonical_snapshot_name = build_email_snapshot_name(normalized_email)
    materialized_snapshot_name = _materialize_snapshot_from_auth_bytes(
        snapshot_name=canonical_snapshot_name,
        email=normalized_email,
        raw=raw,
    )
    return materialized_snapshot_name


def _parse_auth_identity_for_snapshot(raw: bytes) -> tuple[str, str] | None:
    try:
        auth = parse_auth_json(raw)
    except Exception:
        return None

    claims = claims_from_auth(auth)
    normalized_email = (claims.email or DEFAULT_EMAIL).strip().lower()
    if not normalized_email or normalized_email == DEFAULT_EMAIL.lower():
        return None
    return (
        generate_unique_account_id(claims.account_id, normalized_email),
        normalized_email,
    )


def _materialize_snapshot_from_auth_bytes(
    *,
    snapshot_name: str,
    email: str,
    raw: bytes,
) -> str | None:
    accounts_dir = _resolve_accounts_dir()
    try:
        accounts_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None

    candidate_name = snapshot_name
    candidate_path = accounts_dir / f"{candidate_name}.json"
    if candidate_path.exists() and candidate_path.is_file():
        existing_email = _snapshot_email_from_path(candidate_path)
        if existing_email not in {None, email}:
            alias_name = _next_available_duplicate_snapshot_name(
                base_name=snapshot_name,
                accounts_dir=accounts_dir,
            )
            if alias_name is None:
                return None
            candidate_name = alias_name
            candidate_path = accounts_dir / f"{candidate_name}.json"

    try:
        if candidate_path.exists() and candidate_path.read_bytes() == raw:
            return candidate_name
        candidate_path.write_bytes(raw)
    except OSError:
        return None

    return candidate_name


def _snapshot_email_from_path(snapshot_path: Path) -> str | None:
    try:
        raw = snapshot_path.read_bytes()
    except OSError:
        return None

    parsed = _parse_auth_identity_for_snapshot(raw)
    if parsed is None:
        return None
    return parsed[1]


def _next_available_duplicate_snapshot_name(*, base_name: str, accounts_dir: Path) -> str | None:
    suffix = 2
    while suffix < 10_000:
        candidate_name = f"{base_name}--dup-{suffix}"
        candidate_path = accounts_dir / f"{candidate_name}.json"
        if not candidate_path.exists():
            return candidate_name
        suffix += 1
    return None


def _iter_running_codex_commands(proc_root: Path) -> list[tuple[int, list[str]]]:
    running: list[tuple[int, list[str]]] = []
    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        command = _read_process_cmdline(pid)
        if not command:
            continue
        if _is_codex_session_command(command):
            running.append((pid, command))

    # The node launcher process and the native codex process can represent the
    # same terminal session. Keep the native child process as source-of-truth
    # and suppress only wrappers that are confirmed parents of a native child.
    native_child_parent_pids: set[int] = set()
    for pid, command in running:
        if Path(command[0]).name != "codex":
            continue
        ppid = _read_process_ppid(pid)
        if ppid is not None:
            native_child_parent_pids.add(ppid)

    deduplicated: list[tuple[int, list[str]]] = []
    for pid, command in running:
        if _is_node_codex_wrapper_command(command) and pid in native_child_parent_pids:
            continue
        deduplicated.append((pid, command))

    return deduplicated


def _read_process_ppid(pid: int) -> int | None:
    status_path = _resolve_proc_root() / str(pid) / "status"
    try:
        raw = status_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None

    for line in raw.splitlines():
        if not line.startswith("PPid:"):
            continue
        value = line.partition(":")[2].strip()
        if not value:
            return None
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _is_node_codex_wrapper_command(command: list[str]) -> bool:
    if len(command) < 2:
        return False
    if Path(command[0]).name not in {"node", "nodejs"}:
        return False
    return Path(command[1]).name == "codex"


def _read_process_cmdline(pid: int) -> list[str]:
    cmdline_path = _resolve_proc_root() / str(pid) / "cmdline"
    try:
        raw = cmdline_path.read_bytes()
    except OSError:
        return []
    if not raw:
        return []
    parts = [chunk.decode("utf-8", errors="ignore") for chunk in raw.split(b"\x00") if chunk]
    return [part for part in parts if part]


def _is_codex_session_command(command: list[str]) -> bool:
    if not command:
        return False

    has_codex_binary = any(Path(part).name == "codex" for part in command[:3])
    if not has_codex_binary:
        return False

    return any("model_instructions_file=" in part for part in command)


def _is_non_default_auth_scope_process(
    pid: int,
    *,
    default_current_path: Path,
    default_auth_path: Path,
    env: dict[str, str] | None = None,
) -> bool:
    resolved_env = env if env is not None else _read_process_env(pid)
    if not resolved_env:
        return False

    current_override = _resolve_process_path(resolved_env.get("CODEX_AUTH_CURRENT_PATH"), pid)
    auth_override = _resolve_process_path(resolved_env.get("CODEX_AUTH_JSON_PATH"), pid)

    if current_override is not None and current_override != default_current_path:
        return True
    if auth_override is not None and auth_override != default_auth_path:
        return True
    return False


def _read_process_env(pid: int) -> dict[str, str]:
    environ_path = _resolve_proc_root() / str(pid) / "environ"
    try:
        raw = environ_path.read_bytes()
    except OSError:
        return {}

    parsed: dict[str, str] = {}
    for entry in raw.split(b"\x00"):
        if not entry or b"=" not in entry:
            continue
        key, value = entry.split(b"=", 1)
        parsed[key.decode("utf-8", errors="ignore")] = value.decode("utf-8", errors="ignore")
    return parsed


def _resolve_process_path(raw_value: str | None, pid: int) -> Path | None:
    if not raw_value:
        return None

    candidate = Path(raw_value).expanduser()
    if candidate.is_absolute():
        try:
            return candidate.resolve()
        except OSError:
            return candidate

    cwd = _read_process_cwd(pid)
    if cwd is not None:
        candidate = cwd / candidate
    try:
        return candidate.resolve()
    except OSError:
        return candidate


def _read_process_cwd(pid: int) -> Path | None:
    cwd_link = _resolve_proc_root() / str(pid) / "cwd"
    try:
        return Path(os.readlink(cwd_link)).resolve()
    except OSError:
        return None


def _resolve_process_task_preview(pid: int, *, env: dict[str, str] | None = None) -> str | None:
    previews = _resolve_process_task_previews(pid, env=env, limit=1)
    return previews[0] if previews else None


def _resolve_process_task_previews(
    pid: int,
    *,
    env: dict[str, str] | None = None,
    limit: int = 2,
) -> list[str]:
    if limit <= 0:
        return []

    env = env or {}
    previews: list[str] = []

    direct_preview = _sanitize_codex_task_preview(env.get("CODEX_CURRENT_TASK_PREVIEW", ""))
    if direct_preview:
        previews.append(direct_preview)
        if len(previews) >= limit:
            return previews

    rollout_path = _resolve_process_rollout_path(pid)
    if rollout_path is None:
        return previews

    remaining = max(limit - len(previews), 0)
    if remaining <= 0:
        return previews

    recent_from_file = _extract_recent_task_previews_from_file(rollout_path, limit=remaining)
    for preview in recent_from_file:
        if preview.text in previews:
            continue
        previews.append(preview.text)
        if len(previews) >= limit:
            break

    return previews


def _resolve_process_rollout_path(pid: int) -> Path | None:
    fd_root = _resolve_proc_root() / str(pid) / "fd"
    if not fd_root.exists() or not fd_root.is_dir():
        return None

    best_match: tuple[float, Path] | None = None
    try:
        fd_entries = list(fd_root.iterdir())
    except OSError:
        return None

    for fd_entry in fd_entries:
        try:
            target_raw = os.readlink(fd_entry)
        except OSError:
            continue
        target = target_raw.replace(" (deleted)", "")
        target_path = Path(target)
        if _ROLLOUT_SESSION_FILE_RE.match(target_path.name) is None:
            continue
        mtime = _safe_mtime(target_path)
        if best_match is None or mtime >= best_match[0]:
            best_match = (mtime, target_path)

    if best_match is None:
        return None
    return best_match[1]


def _read_local_codex_task_preview_candidates_for_sessions_dir(
    *,
    sessions_dir: Path,
    now: datetime,
    allow_inactive_fallback: bool = False,
) -> list[tuple[str, LocalCodexTaskPreview]]:
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return []

    candidates = _candidate_rollout_files(sessions_dir, now)
    if not candidates:
        return []

    cutoff_ts = (now - timedelta(seconds=_active_window_seconds())).timestamp()
    active_files = [path for path in candidates if _safe_mtime(path) >= cutoff_ts]
    if active_files:
        source_files = _prefer_newest_sessions(active_files)
    elif allow_inactive_fallback:
        # Keep current task visible while a CLI session is still live even if
        # no new user message landed inside the active file-mtime window.
        source_files = _prefer_newest_sessions(candidates[:5])
    else:
        return []

    collected: list[tuple[str, LocalCodexTaskPreview]] = []
    for path in source_files:
        session_id = _rollout_session_id_from_path(path)
        if session_id is None:
            continue
        preview = _extract_latest_task_preview_from_file(path)
        if preview is None:
            continue
        collected.append((session_id, preview))
    return collected


def _rollout_session_id_from_path(path: Path) -> str | None:
    match = _ROLLOUT_SESSION_FILE_RE.match(path.name)
    if match is None:
        return None
    return match.group("session")


def _extract_latest_task_preview_from_file(path: Path) -> LocalCodexTaskPreview | None:
    previews = _extract_recent_task_previews_from_file(path, limit=1)
    return previews[0] if previews else None


def _extract_recent_task_previews_from_file(path: Path, *, limit: int) -> list[LocalCodexTaskPreview]:
    if limit <= 0:
        return []

    collected: list[LocalCodexTaskPreview] = []
    seen_texts: set[str] = set()

    def _consume_lines(lines: list[str]) -> bool:
        for raw_line in lines:
            event, preview = _task_preview_event_from_line(raw_line)
            if event == "clear":
                return False
            if event != "task" or preview is None:
                continue
            if preview.text in seen_texts:
                continue
            seen_texts.add(preview.text)
            collected.append(preview)
            if len(collected) >= limit:
                return False
        return True

    tail: deque[str] = deque(maxlen=_TAIL_LINE_LIMIT)
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                tail.append(line)
    except OSError:
        return []

    should_continue = _consume_lines(list(reversed(tail)))
    if not should_continue:
        return collected

    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            all_lines = handle.readlines()
    except OSError:
        return collected

    _consume_lines(list(reversed(all_lines)))
    return collected


def _task_preview_from_line(raw_line: str) -> LocalCodexTaskPreview | None:
    event, preview = _task_preview_event_from_line(raw_line)
    if event == "task":
        return preview
    return None


def _task_preview_event_from_line(raw_line: str) -> tuple[str, LocalCodexTaskPreview | None]:
    line = raw_line.strip()
    if not line:
        return ("skip", None)
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return ("skip", None)
    if not isinstance(payload, dict):
        return ("skip", None)

    if payload.get("type") != "response_item":
        return ("skip", None)

    message_payload = payload.get("payload")
    if not isinstance(message_payload, dict):
        return ("skip", None)
    if message_payload.get("type") != "message" or message_payload.get("role") != "user":
        return ("skip", None)

    raw_text = _extract_user_message_text(message_payload.get("content"))
    preview_source_text = (
        _extract_task_preview_source_text(raw_text) if raw_text is not None else None
    )
    if preview_source_text is None:
        return ("skip", None)

    normalized_source_text = preview_source_text
    normalized_source_text = _TASK_PREVIEW_IMAGE_TAG_RE.sub(" ", normalized_source_text)
    normalized_source_text = _TASK_PREVIEW_IMAGE_LABEL_RE.sub(" ", normalized_source_text)
    normalized_source_text = " ".join(normalized_source_text.split())
    if not normalized_source_text:
        return ("skip", None)
    if _TASK_PREVIEW_WARNING_PREFIX_RE.match(normalized_source_text):
        # Tool/runtime warning echoes can be emitted as user-role messages in
        # rollout logs. Ignore them so they do not wipe the previously active
        # task preview for that session.
        return ("skip", None)
    if _TASK_PREVIEW_STATUS_ONLY_RE.match(normalized_source_text):
        return ("clear", None)

    text = _sanitize_codex_task_preview(normalized_source_text)
    if text is None:
        return ("skip", None)

    timestamp = _parse_timestamp(payload.get("timestamp")) or _parse_timestamp(message_payload.get("timestamp"))
    if timestamp is None:
        return ("skip", None)

    return ("task", LocalCodexTaskPreview(text=text, recorded_at=timestamp))


def _extract_user_message_text(content: Any) -> str | None:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return None

    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if isinstance(text, str):
            parts.append(text)

    if not parts:
        return None
    return " ".join(parts)


def _extract_task_preview_source_text(raw_text: str) -> str | None:
    stripped = raw_text.strip()
    if not stripped:
        return None

    stripped_bootstrap_prefix = _strip_known_bootstrap_prefix(stripped)
    if stripped_bootstrap_prefix is None:
        return None

    normalized = " ".join(stripped_bootstrap_prefix.split())
    if not normalized:
        return None
    if _is_bootstrap_user_message(normalized):
        return None
    return normalized


def _strip_known_bootstrap_prefix(text: str) -> str | None:
    stripped = text.strip()
    if not stripped:
        return None

    lowered = stripped.lower()
    if "# agents.md instructions for " not in lowered and "<instructions>" not in lowered:
        return stripped

    normalized = stripped
    previous = ""
    while normalized != previous:
        previous = normalized
        normalized = _TASK_PREVIEW_BOOTSTRAP_AGENTS_HEADER_RE.sub("", normalized, count=1).strip()
        normalized = _TASK_PREVIEW_BOOTSTRAP_INSTRUCTIONS_BLOCK_RE.sub(
            "",
            normalized,
            count=1,
        ).strip()
        normalized = _TASK_PREVIEW_BOOTSTRAP_ENVIRONMENT_BLOCK_RE.sub(
            "",
            normalized,
            count=1,
        ).strip()
        normalized = _TASK_PREVIEW_BOOTSTRAP_LIVE_USAGE_BLOCK_RE.sub(
            "",
            normalized,
            count=1,
        ).strip()

    return normalized or None


def _is_bootstrap_user_message(text: str) -> bool:
    normalized = " ".join(text.split()).lower()
    if not normalized:
        return True
    if "# agents.md instructions for " in normalized:
        return True
    if "<instructions>" in normalized and "autonomy directive" in normalized:
        return True
    return False


def _sanitize_codex_task_preview(text: str) -> str | None:
    normalized = " ".join(text.split())
    if not normalized:
        return None

    normalized = _TASK_PREVIEW_IMAGE_TAG_RE.sub(" ", normalized)
    normalized = _TASK_PREVIEW_IMAGE_LABEL_RE.sub(" ", normalized)
    normalized = " ".join(normalized.split())
    if not normalized:
        return None

    redacted = _TASK_PREVIEW_EMAIL_RE.sub("[redacted-email]", normalized)
    redacted = _TASK_PREVIEW_BEARER_RE.sub("bearer [redacted]", redacted)
    redacted = _TASK_PREVIEW_SECRET_ASSIGNMENT_RE.sub(r"\1=[redacted]", redacted)
    trimmed = _strip_leading_live_usage_payload(redacted).strip()
    if not trimmed:
        return None
    if _TASK_PREVIEW_WARNING_PREFIX_RE.match(trimmed):
        return None
    if _TASK_PREVIEW_STATUS_ONLY_RE.match(trimmed):
        return None
    if _TASK_PREVIEW_LIVE_USAGE_XML_RE.match(trimmed):
        return None
    if _TASK_PREVIEW_LIVE_USAGE_MAPPING_XML_RE.match(trimmed):
        return None
    if len(trimmed) <= _TASK_PREVIEW_MAX_LENGTH:
        return trimmed
    return trimmed[: _TASK_PREVIEW_MAX_LENGTH - 1].rstrip() + "…"


def _strip_leading_live_usage_payload(text: str) -> str:
    normalized = text.strip()
    previous = ""
    while normalized and normalized != previous:
        previous = normalized
        normalized = _TASK_PREVIEW_LEADING_LIVE_USAGE_BLOCK_RE.sub(
            "",
            normalized,
            count=1,
        ).strip()
        normalized = _TASK_PREVIEW_LEADING_LIVE_USAGE_MAPPING_BLOCK_RE.sub(
            "",
            normalized,
            count=1,
        ).strip()
    return normalized


def _candidate_rollout_files(sessions_dir: Path, now: datetime) -> list[Path]:
    aware_now = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    results: list[Path] = []

    for offset_days in range(2):
        day = (aware_now - timedelta(days=offset_days)).date()
        day_dir = sessions_dir / f"{day.year:04d}" / f"{day.month:02d}" / f"{day.day:02d}"
        if not day_dir.exists() or not day_dir.is_dir():
            continue
        for path in day_dir.glob("rollout-*.jsonl"):
            if path.is_file():
                results.append(path)

    if results:
        return sorted(results, key=_safe_mtime, reverse=True)

    fallback = sorted(sessions_dir.rglob("rollout-*.jsonl"), key=_safe_mtime, reverse=True)
    return [path for path in fallback[:_FALLBACK_SCAN_LIMIT] if path.is_file()]


def _safe_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def _extract_latest_rate_limit_from_paths(
    paths: list[Path],
) -> tuple[datetime, LocalUsageWindow | None, LocalUsageWindow | None] | None:
    for path in paths:
        snapshots = _extract_recent_rate_limit_snapshots_from_file(path, max_samples=1)
        if snapshots:
            return snapshots[0]
    return None


def _extract_max_used_rate_limit_from_paths(
    paths: list[Path],
    *,
    now: datetime,
) -> tuple[datetime, LocalUsageWindow | None, LocalUsageWindow | None] | None:
    snapshots: list[tuple[datetime, LocalUsageWindow | None, LocalUsageWindow | None]] = []
    for path in paths:
        snapshots.extend(
            _extract_recent_rate_limit_snapshots_from_file(
                path,
                max_samples=_RATE_LIMIT_SNAPSHOTS_PER_FILE,
            )
        )

    if not snapshots:
        return None

    snapshots.sort(key=lambda item: item[0], reverse=True)
    latest_recorded_at = snapshots[0][0]
    merged_primary: LocalUsageWindow | None = None
    merged_secondary: LocalUsageWindow | None = None

    for recorded_at, primary, secondary in snapshots:
        merged_primary = _merge_usage_windows(
            previous=merged_primary,
            current=primary,
            preferred_recorded_at=latest_recorded_at,
            fallback_recorded_at=recorded_at,
            now=now,
            prefer_max_used_within_cycle=False,
        )
        merged_secondary = _merge_usage_windows(
            previous=merged_secondary,
            current=secondary,
            preferred_recorded_at=latest_recorded_at,
            fallback_recorded_at=recorded_at,
            now=now,
            prefer_max_used_within_cycle=False,
        )

    return latest_recorded_at, merged_primary, merged_secondary


def _extract_latest_rate_limit_from_file(
    path: Path,
) -> tuple[datetime, LocalUsageWindow | None, LocalUsageWindow | None] | None:
    snapshots = _extract_recent_rate_limit_snapshots_from_file(path, max_samples=1)
    if not snapshots:
        return None
    return snapshots[0]


def _extract_recent_rate_limit_snapshots_from_file(
    path: Path,
    *,
    max_samples: int,
) -> list[tuple[datetime, LocalUsageWindow | None, LocalUsageWindow | None]]:
    if max_samples <= 0:
        return []

    tail: deque[str] = deque(maxlen=_TAIL_LINE_LIMIT)
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                tail.append(line)
    except OSError:
        return []

    snapshots: list[tuple[datetime, LocalUsageWindow | None, LocalUsageWindow | None]] = []
    seen_timestamps: set[datetime] = set()

    for raw_line in reversed(tail):
        snapshot = _rate_limit_snapshot_from_line(raw_line)
        if snapshot is None:
            continue
        timestamp = snapshot[0]
        if timestamp in seen_timestamps:
            continue
        seen_timestamps.add(timestamp)
        snapshots.append(snapshot)
        if len(snapshots) >= max_samples:
            break

    if snapshots:
        return snapshots

    # Some long-running sessions can emit the latest token_count far outside
    # the tail window (for example, verbose tool output after an early
    # token_count update). When the tail pass finds no rate-limit payloads,
    # fall back to a full-file scan so we still recover the newest available
    # quota snapshot for that session.
    all_snapshots: list[tuple[datetime, LocalUsageWindow | None, LocalUsageWindow | None]] = []
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            for raw_line in handle:
                snapshot = _rate_limit_snapshot_from_line(raw_line)
                if snapshot is None:
                    continue
                timestamp = snapshot[0]
                if timestamp in seen_timestamps:
                    continue
                seen_timestamps.add(timestamp)
                all_snapshots.append(snapshot)
    except OSError:
        return []

    if not all_snapshots:
        return []

    all_snapshots.sort(key=lambda item: item[0], reverse=True)
    return all_snapshots[:max_samples]


def _rate_limit_snapshot_from_line(
    raw_line: str,
) -> tuple[datetime, LocalUsageWindow | None, LocalUsageWindow | None] | None:
    line = raw_line.strip()
    if not line:
        return None
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    rate_limits = _extract_rate_limits_payload(payload)
    if rate_limits is None:
        return None

    timestamp = _parse_timestamp(payload.get("timestamp"))
    if timestamp is None:
        return None

    primary_raw, secondary_raw = _extract_windows(rate_limits)
    primary = _window_from_payload(primary_raw, timestamp)
    secondary = _window_from_payload(secondary_raw, timestamp)
    return timestamp, primary, secondary


def _extract_rate_limits_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
    event_payload = payload.get("payload")
    if isinstance(event_payload, dict):
        event_type = event_payload.get("type")
        if event_type == "token_count":
            rate_limits = event_payload.get("rate_limits") or event_payload.get("rate_limit")
            if isinstance(rate_limits, dict):
                return rate_limits
        direct_rate_limits = event_payload.get("rate_limits")
        if isinstance(direct_rate_limits, dict):
            return direct_rate_limits

    direct = payload.get("rate_limits")
    if isinstance(direct, dict):
        return direct
    return None


def _extract_windows(rate_limits: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    primary = rate_limits.get("primary")
    secondary = rate_limits.get("secondary")
    if not isinstance(primary, dict):
        primary = rate_limits.get("primary_window") if isinstance(rate_limits.get("primary_window"), dict) else None
    if not isinstance(secondary, dict):
        secondary = (
            rate_limits.get("secondary_window") if isinstance(rate_limits.get("secondary_window"), dict) else None
        )
    return primary, secondary


def _window_from_payload(window: dict[str, Any] | None, timestamp: datetime) -> LocalUsageWindow | None:
    if not isinstance(window, dict):
        return None
    used_percent = _to_float(window.get("used_percent"))
    if used_percent is None:
        return None

    reset_at = _to_int(window.get("resets_at")) or _to_int(window.get("reset_at"))
    window_minutes = _to_int(window.get("window_minutes"))
    if window_minutes is None:
        limit_window_seconds = _to_int(window.get("window_seconds")) or _to_int(window.get("limit_window_seconds"))
        if limit_window_seconds and limit_window_seconds > 0:
            window_minutes = limit_window_seconds // 60

    if reset_at is None:
        reset_after_seconds = _to_int(window.get("reset_after_seconds"))
        if reset_after_seconds is not None and reset_after_seconds > 0:
            reset_at = int(timestamp.timestamp()) + reset_after_seconds

    return LocalUsageWindow(
        used_percent=used_percent,
        reset_at=reset_at,
        window_minutes=window_minutes,
    )


def _merge_usage_windows(
    *,
    previous: LocalUsageWindow | None,
    current: LocalUsageWindow | None,
    preferred_recorded_at: datetime,
    fallback_recorded_at: datetime,
    now: datetime,
    prefer_max_used_within_cycle: bool,
) -> LocalUsageWindow | None:
    if previous is None:
        return current
    if current is None:
        return previous

    preferred_window = previous if preferred_recorded_at >= fallback_recorded_at else current
    fallback_window = current if preferred_window is previous else previous
    now_ts = int(now.timestamp())

    preferred_reset = preferred_window.reset_at
    fallback_reset = fallback_window.reset_at

    if (
        prefer_max_used_within_cycle
        and preferred_reset is not None
        and fallback_reset is not None
    ):
        preferred_is_current_cycle = preferred_reset > now_ts
        fallback_is_current_cycle = fallback_reset > now_ts

        if preferred_is_current_cycle and not fallback_is_current_cycle:
            return preferred_window
        if fallback_is_current_cycle and not preferred_is_current_cycle:
            return fallback_window

        same_cycle = abs(preferred_reset - fallback_reset) <= _RESET_AT_MATCH_TOLERANCE_SECONDS
        same_window = (
            preferred_window.window_minutes is not None
            and fallback_window.window_minutes is not None
            and preferred_window.window_minutes == fallback_window.window_minutes
        )
        if same_cycle or same_window:
            if fallback_window.used_percent > preferred_window.used_percent:
                return fallback_window
            return preferred_window

    return preferred_window


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _to_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _to_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None
