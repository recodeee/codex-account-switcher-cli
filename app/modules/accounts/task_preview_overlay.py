from __future__ import annotations

from datetime import datetime
import re

from app.db.models import Account
from app.modules.accounts.codex_live_usage import (
    LocalCodexTaskPreview,
    read_live_codex_process_session_attribution,
    read_local_codex_task_previews_by_session_id,
    read_local_codex_task_previews_by_snapshot,
)
from app.modules.accounts.live_usage_overrides import has_recently_terminated_cli_session_snapshot
from app.modules.accounts.schemas import AccountCodexAuthStatus, AccountLiveQuotaDebug

_ROLLOUT_SESSION_FILE_RE = re.compile(
    r"^rollout-(?P<start>\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(?P<session>[0-9a-fA-F-]{36})\.jsonl$"
)
_WAITING_FOR_NEW_TASK_PREVIEW = "Waiting for new task"


def overlay_live_codex_task_previews(
    *,
    accounts: list[Account],
    codex_auth_by_account: dict[str, AccountCodexAuthStatus],
    codex_current_task_preview_by_account: dict[str, str],
    codex_last_task_preview_by_account: dict[str, str],
    live_quota_debug_by_account: dict[str, AccountLiveQuotaDebug] | None,
    now: datetime,
) -> None:
    previews_by_snapshot = read_local_codex_task_previews_by_snapshot(now=now)
    previews_by_session_id = read_local_codex_task_previews_by_session_id(now=now)
    (
        process_preview_by_snapshot,
        waiting_process_snapshots,
        waiting_process_session_counts_by_snapshot,
    ) = (
        _read_live_process_task_preview_state_by_snapshot()
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
        if snapshot_name:
            process_preview = process_preview_by_snapshot.get(snapshot_name)
            if process_preview:
                codex_current_task_preview_by_account[account.id] = process_preview
                continue
            if snapshot_name in waiting_process_snapshots:
                codex_current_task_preview_by_account[account.id] = _WAITING_FOR_NEW_TASK_PREVIEW
                waiting_last_preview = _resolve_waiting_snapshot_last_preview(
                    snapshot_name=snapshot_name,
                    has_single_waiting_live_session=(
                        waiting_process_session_counts_by_snapshot.get(snapshot_name, 0) == 1
                    ),
                    debug=live_quota_debug_by_account.get(account.id)
                    if live_quota_debug_by_account is not None
                    else None,
                    previews_by_snapshot=previews_by_snapshot,
                    previews_by_session_id=previews_by_session_id,
                )
                if waiting_last_preview is not None:
                    codex_last_task_preview_by_account[account.id] = waiting_last_preview.text
                continue
            if has_recently_terminated_cli_session_snapshot(
                [snapshot_name],
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


def _read_live_process_task_preview_state_by_snapshot() -> tuple[dict[str, str], set[str], dict[str, int]]:
    attribution = read_live_codex_process_session_attribution()
    task_previews_by_pid = (
        attribution.task_previews_by_pid
        if attribution.task_previews_by_pid
        else {
            pid: [preview]
            for pid, preview in attribution.task_preview_by_pid.items()
            if isinstance(preview, str) and preview.strip()
        }
    )

    preview_by_snapshot: dict[str, str] = {}
    waiting_snapshots: set[str] = set()
    waiting_session_counts_by_snapshot: dict[str, int] = {}

    for snapshot_name, session_pids in attribution.mapped_session_pids_by_snapshot.items():
        first_preview: str | None = None
        for pid in session_pids:
            for preview in task_previews_by_pid.get(pid, []):
                normalized_preview = preview.strip()
                if not normalized_preview:
                    continue
                first_preview = normalized_preview
                break
            if first_preview:
                break

        if first_preview:
            preview_by_snapshot[snapshot_name] = first_preview
            continue

        waiting_snapshots.add(snapshot_name)
        waiting_session_counts_by_snapshot[snapshot_name] = len(session_pids)

    return preview_by_snapshot, waiting_snapshots, waiting_session_counts_by_snapshot


def _resolve_waiting_snapshot_last_preview(
    *,
    snapshot_name: str,
    has_single_waiting_live_session: bool,
    debug: AccountLiveQuotaDebug | None,
    previews_by_snapshot: dict[str, LocalCodexTaskPreview],
    previews_by_session_id: dict[str, LocalCodexTaskPreview],
) -> LocalCodexTaskPreview | None:
    if not has_single_waiting_live_session:
        return None

    preview_from_source = _resolve_preview_from_debug_sources(
        debug=debug,
        previews_by_session_id=previews_by_session_id,
        snapshot_name=snapshot_name,
    )
    if preview_from_source is not None:
        return preview_from_source

    preview_from_snapshot = previews_by_snapshot.get(snapshot_name)
    if preview_from_snapshot is None:
        return None
    if preview_from_snapshot.text.strip() == _WAITING_FOR_NEW_TASK_PREVIEW:
        return None
    return preview_from_snapshot


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


def _normalize_snapshot_name(value: str | None) -> str | None:
    normalized = (value or "").strip().lower()
    return normalized or None
