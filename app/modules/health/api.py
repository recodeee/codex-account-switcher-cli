from __future__ import annotations

import re
from datetime import timedelta
from hashlib import sha256
from html import escape
from typing import Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import select as sa_select
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config.settings import get_settings
from app.core.utils.time import utcnow
from app.db.models import BridgeRingMember
from app.modules.accounts.codex_auth_switcher import (
    build_email_snapshot_name,
    build_snapshot_index,
    resolve_snapshot_name_candidates_for_account,
    resolve_snapshot_names_for_account,
    select_snapshot_name,
)
from app.modules.accounts.codex_live_usage import (
    read_live_codex_process_session_attribution,
    read_live_codex_process_session_counts_by_snapshot,
    read_local_codex_task_previews_by_snapshot,
    read_runtime_live_session_counts_by_snapshot,
)
from app.modules.accounts.repository import AccountsRepository
from app.db.session import get_session
from app.modules.health.schemas import BridgeRingInfo, HealthCheckResponse, HealthResponse
from app.modules.proxy.ring_membership import RING_STALE_THRESHOLD_SECONDS

router = APIRouter(tags=["health"])
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
_TASK_PREVIEW_OMX_EXPLORE_HEADER_RE = re.compile(
    r"(?is)\byou\s+are\s+omx\s+explore\b"
)
_TASK_PREVIEW_OMX_EXPLORE_USER_REQUEST_RE = re.compile(
    r"(?is)\buser request:\s*(.+)$"
)


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/health/live", response_model=HealthCheckResponse)
async def health_live() -> HealthCheckResponse:
    return HealthCheckResponse(status="ok")


def _python_layer_check(status_code: int | None, ok: bool, detail: str) -> dict[str, int | bool | str | None]:
    return {
        "status_code": status_code,
        "ok": ok,
        "detail": detail,
    }


@router.get("/_rust_layer/info")
async def python_runtime_info() -> dict[str, str]:
    settings = get_settings()
    profile = getattr(settings, "environment", None) or "python"
    return {
        "service": "codex-lb-python-runtime",
        "language": "python",
        "version": "python",
        "profile": str(profile),
    }


@router.get("/_python_layer/health")
async def python_layer_health() -> dict[str, str | dict[str, dict[str, int | bool | str | None]]]:
    checks: dict[str, dict[str, int | bool | str | None]] = {}
    degraded = False

    health_checks: tuple[tuple[str, Callable[[], Awaitable[object]]], ...] = (
        ("/health", health_check),
        ("/health/live", health_live),
        ("/health/ready", health_ready),
        ("/health/startup", health_startup),
    )
    for endpoint, check_fn in health_checks:
        try:
            await check_fn()
            checks[endpoint] = _python_layer_check(200, True, "ok")
        except HTTPException as exc:
            degraded = True
            checks[endpoint] = _python_layer_check(
                exc.status_code,
                False,
                str(exc.detail) if exc.detail else "request failed",
            )
        except Exception as exc:
            degraded = True
            checks[endpoint] = _python_layer_check(None, False, f"{type(exc).__name__}: request failed")

    return {
        "status": "degraded" if degraded else "ok",
        "python_base_url": "http://127.0.0.1",
        "checks": checks,
    }


@router.get("/_python_layer/apis")
async def python_layer_apis(request: Request) -> dict[str, str | list[str] | None]:
    paths = sorted(request.app.openapi().get("paths", {}).keys())
    return {
        "status": "ok",
        "python_base_url": "http://127.0.0.1",
        "source": "openapi.json",
        "paths": paths,
        "detail": None,
    }


@router.get("/live_usage")
async def live_usage() -> Response:
    attribution = read_live_codex_process_session_attribution()
    counts_by_snapshot_raw = attribution.counts_by_snapshot
    unattributed_session_pids = attribution.unattributed_session_pids
    mapped_session_pids_by_snapshot_raw = attribution.mapped_session_pids_by_snapshot
    fallback_mapped_session_pids_by_snapshot_raw = (
        attribution.fallback_mapped_session_pids_by_snapshot
    )
    task_preview_by_pid = attribution.task_preview_by_pid
    snapshot_alias_map = await _read_live_usage_snapshot_alias_map()
    mapped_session_pids_by_snapshot: dict[str, list[int]] = {}
    for snapshot_name, session_pids in mapped_session_pids_by_snapshot_raw.items():
        target_snapshot_name = snapshot_alias_map.get(snapshot_name, snapshot_name)
        mapped_session_pids_by_snapshot.setdefault(target_snapshot_name, []).extend(session_pids)
    for snapshot_name, session_pids in mapped_session_pids_by_snapshot.items():
        mapped_session_pids_by_snapshot[snapshot_name] = sorted(set(session_pids))
    fallback_mapped_session_pids_by_snapshot: dict[str, list[int]] = {}
    for snapshot_name, session_pids in fallback_mapped_session_pids_by_snapshot_raw.items():
        target_snapshot_name = snapshot_alias_map.get(snapshot_name, snapshot_name)
        fallback_mapped_session_pids_by_snapshot.setdefault(
            target_snapshot_name, []
        ).extend(session_pids)
    for snapshot_name, session_pids in fallback_mapped_session_pids_by_snapshot.items():
        fallback_mapped_session_pids_by_snapshot[snapshot_name] = sorted(set(session_pids))

    counts_by_snapshot: dict[str, int] = {
        snapshot_name: len(session_pids)
        for snapshot_name, session_pids in mapped_session_pids_by_snapshot.items()
    }
    for snapshot_name, raw_count in counts_by_snapshot_raw.items():
        target_snapshot_name = snapshot_alias_map.get(snapshot_name, snapshot_name)
        counts_by_snapshot[target_snapshot_name] = max(
            counts_by_snapshot.get(target_snapshot_name, 0),
            max(0, raw_count),
        )
    task_previews_by_pid = (
        attribution.task_previews_by_pid
        if attribution.task_previews_by_pid
        else {
            pid: [preview]
            for pid, preview in task_preview_by_pid.items()
            if _normalize_task_preview(preview)
        }
    )
    raw_task_previews_by_snapshot = await _read_live_usage_task_previews_by_snapshot()
    task_previews_by_snapshot: dict[str, list[_LiveUsageTaskPreview]] = {}
    for snapshot_name, task_previews in raw_task_previews_by_snapshot.items():
        target_snapshot_name = snapshot_alias_map.get(snapshot_name, snapshot_name)
        existing = task_previews_by_snapshot.setdefault(target_snapshot_name, [])
        existing_pairs = {(preview.account_id, preview.preview) for preview in existing}
        for task_preview in task_previews:
            key = (task_preview.account_id, task_preview.preview)
            if key in existing_pairs:
                continue
            existing.append(task_preview)
            existing_pairs.add(key)
    for previews in task_previews_by_snapshot.values():
        previews.sort(key=lambda preview: preview.account_id)
    raw_account_emails_by_snapshot = await _read_live_usage_account_emails_by_snapshot()
    account_emails_by_snapshot_sets: dict[str, set[str]] = {}
    for snapshot_name, account_emails in raw_account_emails_by_snapshot.items():
        target_snapshot_name = snapshot_alias_map.get(snapshot_name, snapshot_name)
        emails_for_snapshot = account_emails_by_snapshot_sets.setdefault(
            target_snapshot_name, set()
        )
        for account_email in account_emails:
            normalized_email = account_email.strip().lower()
            if normalized_email:
                emails_for_snapshot.add(normalized_email)
    account_emails_by_snapshot: dict[str, list[str]] = {
        snapshot_name: sorted(snapshot_emails)
        for snapshot_name, snapshot_emails in account_emails_by_snapshot_sets.items()
    }

    if task_previews_by_snapshot:
        snapshot_names_by_task_preview = _build_snapshot_names_by_task_preview(
            task_previews_by_snapshot
        )
        if snapshot_names_by_task_preview:
            reattributed_unattributed_session_pids: list[int] = []
            for pid in unattributed_session_pids:
                session_previews = [
                    normalized
                    for normalized in (
                        _normalize_task_preview(preview)
                        for preview in task_previews_by_pid.get(pid, [])
                    )
                    if normalized
                ]
                inferred_snapshot_name = _infer_snapshot_name_from_session_task_previews(
                    session_previews=session_previews,
                    snapshot_names_by_task_preview=snapshot_names_by_task_preview,
                )
                if inferred_snapshot_name is None:
                    reattributed_unattributed_session_pids.append(pid)
                    continue

                mapped_session_pids_by_snapshot.setdefault(
                    inferred_snapshot_name, []
                ).append(pid)

            fallback_snapshot_name_by_pid = {
                pid: snapshot_name
                for snapshot_name, session_pids in fallback_mapped_session_pids_by_snapshot.items()
                for pid in session_pids
            }
            for pid, current_snapshot_name in fallback_snapshot_name_by_pid.items():
                session_previews = [
                    normalized
                    for normalized in (
                        _normalize_task_preview(preview)
                        for preview in task_previews_by_pid.get(pid, [])
                    )
                    if normalized
                ]
                inferred_snapshot_name = _infer_snapshot_name_from_session_task_previews(
                    session_previews=session_previews,
                    snapshot_names_by_task_preview=snapshot_names_by_task_preview,
                )
                if (
                    inferred_snapshot_name is None
                    or inferred_snapshot_name == current_snapshot_name
                ):
                    continue

                mapped_session_pids_by_snapshot[current_snapshot_name] = [
                    candidate_pid
                    for candidate_pid in mapped_session_pids_by_snapshot.get(
                        current_snapshot_name, []
                    )
                    if candidate_pid != pid
                ]
                mapped_session_pids_by_snapshot.setdefault(
                    inferred_snapshot_name, []
                ).append(pid)

            unattributed_session_pids = reattributed_unattributed_session_pids
            for snapshot_name, session_pids in mapped_session_pids_by_snapshot.items():
                normalized_session_pids = sorted(set(session_pids))
                mapped_session_pids_by_snapshot[snapshot_name] = normalized_session_pids
            mapped_session_pids_by_snapshot = {
                snapshot_name: session_pids
                for snapshot_name, session_pids in mapped_session_pids_by_snapshot.items()
                if session_pids
            }
            counts_by_snapshot = {
                snapshot_name: len(session_pids)
                for snapshot_name, session_pids in mapped_session_pids_by_snapshot.items()
            }

    session_task_previews_by_snapshot: dict[str, dict[int, list[str]]] = {}
    mapped_session_task_preview_count = 0
    for snapshot_name, session_pids in mapped_session_pids_by_snapshot.items():
        previews_for_snapshot: dict[int, list[str]] = {}
        for pid in session_pids:
            session_preview_list = [
                normalized
                for normalized in (
                    _normalize_task_preview(preview)
                    for preview in task_previews_by_pid.get(pid, [])
                )
                if normalized
            ]
            previews_for_snapshot[pid] = session_preview_list
            mapped_session_task_preview_count += len(session_preview_list)
        session_task_previews_by_snapshot[snapshot_name] = previews_for_snapshot

    unattributed_session_task_previews_by_pid = {
        pid: [
            normalized
            for normalized in (
                _normalize_task_preview(preview)
                for preview in task_previews_by_pid.get(pid, [])
            )
            if normalized
        ]
        for pid in unattributed_session_pids
    }
    unattributed_session_task_preview_count = sum(
        len(previews) for previews in unattributed_session_task_previews_by_pid.values()
    )

    generated_at = utcnow().isoformat() + "Z"
    total_mapped_sessions = sum(max(0, count) for count in counts_by_snapshot.values())
    total_unattributed_sessions = len(unattributed_session_pids)
    total_sessions = total_mapped_sessions + total_unattributed_sessions

    effective_task_previews_by_snapshot: dict[str, list[_LiveUsageTaskPreview]] = {}
    for snapshot_name in (
        set(task_previews_by_snapshot.keys()) | set(session_task_previews_by_snapshot.keys())
    ):
        session_pids = mapped_session_pids_by_snapshot.get(snapshot_name, [])
        session_task_previews = session_task_previews_by_snapshot.get(snapshot_name, {})
        existing_task_previews = list(task_previews_by_snapshot.get(snapshot_name, []))

        if not session_pids:
            effective_task_previews_by_snapshot[snapshot_name] = existing_task_previews
            continue

        derived_preview_texts: list[str] = []
        seen_preview_texts: set[str] = set()
        for pid in session_pids:
            for preview in session_task_previews.get(pid, []):
                if preview in seen_preview_texts:
                    continue
                seen_preview_texts.add(preview)
                derived_preview_texts.append(preview)

        # For snapshots that currently own live sessions, only emit previews
        # observed from those live sessions so stale persisted account previews
        # cannot be misattributed in the XML feed.
        if not derived_preview_texts:
            effective_task_previews_by_snapshot[snapshot_name] = []
            continue

        task_previews_for_snapshot = [
            task_preview
            for task_preview in existing_task_previews
            if task_preview.preview in seen_preview_texts
        ]
        existing_preview_texts = {
            task_preview.preview for task_preview in task_previews_for_snapshot
        }
        for preview in derived_preview_texts:
            if preview in existing_preview_texts:
                continue
            task_previews_for_snapshot.append(
                _LiveUsageTaskPreview(
                    account_id="session",
                    preview=preview,
                )
            )

        task_previews_for_snapshot.sort(key=lambda task_preview: task_preview.account_id)
        effective_task_previews_by_snapshot[snapshot_name] = task_previews_for_snapshot

    waiting_last_task_preview_by_snapshot = {
        snapshot_name: preview
        for snapshot_name, preview in (
            (
                snapshot_name,
                _resolve_unique_waiting_last_task_preview(task_previews),
            )
            for snapshot_name, task_previews in task_previews_by_snapshot.items()
        )
        if preview
    }

    total_account_task_previews = sum(
        len(task_previews) for task_previews in effective_task_previews_by_snapshot.values()
    )
    total_session_task_previews = (
        mapped_session_task_preview_count + unattributed_session_task_preview_count
    )
    total_task_previews = max(total_account_task_previews, total_session_task_previews)

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<live_usage"
        f' generated_at="{escape(generated_at, quote=True)}"'
        f' total_sessions="{total_sessions}"'
        f' mapped_sessions="{total_mapped_sessions}"'
        f' unattributed_sessions="{total_unattributed_sessions}"'
        f' total_task_previews="{total_task_previews}"'
        f' account_task_previews="{total_account_task_previews}"'
        f' session_task_previews="{total_session_task_previews}"'
        ">",
    ]
    snapshot_names = sorted(
        set(counts_by_snapshot.keys())
        | set(effective_task_previews_by_snapshot.keys())
        | set(account_emails_by_snapshot.keys()),
        key=lambda snapshot_name: (
            -max(0, counts_by_snapshot.get(snapshot_name, 0)),
            -len(effective_task_previews_by_snapshot.get(snapshot_name, [])),
            snapshot_name,
        ),
    )
    for snapshot_name in snapshot_names:
        session_count = max(0, counts_by_snapshot.get(snapshot_name, 0))
        session_pids = mapped_session_pids_by_snapshot.get(snapshot_name, [])
        session_task_previews = session_task_previews_by_snapshot.get(snapshot_name, {})
        session_task_preview_count = sum(
            len(session_task_previews.get(pid, [])) for pid in session_pids
        )
        task_previews = effective_task_previews_by_snapshot.get(snapshot_name, [])
        account_emails = account_emails_by_snapshot.get(snapshot_name, [])
        sanitized_snapshot_name = escape(snapshot_name, quote=True)
        account_emails_attribute = (
            f' account_emails="{escape(",".join(account_emails), quote=True)}"'
            if account_emails
            else ""
        )
        if not task_previews and not session_pids:
            lines.append(
                f'  <snapshot name="{sanitized_snapshot_name}" session_count="{session_count}"{account_emails_attribute} />'
            )
            continue

        task_preview_count_attribute = (
            f' task_preview_count="{len(task_previews)}"' if task_previews else ""
        )
        lines.append(
            f'  <snapshot name="{sanitized_snapshot_name}" session_count="{session_count}"'
            f'{task_preview_count_attribute}'
            f' session_row_count="{len(session_pids)}"'
            f' session_task_preview_count="{session_task_preview_count}"'
            f'{account_emails_attribute}>'
        )
        for task_preview in task_previews:
            lines.append(
                "    <task_preview"
                f' account_id="{escape(task_preview.account_id, quote=True)}"'
                f' preview="{escape(task_preview.preview, quote=True)}"'
                " />"
            )
        for pid in session_pids:
            previews = session_task_previews.get(pid, [])
            if not previews:
                last_task_preview = _resolve_session_waiting_last_task_preview(
                    pid=pid,
                    session_pids=session_pids,
                    session_task_previews=session_task_previews,
                    snapshot_last_task_preview=waiting_last_task_preview_by_snapshot.get(snapshot_name),
                )
                last_task_preview_attribute = (
                    f' last_task_preview="{escape(last_task_preview, quote=True)}"'
                    if last_task_preview
                    else ""
                )
                lines.append(
                    f'    <session pid="{pid}" state="waiting_for_new_task"{last_task_preview_attribute} />'
                )
                continue
            if len(previews) == 1:
                lines.append(
                    f'    <session pid="{pid}" task_preview="{escape(previews[0], quote=True)}" />'
                )
                continue
            lines.append(
                f'    <session pid="{pid}" task_preview="{escape(previews[0], quote=True)}" task_count="{len(previews)}">'
            )
            for preview in previews:
                lines.append(f'      <task preview="{escape(preview, quote=True)}" />')
            lines.append("    </session>")
        lines.append("  </snapshot>")
    if unattributed_session_pids:
        lines.append(
            f'  <unattributed_sessions count="{len(unattributed_session_pids)}"'
            f' task_preview_count="{unattributed_session_task_preview_count}">'
        )
        for pid in unattributed_session_pids:
            previews = unattributed_session_task_previews_by_pid.get(pid, [])
            if not previews:
                lines.append(f'    <session pid="{pid}" state="waiting_for_new_task" />')
                continue
            if len(previews) == 1:
                lines.append(
                    f'    <session pid="{pid}" task_preview="{escape(previews[0], quote=True)}" />'
                )
                continue
            lines.append(
                f'    <session pid="{pid}" task_preview="{escape(previews[0], quote=True)}" task_count="{len(previews)}">'
            )
            for preview in previews:
                lines.append(f'      <task preview="{escape(preview, quote=True)}" />')
            lines.append("    </session>")
        lines.append("  </unattributed_sessions>")
    lines.append("</live_usage>")

    return Response(
        content="\n".join(lines),
        media_type="application/xml",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/live_usage/mapping")
async def live_usage_mapping(
    session: AsyncSession = Depends(get_session),
    minimal: bool = False,
) -> Response:
    generated_at = utcnow().isoformat() + "Z"
    snapshot_index = build_snapshot_index()
    process_counts_by_snapshot = read_live_codex_process_session_counts_by_snapshot()
    runtime_counts_by_snapshot = read_runtime_live_session_counts_by_snapshot()

    repository = AccountsRepository(session)
    accounts = await repository.list_accounts()
    account_ids = [account.id for account in accounts]
    tracked_session_counts = await repository.list_codex_session_counts_by_account(
        account_ids=account_ids,
    )
    task_previews = await repository.list_codex_current_task_preview_by_account(
        account_ids=account_ids,
    )
    live_snapshot_names = set(process_counts_by_snapshot) | set(runtime_counts_by_snapshot)

    mapped_snapshot_names: set[str] = set()
    working_now_count = 0
    account_lines: list[str] = []

    for account in accounts:
        snapshot_candidates = resolve_snapshot_names_for_account(
            snapshot_index=snapshot_index,
            account_id=account.id,
            chatgpt_account_id=account.chatgpt_account_id,
            email=account.email,
        )
        selected_snapshot_name = _select_effective_live_snapshot_name(
            snapshot_candidates=snapshot_candidates,
            active_snapshot_name=snapshot_index.active_snapshot_name,
            account_email=account.email,
            live_snapshot_names=live_snapshot_names,
        )
        mapped_snapshot_names.update(snapshot_candidates)
        if selected_snapshot_name:
            mapped_snapshot_names.add(selected_snapshot_name)

        process_session_count = (
            max(0, process_counts_by_snapshot.get(selected_snapshot_name, 0))
            if selected_snapshot_name
            else 0
        )
        runtime_session_count = (
            max(0, runtime_counts_by_snapshot.get(selected_snapshot_name, 0))
            if selected_snapshot_name
            else 0
        )
        # Process and runtime counts can describe the same live CLI session
        # inventory from different collectors, so use max() instead of sum()
        # to avoid double-counting during fresh telemetry transitions.
        total_session_count = max(process_session_count, runtime_session_count)
        tracked_session_count = max(0, tracked_session_counts.get(account.id, 0))
        normalized_task_preview = _normalize_task_preview(task_previews.get(account.id))
        has_task_preview = bool(normalized_task_preview)
        has_cli_signal = (
            process_session_count > 0
            or runtime_session_count > 0
            or tracked_session_count > 0
            or has_task_preview
        )
        status_value = (
            account.status.value
            if hasattr(account.status, "value")
            else str(account.status)
        )
        is_working_now = has_cli_signal and status_value != "deactivated"
        if is_working_now:
            working_now_count += 1

        is_active_snapshot = bool(
            selected_snapshot_name
            and snapshot_index.active_snapshot_name
            and selected_snapshot_name == snapshot_index.active_snapshot_name
        )

        if minimal:
            account_lines.append(
                "  <account"
                f' account_id="{escape(account.id, quote=True)}"'
                f' mapped_snapshot="{escape(selected_snapshot_name or "", quote=True)}"'
                f' process_session_count="{process_session_count}"'
                f' runtime_session_count="{runtime_session_count}"'
                f' total_session_count="{total_session_count}"'
                f' has_cli_signal="{_xml_bool(has_cli_signal)}"'
                f' working_now="{_xml_bool(is_working_now)}"'
                " />"
            )
        else:
            account_lines.append(
                "  <account"
                f' account_id="{escape(account.id, quote=True)}"'
                f' email="{escape(account.email, quote=True)}"'
                f' status="{escape(status_value, quote=True)}"'
                f' expected_snapshot="{escape(build_email_snapshot_name(account.email), quote=True)}"'
                f' mapped_snapshot="{escape(selected_snapshot_name or "", quote=True)}"'
                f' snapshot_candidates="{escape(",".join(snapshot_candidates), quote=True)}"'
                f' process_session_count="{process_session_count}"'
                f' runtime_session_count="{runtime_session_count}"'
                f' total_session_count="{total_session_count}"'
                f' tracked_session_count="{tracked_session_count}"'
                f' has_task_preview="{_xml_bool(has_task_preview)}"'
                f' has_cli_signal="{_xml_bool(has_cli_signal)}"'
                f' snapshot_active="{_xml_bool(is_active_snapshot)}"'
                f' working_now="{_xml_bool(is_working_now)}"'
                " />"
            )

    total_process_sessions = sum(max(0, count) for count in process_counts_by_snapshot.values())
    total_runtime_sessions = sum(max(0, count) for count in runtime_counts_by_snapshot.values())
    all_snapshot_names = set(process_counts_by_snapshot) | set(runtime_counts_by_snapshot)
    unmapped_snapshot_names = sorted(name for name in all_snapshot_names if name not in mapped_snapshot_names)

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<live_usage_mapping"
        f' generated_at="{escape(generated_at, quote=True)}"'
        f' active_snapshot="{escape(snapshot_index.active_snapshot_name or "", quote=True)}"'
        f' total_process_sessions="{total_process_sessions}"'
        f' total_runtime_sessions="{total_runtime_sessions}"'
        f' account_count="{len(accounts)}"'
        f' working_now_count="{working_now_count}"'
        f' minimal="{_xml_bool(minimal)}"'
        ">",
        f'  <accounts count="{len(accounts)}">',
    ]
    lines.extend(account_lines)
    lines.append("  </accounts>")
    lines.append(f'  <unmapped_cli_snapshots count="{len(unmapped_snapshot_names)}">')
    for snapshot_name in unmapped_snapshot_names:
        process_session_count = max(0, process_counts_by_snapshot.get(snapshot_name, 0))
        runtime_session_count = max(0, runtime_counts_by_snapshot.get(snapshot_name, 0))
        lines.append(
            "    <snapshot"
            f' name="{escape(snapshot_name, quote=True)}"'
            f' process_session_count="{process_session_count}"'
            f' runtime_session_count="{runtime_session_count}"'
            f' total_session_count="{max(process_session_count, runtime_session_count)}"'
            " />"
        )
    lines.append("  </unmapped_cli_snapshots>")
    lines.append("</live_usage_mapping>")

    return Response(
        content="\n".join(lines),
        media_type="application/xml",
        headers={"Cache-Control": "no-store"},
    )


def _xml_bool(value: bool) -> str:
    return "true" if value else "false"


class _LiveUsageTaskPreview:
    def __init__(self, account_id: str, preview: str) -> None:
        self.account_id = account_id
        self.preview = preview


def _select_effective_live_snapshot_name(
    *,
    snapshot_candidates: list[str],
    active_snapshot_name: str | None,
    account_email: str | None,
    live_snapshot_names: set[str],
) -> str | None:
    selected_snapshot_name = select_snapshot_name(
        snapshot_candidates,
        active_snapshot_name,
        email=account_email,
    )
    if selected_snapshot_name:
        return selected_snapshot_name

    expected_snapshot_name = build_email_snapshot_name(account_email or "")
    normalized_expected_snapshot_name = _normalize_task_preview(expected_snapshot_name)
    if not normalized_expected_snapshot_name:
        return None

    normalized_live_snapshot_names = {
        normalized_snapshot_name
        for normalized_snapshot_name in (
            _normalize_task_preview(snapshot_name) for snapshot_name in live_snapshot_names
        )
        if normalized_snapshot_name
    }
    if normalized_expected_snapshot_name in normalized_live_snapshot_names:
        return expected_snapshot_name

    return None


def _build_snapshot_names_by_task_preview(
    task_previews_by_snapshot: dict[str, list[_LiveUsageTaskPreview]],
) -> dict[str, set[str]]:
    snapshot_names_by_task_preview: dict[str, set[str]] = {}
    for snapshot_name, task_previews in task_previews_by_snapshot.items():
        for task_preview in task_previews:
            normalized_preview = _normalize_task_preview(task_preview.preview)
            if not normalized_preview:
                continue
            snapshot_names_by_task_preview.setdefault(normalized_preview, set()).add(
                snapshot_name
            )
    return snapshot_names_by_task_preview


def _infer_snapshot_name_from_session_task_previews(
    *,
    session_previews: list[str],
    snapshot_names_by_task_preview: dict[str, set[str]],
) -> str | None:
    candidate_snapshot_names: set[str] = set()
    for preview in session_previews:
        candidate_snapshot_names.update(snapshot_names_by_task_preview.get(preview, set()))

    if len(candidate_snapshot_names) != 1:
        return None
    return next(iter(candidate_snapshot_names))


def _resolve_unique_waiting_last_task_preview(
    task_previews: list[_LiveUsageTaskPreview],
) -> str | None:
    unique_previews: list[str] = []
    seen_previews: set[str] = set()
    for task_preview in task_previews:
        normalized_preview = _normalize_task_preview(task_preview.preview)
        if not normalized_preview or normalized_preview in seen_previews:
            continue
        seen_previews.add(normalized_preview)
        unique_previews.append(normalized_preview)
        if len(unique_previews) > 1:
            return None
    return unique_previews[0] if unique_previews else None


def _resolve_session_waiting_last_task_preview(
    *,
    pid: int,
    session_pids: list[int],
    session_task_previews: dict[int, list[str]],
    snapshot_last_task_preview: str | None,
) -> str | None:
    if not snapshot_last_task_preview:
        return None
    if any(session_task_previews.get(session_pid, []) for session_pid in session_pids):
        return None
    if len(session_pids) != 1 or session_pids[0] != pid:
        return None
    return snapshot_last_task_preview


def _normalize_task_preview(value: str | None) -> str:
    normalized = " ".join((value or "").split()).strip()
    normalized = _strip_omx_explore_wrapper(normalized)
    normalized = _strip_leading_live_usage_payload(normalized)
    normalized = _strip_trailing_live_usage_payload(normalized)
    if not normalized:
        return ""
    if _TASK_PREVIEW_WARNING_PREFIX_RE.match(normalized):
        return ""
    if _TASK_PREVIEW_STATUS_ONLY_RE.match(normalized):
        return ""
    if _TASK_PREVIEW_LIVE_USAGE_XML_RE.match(normalized):
        return ""
    if _TASK_PREVIEW_LIVE_USAGE_MAPPING_XML_RE.match(normalized):
        return ""
    # Keep the XML feed compact for MCP consumers while retaining enough
    # context to identify the active CLI task.
    return normalized[:160]


def _strip_leading_live_usage_payload(value: str) -> str:
    normalized = value.strip()
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


def _strip_trailing_live_usage_payload(value: str) -> str:
    lowered = value.lower()
    marker_indexes = [
        index
        for index in (
            lowered.find("<live_usage"),
            lowered.find("<live_usage_mapping"),
        )
        if index >= 0
    ]
    if not marker_indexes:
        return value
    return value[: min(marker_indexes)].strip()


def _strip_omx_explore_wrapper(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        return ""
    if _TASK_PREVIEW_OMX_EXPLORE_HEADER_RE.search(stripped) is None:
        return stripped

    request_match = _TASK_PREVIEW_OMX_EXPLORE_USER_REQUEST_RE.search(stripped)
    if request_match is None:
        return ""
    return request_match.group(1).strip()


async def _read_live_usage_task_previews_by_snapshot() -> dict[str, list[_LiveUsageTaskPreview]]:
    try:
        snapshot_index = build_snapshot_index()
        live_snapshot_names = set(read_live_codex_process_session_counts_by_snapshot()) | set(
            read_runtime_live_session_counts_by_snapshot()
        )
        async for session in get_session():
            repository = AccountsRepository(session)
            accounts = await repository.list_accounts()
            account_ids = [account.id for account in accounts]
            task_previews: dict[str, str] = {}
            if account_ids:
                task_previews = await repository.list_codex_current_task_preview_by_account(
                    account_ids=account_ids,
                )

            previews_by_snapshot: dict[str, list[_LiveUsageTaskPreview]] = {}
            account_ids_by_snapshot: dict[str, list[str]] = {}
            for account in accounts:
                normalized_preview = _normalize_task_preview(task_previews.get(account.id))
                snapshot_candidates = resolve_snapshot_names_for_account(
                    snapshot_index=snapshot_index,
                    account_id=account.id,
                    chatgpt_account_id=account.chatgpt_account_id,
                    email=account.email,
                )
                selected_snapshot_name = _select_effective_live_snapshot_name(
                    snapshot_candidates=snapshot_candidates,
                    active_snapshot_name=snapshot_index.active_snapshot_name,
                    account_email=account.email,
                    live_snapshot_names=live_snapshot_names,
                )
                if not selected_snapshot_name:
                    continue
                account_ids_by_snapshot.setdefault(selected_snapshot_name, []).append(account.id)

                if not normalized_preview:
                    continue

                previews_by_snapshot.setdefault(selected_snapshot_name, []).append(
                    _LiveUsageTaskPreview(
                        account_id=account.id,
                        preview=normalized_preview,
                    )
                )

            local_task_previews = read_local_codex_task_previews_by_snapshot(now=utcnow())
            for snapshot_name, local_preview in local_task_previews.items():
                normalized_local_preview = _normalize_task_preview(local_preview.text)
                if not normalized_local_preview:
                    continue

                existing = previews_by_snapshot.setdefault(snapshot_name, [])
                if any(preview.preview == normalized_local_preview for preview in existing):
                    continue

                snapshot_account_ids = account_ids_by_snapshot.get(snapshot_name, [])
                local_account_id = snapshot_account_ids[0] if snapshot_account_ids else "local"
                existing.append(
                    _LiveUsageTaskPreview(
                        account_id=local_account_id,
                        preview=normalized_local_preview,
                    )
                )

            for snapshot_previews in previews_by_snapshot.values():
                snapshot_previews.sort(key=lambda preview: preview.account_id)

            return previews_by_snapshot
    except Exception:
        return {}

    return {}


async def _read_live_usage_account_emails_by_snapshot() -> dict[str, list[str]]:
    try:
        snapshot_index = build_snapshot_index()
        live_snapshot_names = set(read_live_codex_process_session_counts_by_snapshot()) | set(
            read_runtime_live_session_counts_by_snapshot()
        )
        async for session in get_session():
            repository = AccountsRepository(session)
            accounts = await repository.list_accounts()
            if not accounts:
                return {}

            emails_by_snapshot: dict[str, set[str]] = {}
            for account in accounts:
                normalized_email = (account.email or "").strip().lower()
                if not normalized_email:
                    continue

                snapshot_candidates = resolve_snapshot_names_for_account(
                    snapshot_index=snapshot_index,
                    account_id=account.id,
                    chatgpt_account_id=account.chatgpt_account_id,
                    email=account.email,
                )
                selected_snapshot_name = _select_effective_live_snapshot_name(
                    snapshot_candidates=snapshot_candidates,
                    active_snapshot_name=snapshot_index.active_snapshot_name,
                    account_email=account.email,
                    live_snapshot_names=live_snapshot_names,
                )
                if not selected_snapshot_name:
                    continue

                emails_by_snapshot.setdefault(selected_snapshot_name, set()).add(normalized_email)

            return {
                snapshot_name: sorted(snapshot_emails)
                for snapshot_name, snapshot_emails in emails_by_snapshot.items()
            }
    except Exception:
        return {}

    return {}


async def _read_live_usage_snapshot_alias_map() -> dict[str, str]:
    try:
        snapshot_index = build_snapshot_index()
        async for session in get_session():
            repository = AccountsRepository(session)
            accounts = await repository.list_accounts()
            if not accounts:
                return {}

            expected_snapshot_owner_ids: dict[str, set[str]] = {}
            for account in accounts:
                expected_snapshot_name = build_email_snapshot_name(account.email)
                normalized_expected_snapshot_name = _normalize_task_preview(
                    expected_snapshot_name
                )
                if not normalized_expected_snapshot_name:
                    continue
                expected_snapshot_owner_ids.setdefault(
                    normalized_expected_snapshot_name, set()
                ).add(account.id)

            alias_to_selected: dict[str, str] = {}
            ambiguous_aliases: set[str] = set()
            for account in accounts:
                snapshot_candidates = resolve_snapshot_name_candidates_for_account(
                    snapshot_index=snapshot_index,
                    account_id=account.id,
                    chatgpt_account_id=account.chatgpt_account_id,
                    email=account.email,
                )
                if not snapshot_candidates:
                    continue

                selected_snapshot_name = select_snapshot_name(
                    snapshot_candidates,
                    snapshot_index.active_snapshot_name,
                    email=account.email,
                )
                if not selected_snapshot_name:
                    continue

                for snapshot_name in snapshot_candidates:
                    normalized_snapshot_name = _normalize_task_preview(snapshot_name)
                    if (
                        normalized_snapshot_name
                        and snapshot_name != selected_snapshot_name
                        and any(
                            owner_account_id != account.id
                            for owner_account_id in expected_snapshot_owner_ids.get(
                                normalized_snapshot_name, set()
                            )
                        )
                    ):
                        continue

                    if snapshot_name in ambiguous_aliases:
                        continue

                    existing_target = alias_to_selected.get(snapshot_name)
                    if existing_target is None:
                        alias_to_selected[snapshot_name] = selected_snapshot_name
                        continue

                    if existing_target != selected_snapshot_name:
                        # Preserve attribution safety: if two accounts disagree
                        # about the target snapshot for the same alias, drop
                        # the alias remap entirely instead of silently forcing
                        # sessions/tasks into the wrong account snapshot.
                        alias_to_selected.pop(snapshot_name, None)
                        ambiguous_aliases.add(snapshot_name)

            return alias_to_selected
    except Exception:
        return {}

    return {}


@router.get("/health/ready", response_model=HealthCheckResponse)
async def health_ready() -> HealthCheckResponse:
    draining = False
    try:
        import app.core.draining as draining_module

        draining = getattr(draining_module, "_draining", False)
    except (ImportError, AttributeError):
        pass

    if draining:
        raise HTTPException(status_code=503, detail="Service is draining")

    try:
        async for session in get_session():
            try:
                await session.execute(text("SELECT 1"))
                checks = {"database": "ok"}
                status = "ok"

                # Upstream health (degradation flag, circuit breaker) is NOT
                # checked here — only infrastructure readiness matters.
                # Mixing upstream state into readiness causes permanent
                # pod eviction after transient upstream failures.

                bridge_ring = await _get_bridge_ring_info(session)
                failure_detail = _bridge_readiness_failure_detail(bridge_ring)
                if failure_detail is not None:
                    raise HTTPException(status_code=503, detail=failure_detail)

                return HealthCheckResponse(status=status, checks=checks, bridge_ring=bridge_ring)
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(
                    status_code=503,
                    detail="Service unavailable",
                )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Service unavailable",
        )

    raise HTTPException(status_code=503, detail="Service unavailable")


def _bridge_readiness_failure_detail(bridge_ring: BridgeRingInfo) -> str | None:
    settings = get_settings()
    if not getattr(settings, "http_responses_session_bridge_enabled", True):
        return None
    if bridge_ring.error is not None:
        return "Service bridge ring metadata is unavailable"
    if bridge_ring.ring_size == 0:
        return None
    if bridge_ring.is_member:
        return None
    return "Service is not an active bridge ring member"


async def _get_bridge_ring_info(session: AsyncSession) -> BridgeRingInfo:
    try:
        settings = get_settings()
        instance_id = getattr(settings, "http_responses_session_bridge_instance_id", None)

        cutoff = utcnow() - timedelta(seconds=RING_STALE_THRESHOLD_SECONDS)
        result = await session.execute(
            sa_select(BridgeRingMember.instance_id)
            .where(BridgeRingMember.last_heartbeat_at >= cutoff)
            .order_by(BridgeRingMember.instance_id)
        )
        active_members = list(result.scalars().all())
        data = ",".join(sorted(active_members))
        fingerprint = sha256(data.encode()).hexdigest()
        is_member = instance_id in active_members if instance_id else False

        return BridgeRingInfo(
            ring_fingerprint=fingerprint,
            ring_size=len(active_members),
            instance_id=instance_id,
            is_member=is_member,
        )
    except Exception as e:
        return BridgeRingInfo(
            ring_fingerprint=None,
            ring_size=0,
            instance_id=None,
            is_member=False,
            error=f"unavailable: {type(e).__name__}",
        )


@router.get("/health/startup", response_model=HealthCheckResponse)
async def health_startup() -> HealthCheckResponse:
    import app.core.startup as startup_module

    if startup_module._startup_complete:
        return HealthCheckResponse(status="ok")
    else:
        raise HTTPException(status_code=503, detail="Service is starting")
