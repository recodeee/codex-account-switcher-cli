from __future__ import annotations

from fastapi import APIRouter, Body, Depends

from app.core.auth.dependencies import set_dashboard_error_format, validate_dashboard_session
from app.core.exceptions import DashboardBadRequestError, DashboardConflictError, DashboardNotFoundError
from app.dependencies import ProjectsContext, get_projects_context
from app.modules.projects.schemas import (
    ProjectCreateRequest,
    ProjectDeleteResponse,
    ProjectEntry,
    ProjectsResponse,
    ProjectUpdateRequest,
)
from app.modules.projects.service import ProjectNameExistsError, ProjectValidationError

router = APIRouter(
    prefix="/api/projects",
    tags=["dashboard"],
    dependencies=[Depends(validate_dashboard_session), Depends(set_dashboard_error_format)],
)


@router.get("", response_model=ProjectsResponse)
async def list_projects(
    context: ProjectsContext = Depends(get_projects_context),
) -> ProjectsResponse:
    payload = await context.service.list_projects()
    return ProjectsResponse(
        entries=[
            ProjectEntry(
                id=entry.id,
                name=entry.name,
                description=entry.description,
                project_path=entry.project_path,
                sandbox_mode=entry.sandbox_mode,
                git_branch=entry.git_branch,
                created_at=entry.created_at,
                updated_at=entry.updated_at,
            )
            for entry in payload.entries
        ]
    )


@router.post("", response_model=ProjectEntry)
async def create_project(
    payload: ProjectCreateRequest = Body(...),
    context: ProjectsContext = Depends(get_projects_context),
) -> ProjectEntry:
    try:
        created = await context.service.add_project(
            name=payload.name,
            description=payload.description,
            project_path=payload.project_path,
            sandbox_mode=payload.sandbox_mode,
            git_branch=payload.git_branch,
        )
    except ProjectValidationError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc
    except ProjectNameExistsError as exc:
        raise DashboardConflictError(str(exc), code="project_name_exists") from exc

    return ProjectEntry(
        id=created.id,
        name=created.name,
        description=created.description,
        project_path=created.project_path,
        sandbox_mode=created.sandbox_mode,
        git_branch=created.git_branch,
        created_at=created.created_at,
        updated_at=created.updated_at,
    )


@router.put("/{project_id}", response_model=ProjectEntry)
async def update_project(
    project_id: str,
    payload: ProjectUpdateRequest = Body(...),
    context: ProjectsContext = Depends(get_projects_context),
) -> ProjectEntry:
    try:
        updated = await context.service.update_project(
            project_id=project_id,
            name=payload.name,
            description=payload.description,
            project_path=payload.project_path,
            sandbox_mode=payload.sandbox_mode,
            git_branch=payload.git_branch,
        )
    except ProjectValidationError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc
    except ProjectNameExistsError as exc:
        raise DashboardConflictError(str(exc), code="project_name_exists") from exc

    if updated is None:
        raise DashboardNotFoundError("Project not found", code="project_not_found")

    return ProjectEntry(
        id=updated.id,
        name=updated.name,
        description=updated.description,
        project_path=updated.project_path,
        sandbox_mode=updated.sandbox_mode,
        git_branch=updated.git_branch,
        created_at=updated.created_at,
        updated_at=updated.updated_at,
    )


@router.delete("/{project_id}", response_model=ProjectDeleteResponse)
async def delete_project(
    project_id: str,
    context: ProjectsContext = Depends(get_projects_context),
) -> ProjectDeleteResponse:
    deleted = await context.service.remove_project(project_id)
    if not deleted:
        raise DashboardNotFoundError("Project not found", code="project_not_found")
    return ProjectDeleteResponse(status="deleted")
