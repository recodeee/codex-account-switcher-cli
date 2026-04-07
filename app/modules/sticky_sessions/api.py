from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Query

from app.core.auth.dependencies import set_dashboard_error_format, validate_dashboard_session
from app.core.exceptions import DashboardNotFoundError
from app.db.models import StickySessionKind
from app.dependencies import StickySessionsContext, get_sticky_sessions_context
from app.modules.sticky_sessions.schemas import (
    StickySessionEventResponse,
    StickySessionDeleteResponse,
    StickySessionEntryResponse,
    StickySessionEventsResponse,
    StickySessionsDeleteRequest,
    StickySessionsDeleteResponse,
    StickySessionsListResponse,
    StickySessionsPurgeRequest,
    StickySessionsPurgeResponse,
    UnmappedCliSessionResponse,
)

router = APIRouter(
    prefix="/api/sticky-sessions",
    tags=["dashboard"],
    dependencies=[Depends(validate_dashboard_session), Depends(set_dashboard_error_format)],
)


@router.get("", response_model=StickySessionsListResponse)
async def list_sticky_sessions(
    kind: StickySessionKind | None = Query(default=None),
    stale_only: bool = Query(default=False, alias="staleOnly"),
    active_only: bool = Query(default=False, alias="activeOnly"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    context: StickySessionsContext = Depends(get_sticky_sessions_context),
) -> StickySessionsListResponse:
    result = await context.service.list_entries(
        kind=kind,
        stale_only=stale_only,
        active_only=active_only,
        offset=offset,
        limit=limit,
    )
    return StickySessionsListResponse(
        entries=[
            StickySessionEntryResponse(
                key=entry.key,
                account_id=entry.account_id,
                display_name=entry.display_name,
                kind=entry.kind,
                created_at=entry.created_at,
                updated_at=entry.updated_at,
                task_preview=entry.task_preview,
                task_updated_at=entry.task_updated_at,
                is_active=entry.is_active,
                expires_at=entry.expires_at,
                is_stale=entry.is_stale,
            )
            for entry in result.entries
        ],
        unmapped_cli_sessions=[
            UnmappedCliSessionResponse(
                snapshot_name=entry.snapshot_name,
                process_session_count=entry.process_session_count,
                runtime_session_count=entry.runtime_session_count,
                total_session_count=entry.total_session_count,
                reason=entry.reason,
            )
            for entry in result.unmapped_cli_sessions
        ],
        stale_prompt_cache_count=result.stale_prompt_cache_count,
        total=result.total,
        has_more=result.has_more,
    )


@router.post("/purge", response_model=StickySessionsPurgeResponse)
async def purge_sticky_sessions(
    payload: StickySessionsPurgeRequest = Body(default=StickySessionsPurgeRequest()),
    context: StickySessionsContext = Depends(get_sticky_sessions_context),
) -> StickySessionsPurgeResponse:
    deleted_count = await context.service.purge_entries()
    return StickySessionsPurgeResponse(deleted_count=deleted_count)


@router.post("/delete", response_model=StickySessionsDeleteResponse)
async def delete_sticky_sessions(
    payload: StickySessionsDeleteRequest,
    context: StickySessionsContext = Depends(get_sticky_sessions_context),
) -> StickySessionsDeleteResponse:
    deleted_count = await context.service.delete_entries([(entry.key, entry.kind) for entry in payload.sessions])
    return StickySessionsDeleteResponse(deleted_count=deleted_count)


@router.delete("/{kind}/{key:path}", response_model=StickySessionDeleteResponse)
async def delete_sticky_session(
    kind: StickySessionKind,
    key: str,
    context: StickySessionsContext = Depends(get_sticky_sessions_context),
) -> StickySessionDeleteResponse:
    deleted = await context.service.delete_entry(key, kind=kind)
    if not deleted:
        raise DashboardNotFoundError("Sticky session not found", code="sticky_session_not_found")
    return StickySessionDeleteResponse(status="deleted")


@router.get("/session-events", response_model=StickySessionEventsResponse)
async def get_sticky_session_events(
    account_id: str = Query(alias="accountId", min_length=1),
    session_key: str = Query(alias="sessionKey", min_length=1),
    limit: int = Query(default=120, ge=1, le=500),
    context: StickySessionsContext = Depends(get_sticky_sessions_context),
) -> StickySessionEventsResponse:
    result = await context.service.get_codex_session_events(
        account_id=account_id,
        session_key=session_key,
        limit=limit,
    )
    if result is None:
        raise DashboardNotFoundError("Sticky session not found", code="sticky_session_not_found")
    return StickySessionEventsResponse(
        session_key=result.session_key,
        resolved_session_id=result.resolved_session_id,
        source_file=result.source_file,
        events=[
            StickySessionEventResponse(
                timestamp=event.timestamp,
                kind=event.kind,
                title=event.title,
                text=event.text,
                role=event.role,
                raw_type=event.raw_type,
            )
            for event in result.events
        ],
        truncated=result.truncated,
    )
