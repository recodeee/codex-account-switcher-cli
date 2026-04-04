from __future__ import annotations

from datetime import timedelta
from hashlib import sha256
from html import escape

from fastapi import APIRouter, Depends, HTTPException
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
_ACTIVE_CLI_SIGNAL_WINDOW = timedelta(minutes=5)


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/health/live", response_model=HealthCheckResponse)
async def health_live() -> HealthCheckResponse:
    return HealthCheckResponse(status="ok")


@router.get("/live_usage")
async def live_usage() -> Response:
    attribution = read_live_codex_process_session_attribution()
    counts_by_snapshot = attribution.counts_by_snapshot
    unattributed_session_pids = attribution.unattributed_session_pids
    task_previews_by_snapshot = await _read_live_usage_task_previews_by_snapshot()
    account_emails_by_snapshot = await _read_live_usage_account_emails_by_snapshot()
    generated_at = utcnow().isoformat() + "Z"
    total_mapped_sessions = sum(max(0, count) for count in counts_by_snapshot.values())
    total_unattributed_sessions = len(unattributed_session_pids)
    total_sessions = total_mapped_sessions + total_unattributed_sessions
    total_task_previews = sum(
        len(task_previews) for task_previews in task_previews_by_snapshot.values()
    )

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<live_usage"
        f' generated_at="{escape(generated_at, quote=True)}"'
        f' total_sessions="{total_sessions}"'
        f' mapped_sessions="{total_mapped_sessions}"'
        f' unattributed_sessions="{total_unattributed_sessions}"'
        f' total_task_previews="{total_task_previews}"'
        ">",
    ]
    snapshot_names = sorted(
        set(counts_by_snapshot.keys())
        | set(task_previews_by_snapshot.keys())
        | set(account_emails_by_snapshot.keys())
    )
    for snapshot_name in snapshot_names:
        session_count = max(0, counts_by_snapshot.get(snapshot_name, 0))
        task_previews = task_previews_by_snapshot.get(snapshot_name, [])
        account_emails = account_emails_by_snapshot.get(snapshot_name, [])
        sanitized_snapshot_name = escape(snapshot_name, quote=True)
        account_emails_attribute = (
            f' account_emails="{escape(",".join(account_emails), quote=True)}"'
            if account_emails
            else ""
        )
        if not task_previews:
            lines.append(
                f'  <snapshot name="{sanitized_snapshot_name}" session_count="{session_count}"{account_emails_attribute} />'
            )
            continue

        lines.append(
            f'  <snapshot name="{sanitized_snapshot_name}" session_count="{session_count}" task_preview_count="{len(task_previews)}"{account_emails_attribute}>'
        )
        for task_preview in task_previews:
            lines.append(
                "    <task_preview"
                f' account_id="{escape(task_preview.account_id, quote=True)}"'
                f' preview="{escape(task_preview.preview, quote=True)}"'
                " />"
            )
        lines.append("  </snapshot>")
    if unattributed_session_pids:
        lines.append(f'  <unattributed_sessions count="{len(unattributed_session_pids)}">')
        for pid in unattributed_session_pids:
            lines.append(f'    <session pid="{pid}" />')
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
        active_since=utcnow() - _ACTIVE_CLI_SIGNAL_WINDOW,
    )
    task_previews = await repository.list_codex_current_task_preview_by_account(
        account_ids=account_ids,
        active_since=utcnow() - _ACTIVE_CLI_SIGNAL_WINDOW,
    )

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
        selected_snapshot_name = select_snapshot_name(
            snapshot_candidates,
            snapshot_index.active_snapshot_name,
            email=account.email,
        )
        mapped_snapshot_names.update(snapshot_candidates)

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
        has_task_preview = bool((task_previews.get(account.id) or "").strip())
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


def _normalize_task_preview(value: str | None) -> str:
    normalized = " ".join((value or "").split()).strip()
    if not normalized:
        return ""
    # Keep the XML feed compact for MCP consumers while retaining enough
    # context to identify the active CLI task.
    return normalized[:160]


async def _read_live_usage_task_previews_by_snapshot() -> dict[str, list[_LiveUsageTaskPreview]]:
    try:
        snapshot_index = build_snapshot_index()
        async for session in get_session():
            repository = AccountsRepository(session)
            accounts = await repository.list_accounts()
            account_ids = [account.id for account in accounts]
            task_previews: dict[str, str] = {}
            if account_ids:
                task_previews = await repository.list_codex_current_task_preview_by_account(
                    account_ids=account_ids,
                    active_since=utcnow() - _ACTIVE_CLI_SIGNAL_WINDOW,
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
                selected_snapshot_name = select_snapshot_name(
                    snapshot_candidates,
                    snapshot_index.active_snapshot_name,
                    email=account.email,
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

            for task_previews in previews_by_snapshot.values():
                task_previews.sort(key=lambda preview: preview.account_id)

            return previews_by_snapshot
    except Exception:
        return {}

    return {}


async def _read_live_usage_account_emails_by_snapshot() -> dict[str, list[str]]:
    try:
        snapshot_index = build_snapshot_index()
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
                selected_snapshot_name = select_snapshot_name(
                    snapshot_candidates,
                    snapshot_index.active_snapshot_name,
                    email=account.email,
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
