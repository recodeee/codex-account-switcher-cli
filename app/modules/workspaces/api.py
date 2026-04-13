from __future__ import annotations

from fastapi import APIRouter, Body, Depends

from app.core.auth.dependencies import set_dashboard_error_format, validate_dashboard_session
from app.core.exceptions import DashboardBadRequestError, DashboardConflictError, DashboardNotFoundError
from app.dependencies import WorkspacesContext, get_workspaces_context
from app.modules.workspaces.schemas import (
    WorkspaceCreateRequest,
    WorkspaceEntry,
    WorkspacesResponse,
    WorkspaceSelectionResponse,
)
from app.modules.workspaces.service import (
    WorkspaceEntryData,
    WorkspaceNameExistsError,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)

router = APIRouter(
    prefix="/api/workspaces",
    tags=["dashboard"],
    dependencies=[Depends(validate_dashboard_session), Depends(set_dashboard_error_format)],
)


@router.get("", response_model=WorkspacesResponse)
async def list_workspaces(
    context: WorkspacesContext = Depends(get_workspaces_context),
) -> WorkspacesResponse:
    payload = await context.service.list_workspaces()
    return WorkspacesResponse(entries=[_to_schema(entry) for entry in payload.entries])


@router.post("", response_model=WorkspaceEntry)
async def create_workspace(
    payload: WorkspaceCreateRequest = Body(...),
    context: WorkspacesContext = Depends(get_workspaces_context),
) -> WorkspaceEntry:
    try:
        created = await context.service.create_workspace(name=payload.name, label=payload.label)
    except WorkspaceValidationError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc
    except WorkspaceNameExistsError as exc:
        raise DashboardConflictError(str(exc), code="workspace_name_exists") from exc

    return _to_schema(created)


@router.post("/{workspace_id}/select", response_model=WorkspaceSelectionResponse)
async def select_workspace(
    workspace_id: str,
    context: WorkspacesContext = Depends(get_workspaces_context),
) -> WorkspaceSelectionResponse:
    try:
        selected = await context.service.select_workspace(workspace_id)
    except WorkspaceNotFoundError as exc:
        raise DashboardNotFoundError(str(exc), code="workspace_not_found") from exc
    return WorkspaceSelectionResponse(active_workspace_id=selected.id)


def _to_schema(entry: WorkspaceEntryData) -> WorkspaceEntry:
    return WorkspaceEntry(
        id=entry.id,
        name=entry.name,
        slug=entry.slug,
        label=entry.label,
        is_active=entry.is_active,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )
