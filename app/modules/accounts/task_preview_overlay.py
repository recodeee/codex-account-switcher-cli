from __future__ import annotations

from datetime import datetime
import os
from pathlib import Path
import re
from typing import Iterable

from app.db.models import Account
from app.modules.accounts.codex_live_usage import (
    LocalCodexTaskPreview,
    read_live_codex_process_session_attribution,
    read_local_codex_task_previews_by_session_id,
    read_local_codex_task_previews_by_snapshot,
)
from app.modules.accounts.live_usage_overrides import has_recently_terminated_cli_session_snapshot
from app.modules.accounts.schemas import (
    AccountCodexAuthStatus,
    AccountLiveQuotaDebug,
    AccountSessionTaskPreview,
)

_ROLLOUT_SESSION_FILE_RE = re.compile(
    r"^rollout-(?P<start>\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(?P<session>[0-9a-fA-F-]{36})\.jsonl$"
)
_WAITING_FOR_NEW_TASK_PREVIEW = "Waiting for new task"


def overlay_live_codex_task_previews(
    *,
    accounts: list[Account],
    codex_auth_by_account: dict[str, AccountCodexAuthStatus],
    snapshot_names_by_account: dict[str, list[str]] | None,
    codex_current_task_preview_by_account: dict[str, str],
    codex_last_task_preview_by_account: dict[str, str],
    codex_session_task_previews_by_account: dict[str, list[AccountSessionTaskPreview]],
    live_quota_debug_by_account: dict[str, AccountLiveQuotaDebug] | None,
    now: datetime,
) -> None:
    previews_by_snapshot = read_local_codex_task_previews_by_snapshot(now=now)
    previews_by_session_id = read_local_codex_task_previews_by_session_id(now=now)
    (
        process_preview_by_snapshot,
        waiting_process_snapshots,
        waiting_process_session_counts_by_snapshot,
        process_session_task_previews_by_snapshot,
    ) = (
        _read_live_process_task_preview_state_by_snapshot(
            previews_by_snapshot=previews_by_snapshot
        )
    )

    if (
        not previews_by_snapshot
        and not previews_by_session_id
        and not process_preview_by_snapshot
        and not waiting_process_snapshots
    ):
        return

    for account in accounts:
        codex_last_task_preview_by_account.pop(account.id, None)
        codex_auth_status = codex_auth_by_account.get(account.id)
        snapshot_name = codex_auth_status.snapshot_name if codex_auth_status else None
        snapshot_names = _resolve_account_snapshot_names(
            selected_snapshot_name=snapshot_name,
            snapshot_names=snapshot_names_by_account.get(account.id)
            if snapshot_names_by_account is not None
            else None,
        )
        snapshot_names = _augment_snapshot_names_with_expected_live_snapshot(
            snapshot_names=snapshot_names,
            codex_auth_status=codex_auth_status,
            available_snapshot_names=(
                set(process_preview_by_snapshot)
                | set(waiting_process_snapshots)
                | set(process_session_task_previews_by_snapshot)
                | set(previews_by_snapshot)
            ),
        )
        if snapshot_names:
            live_session_task_previews = _resolve_session_task_previews_for_snapshot_names(
                process_session_task_previews_by_snapshot=process_session_task_previews_by_snapshot,
                snapshot_names=snapshot_names,
            )
            if not live_session_task_previews:
                live_session_task_previews = _resolve_session_task_previews_from_debug_sources(
                    debug=live_quota_debug_by_account.get(account.id)
                    if live_quota_debug_by_account is not None
                    else None,
                    previews_by_session_id=previews_by_session_id,
                    snapshot_name=snapshot_name,
                )
            if live_session_task_previews:
                # Runtime-attributed live session previews are authoritative for
                # active snapshots. Replace persisted rows so stale or
                # cross-account session previews cannot leak into this account's
                # task list.
                codex_session_task_previews_by_account[account.id] = list(
                    live_session_task_previews
                )
        if snapshot_names:
            process_snapshot_name = _resolve_first_matching_snapshot_name(
                snapshot_names=snapshot_names,
                candidate_snapshot_names=process_preview_by_snapshot.keys(),
            )
            process_preview = (
                process_preview_by_snapshot.get(process_snapshot_name)
                if process_snapshot_name is not None
                else None
            )
            if process_preview:
                codex_current_task_preview_by_account[account.id] = process_preview
                continue
            waiting_snapshot_name = _resolve_first_matching_snapshot_name(
                snapshot_names=snapshot_names,
                candidate_snapshot_names=waiting_process_snapshots,
            )
            if waiting_snapshot_name is not None:
                codex_current_task_preview_by_account[account.id] = _WAITING_FOR_NEW_TASK_PREVIEW
                waiting_last_preview = _resolve_waiting_snapshot_last_preview(
                    snapshot_name=waiting_snapshot_name,
                    has_single_waiting_live_session=(
                        waiting_process_session_counts_by_snapshot.get(waiting_snapshot_name, 0)
                        == 1
                    ),
                    debug=live_quota_debug_by_account.get(account.id)
                    if live_quota_debug_by_account is not None
                    else None,
                    previews_by_session_id=previews_by_session_id,
                )
                if waiting_last_preview is not None:
                    codex_last_task_preview_by_account[account.id] = waiting_last_preview.text
                continue
            if has_recently_terminated_cli_session_snapshot(
                snapshot_names,
                selected_snapshot_name=snapshot_name,
                now=now,
            ):
                codex_current_task_preview_by_account.pop(account.id, None)
                continue

        if codex_current_task_preview_by_account.get(account.id):
            continue

        preview_from_source = _resolve_preview_from_debug_sources(
            debug=live_quota_debug_by_account.get(account.id)
            if live_quota_debug_by_account is not None
            else None,
            previews_by_session_id=previews_by_session_id,
            snapshot_name=snapshot_name,
        )
        if preview_from_source is not None:
            codex_current_task_preview_by_account[account.id] = preview_from_source.text
            continue

        if codex_auth_status is not None:
            if snapshot_name:
                preview = previews_by_snapshot.get(snapshot_name)
                if preview is not None:
                    codex_current_task_preview_by_account[account.id] = preview.text
                    continue


def _resolve_account_snapshot_names(
    *,
    selected_snapshot_name: str | None,
    snapshot_names: list[str] | None,
) -> list[str]:
    deduped_snapshot_names: list[str] = []
    seen_snapshot_names: set[str] = set()

    for value in [selected_snapshot_name, *(snapshot_names or [])]:
        normalized = _normalize_snapshot_name(value)
        if normalized is None or normalized in seen_snapshot_names:
            continue
        deduped_snapshot_names.append(value.strip())
        seen_snapshot_names.add(normalized)

    return deduped_snapshot_names


def _augment_snapshot_names_with_expected_live_snapshot(
    *,
    snapshot_names: list[str],
    codex_auth_status: AccountCodexAuthStatus | None,
    available_snapshot_names: set[str],
) -> list[str]:
    expected_snapshot_name = (
        codex_auth_status.expected_snapshot_name
        if codex_auth_status is not None
        else None
    )
    normalized_expected_snapshot_name = _normalize_snapshot_name(expected_snapshot_name)
    if normalized_expected_snapshot_name is None:
        return snapshot_names

    normalized_available_snapshot_names = {
        normalized_snapshot_name
        for normalized_snapshot_name in (
            _normalize_snapshot_name(snapshot_name)
            for snapshot_name in available_snapshot_names
        )
        if normalized_snapshot_name is not None
    }
    if normalized_expected_snapshot_name not in normalized_available_snapshot_names:
        return snapshot_names

    if any(
        _normalize_snapshot_name(snapshot_name) == normalized_expected_snapshot_name
        for snapshot_name in snapshot_names
    ):
        return snapshot_names

    return [*snapshot_names, expected_snapshot_name.strip()]


def _resolve_first_matching_snapshot_name(
    *,
    snapshot_names: list[str],
    candidate_snapshot_names: Iterable[str],
) -> str | None:
    normalized_candidate_snapshot_names: dict[str, str] = {}
    for candidate_snapshot_name in candidate_snapshot_names:
        normalized_candidate_snapshot_name = _normalize_snapshot_name(
            candidate_snapshot_name
        )
        if normalized_candidate_snapshot_name is None:
            continue
        normalized_candidate_snapshot_names.setdefault(
            normalized_candidate_snapshot_name,
            candidate_snapshot_name,
        )

    for snapshot_name in snapshot_names:
        normalized = _normalize_snapshot_name(snapshot_name)
        if normalized is None:
            continue
        matched_candidate_snapshot_name = normalized_candidate_snapshot_names.get(
            normalized
        )
        if matched_candidate_snapshot_name is not None:
            return matched_candidate_snapshot_name

    return None


def _resolve_session_task_previews_for_snapshot_names(
    *,
    process_session_task_previews_by_snapshot: dict[str, list[AccountSessionTaskPreview]],
    snapshot_names: list[str],
) -> list[AccountSessionTaskPreview]:
    merged_session_task_previews: list[AccountSessionTaskPreview] = []
    seen_session_keys: set[str] = set()

    for snapshot_name in snapshot_names:
        for mapped_snapshot_name, mapped_previews in process_session_task_previews_by_snapshot.items():
            if _normalize_snapshot_name(mapped_snapshot_name) != _normalize_snapshot_name(
                snapshot_name
            ):
                continue
            for preview in mapped_previews:
                normalized_session_key = preview.session_key.strip()
                if not normalized_session_key or normalized_session_key in seen_session_keys:
                    continue
                seen_session_keys.add(normalized_session_key)
                merged_session_task_previews.append(preview)

    return merged_session_task_previews


def _read_live_process_task_preview_state_by_snapshot(
    *,
    previews_by_snapshot: dict[str, LocalCodexTaskPreview],
) -> tuple[
    dict[str, str],
    set[str],
    dict[str, int],
    dict[str, list[AccountSessionTaskPreview]],
]:
    attribution = read_live_codex_process_session_attribution()
    mapped_session_pids_by_snapshot = {
        snapshot_name: sorted(set(session_pids))
        for snapshot_name, session_pids in attribution.mapped_session_pids_by_snapshot.items()
    }
    task_previews_by_pid = (
        attribution.task_previews_by_pid
        if attribution.task_previews_by_pid
        else {
            pid: [preview]
            for pid, preview in attribution.task_preview_by_pid.items()
            if isinstance(preview, str) and preview.strip()
        }
    )

    if previews_by_snapshot:
        snapshot_names_by_task_preview = _build_snapshot_names_by_task_preview(
            previews_by_snapshot
        )
        if snapshot_names_by_task_preview:
            for pid in attribution.unattributed_session_pids:
                session_previews = [
                    normalized_preview
                    for normalized_preview in (
                        _normalize_task_preview_match_text(preview)
                        for preview in task_previews_by_pid.get(pid, [])
                    )
                    if normalized_preview
                ]
                inferred_snapshot_name = _infer_snapshot_name_from_session_task_previews(
                    session_previews=session_previews,
                    snapshot_names_by_task_preview=snapshot_names_by_task_preview,
                )
                if inferred_snapshot_name is None:
                    continue
                mapped_session_pids_by_snapshot.setdefault(inferred_snapshot_name, []).append(pid)

            # Keep fallback-mapped sessions pinned to their backend owner.
            # Backend attribution already applies pre-switch ownership guardrails
            # (registry previous-active snapshot, rollout/session caches, and
            # start-time checks). Reassigning those sessions here based on task
            # preview text can remap long-running old-account sessions into a
            # newly selected account when users send similar prompts after
            # clicking "Use this account".

    for snapshot_name, session_pids in mapped_session_pids_by_snapshot.items():
        mapped_session_pids_by_snapshot[snapshot_name] = sorted(set(session_pids))
    mapped_session_pids_by_snapshot = {
        snapshot_name: session_pids
        for snapshot_name, session_pids in mapped_session_pids_by_snapshot.items()
        if session_pids
    }

    preview_by_snapshot: dict[str, str] = {}
    waiting_snapshots: set[str] = set()
    waiting_session_counts_by_snapshot: dict[str, int] = {}
    session_task_previews_by_snapshot: dict[str, list[AccountSessionTaskPreview]] = {}

    for snapshot_name, session_pids in mapped_session_pids_by_snapshot.items():
        first_preview: str | None = None
        session_task_previews: list[AccountSessionTaskPreview] = []
        for pid in session_pids:
            pid_previews = task_previews_by_pid.get(pid, [])
            normalized_task_preview = next(
                (preview.strip() for preview in pid_previews if preview.strip()),
                None,
            )
            project_name, project_path = _resolve_project_metadata_for_pid(pid)
            session_task_previews.append(
                AccountSessionTaskPreview(
                    session_key=f"pid:{pid}",
                    task_preview=normalized_task_preview,
                    task_updated_at=None,
                    project_name=project_name,
                    project_path=project_path,
                )
            )
            for preview in task_previews_by_pid.get(pid, []):
                normalized_preview = preview.strip()
                if not normalized_preview:
                    continue
                if first_preview is None:
                    first_preview = normalized_preview
                break
        session_task_previews_by_snapshot[snapshot_name] = session_task_previews

        if first_preview:
            preview_by_snapshot[snapshot_name] = first_preview
            continue

        waiting_snapshots.add(snapshot_name)
        waiting_session_counts_by_snapshot[snapshot_name] = len(session_pids)

    return (
        preview_by_snapshot,
        waiting_snapshots,
        waiting_session_counts_by_snapshot,
        session_task_previews_by_snapshot,
    )


def _build_snapshot_names_by_task_preview(
    previews_by_snapshot: dict[str, LocalCodexTaskPreview],
) -> dict[str, set[str]]:
    snapshot_names_by_task_preview: dict[str, set[str]] = {}
    for snapshot_name, task_preview in previews_by_snapshot.items():
        normalized_preview = _normalize_task_preview_match_text(task_preview.text)
        if normalized_preview is None:
            continue
        snapshot_names_by_task_preview.setdefault(normalized_preview, set()).add(snapshot_name)
    return snapshot_names_by_task_preview


def _infer_snapshot_name_from_session_task_previews(
    *,
    session_previews: list[str],
    snapshot_names_by_task_preview: dict[str, set[str]],
) -> str | None:
    matched_snapshot_names: set[str] = set()
    for preview in session_previews:
        matched_snapshot_names.update(snapshot_names_by_task_preview.get(preview, set()))
    if len(matched_snapshot_names) != 1:
        return None
    return next(iter(matched_snapshot_names))


def _normalize_task_preview_match_text(value: str | None) -> str | None:
    normalized = " ".join((value or "").strip().split())
    if not normalized:
        return None
    if normalized.lower() == _WAITING_FOR_NEW_TASK_PREVIEW.lower():
        return None
    return normalized.lower()


def _resolve_waiting_snapshot_last_preview(
    *,
    snapshot_name: str,
    has_single_waiting_live_session: bool,
    debug: AccountLiveQuotaDebug | None,
    previews_by_session_id: dict[str, LocalCodexTaskPreview],
) -> LocalCodexTaskPreview | None:
    if not has_single_waiting_live_session:
        return None

    preview_from_source = _resolve_preview_from_debug_sources(
        debug=debug,
        previews_by_session_id=previews_by_session_id,
        snapshot_name=snapshot_name,
    )
    return preview_from_source


def _resolve_preview_from_debug_sources(
    *,
    debug: AccountLiveQuotaDebug | None,
    previews_by_session_id: dict[str, LocalCodexTaskPreview],
    snapshot_name: str | None,
) -> LocalCodexTaskPreview | None:
    if debug is None or not debug.raw_samples:
        return None

    normalized_snapshot_name = _normalize_snapshot_name(snapshot_name)
    best_preview: LocalCodexTaskPreview | None = None

    for allow_stale in (False, True):
        for sample in debug.raw_samples:
            if not allow_stale and sample.stale:
                continue
            if normalized_snapshot_name is not None:
                sample_snapshot_name = _normalize_snapshot_name(sample.snapshot_name)
                if sample_snapshot_name != normalized_snapshot_name:
                    continue

            source_name = sample.source.rsplit("/", 1)[-1]
            source_match = _ROLLOUT_SESSION_FILE_RE.match(source_name)
            if source_match is None:
                continue
            session_id = source_match.group("session")

            preview = previews_by_session_id.get(session_id)
            if preview is None:
                continue
            if best_preview is None or preview.recorded_at > best_preview.recorded_at:
                best_preview = preview

        if best_preview is not None:
            return best_preview

    return None


def _resolve_session_task_previews_from_debug_sources(
    *,
    debug: AccountLiveQuotaDebug | None,
    previews_by_session_id: dict[str, LocalCodexTaskPreview],
    snapshot_name: str | None,
) -> list[AccountSessionTaskPreview]:
    if debug is None or not debug.raw_samples:
        return []

    normalized_snapshot_name = _normalize_snapshot_name(snapshot_name)
    previews_by_session: dict[str, AccountSessionTaskPreview] = {}

    for allow_stale in (False, True):
        for sample in debug.raw_samples:
            if not allow_stale and sample.stale:
                continue
            if normalized_snapshot_name is not None:
                sample_snapshot_name = _normalize_snapshot_name(sample.snapshot_name)
                if sample_snapshot_name != normalized_snapshot_name:
                    continue

            source_name = sample.source.rsplit("/", 1)[-1]
            source_match = _ROLLOUT_SESSION_FILE_RE.match(source_name)
            if source_match is None:
                continue
            session_id = source_match.group("session")
            if session_id in previews_by_session:
                continue

            preview = previews_by_session_id.get(session_id)
            if preview is None:
                continue
            preview_text = preview.text.strip()
            if not preview_text:
                continue

            previews_by_session[session_id] = AccountSessionTaskPreview(
                session_key=session_id,
                task_preview=preview_text,
                task_updated_at=preview.recorded_at,
            )

        if previews_by_session:
            break

    return sorted(
        previews_by_session.values(),
        key=lambda preview: (
            preview.task_updated_at.timestamp()
            if preview.task_updated_at is not None
            else float("-inf"),
            preview.session_key,
        ),
        reverse=True,
    )


def _normalize_snapshot_name(value: str | None) -> str | None:
    normalized = (value or "").strip().lower()
    return normalized or None


def _resolve_project_metadata_for_pid(pid: int) -> tuple[str | None, str | None]:
    project_path = _resolve_process_cwd(pid)
    if project_path is None:
        return (None, None)
    project_name = _project_name_from_path(project_path)
    return (project_name, project_path)


def _resolve_process_cwd(pid: int) -> str | None:
    cwd_symlink = Path("/proc") / str(pid) / "cwd"
    try:
        return str(Path(os.readlink(cwd_symlink)).resolve())
    except OSError:
        return None


def _project_name_from_path(project_path: str | None) -> str | None:
    if project_path is None:
        return None
    normalized = project_path.strip()
    if not normalized:
        return None
    return Path(normalized).name or None
