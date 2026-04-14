from __future__ import annotations

from fastapi import APIRouter, Body, Depends

from app.core.auth.dependencies import set_dashboard_error_format, validate_dashboard_session
from app.core.exceptions import DashboardBadRequestError, DashboardConflictError, DashboardNotFoundError
from app.dependencies import ProjectsContext, get_projects_context
from app.modules.projects.editor import (
    ProjectEditorLaunchError,
    open_project_folder_in_editor,
    open_project_folder_in_file_manager,
)
from app.modules.projects.schemas import (
    ProjectCreateRequest,
    ProjectDeleteResponse,
    ProjectEntry,
    ProjectOpenFolderRequest,
    ProjectPlanLinkEntry,
    ProjectPlanLinksResponse,
    ProjectOpenFolderResponse,
    ProjectsResponse,
    ProjectUpdateRequest,
)
from app.modules.projects.service import (
    ProjectNameExistsError,
    ProjectPathExistsError,
    ProjectValidationError,
)

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
                project_url=entry.project_url,
                github_repo_url=entry.github_repo_url,
                project_path=entry.project_path,
                sandbox_mode=entry.sandbox_mode,
                git_branch=entry.git_branch,
                created_at=entry.created_at,
                updated_at=entry.updated_at,
            )
            for entry in payload.entries
        ]
    )


@router.get("/plan-links", response_model=ProjectPlanLinksResponse)
async def list_project_plan_links(
    context: ProjectsContext = Depends(get_projects_context),
) -> ProjectPlanLinksResponse:
    payload = await context.service.list_project_plan_links()
    return ProjectPlanLinksResponse(
        entries=[
            ProjectPlanLinkEntry(
                project_id=entry.project_id,
                plan_count=entry.plan_count,
                latest_plan_slug=entry.latest_plan_slug,
                latest_plan_updated_at=entry.latest_plan_updated_at,
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
            project_url=payload.project_url,
            github_repo_url=payload.github_repo_url,
            project_path=payload.project_path,
            sandbox_mode=payload.sandbox_mode,
            git_branch=payload.git_branch,
        )
    except ProjectValidationError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc
    except ProjectNameExistsError as exc:
        raise DashboardConflictError(str(exc), code="project_name_exists") from exc
    except ProjectPathExistsError as exc:
        raise DashboardConflictError(str(exc), code="project_path_exists") from exc

    return ProjectEntry(
        id=created.id,
        name=created.name,
        description=created.description,
        project_url=created.project_url,
        github_repo_url=created.github_repo_url,
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
            project_url=payload.project_url,
            github_repo_url=payload.github_repo_url,
            project_path=payload.project_path,
            sandbox_mode=payload.sandbox_mode,
            git_branch=payload.git_branch,
        )
    except ProjectValidationError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc
    except ProjectNameExistsError as exc:
        raise DashboardConflictError(str(exc), code="project_name_exists") from exc
    except ProjectPathExistsError as exc:
        raise DashboardConflictError(str(exc), code="project_path_exists") from exc

    if updated is None:
        raise DashboardNotFoundError("Project not found", code="project_not_found")

    return ProjectEntry(
        id=updated.id,
        name=updated.name,
        description=updated.description,
        project_url=updated.project_url,
        github_repo_url=updated.github_repo_url,
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


@router.post("/{project_id}/open-folder", response_model=ProjectOpenFolderResponse)
async def open_project_folder(
    project_id: str,
    payload: ProjectOpenFolderRequest = Body(default=ProjectOpenFolderRequest()),
    context: ProjectsContext = Depends(get_projects_context),
) -> ProjectOpenFolderResponse:
    project = await context.service.get_project(project_id)
    if project is None:
        raise DashboardNotFoundError("Project not found", code="project_not_found")
    if not project.project_path:
        raise DashboardBadRequestError(
            "Project path is required before opening the project folder",
            code="project_path_required",
        )

    try:
        if payload.target == "file-manager":
            editor = open_project_folder_in_file_manager(project.project_path)
        else:
            editor = open_project_folder_in_editor(project.project_path)
    except ProjectEditorLaunchError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc

    return ProjectOpenFolderResponse(
        status="opened",
        project_path=project.project_path,
        target=payload.target,
        editor=editor,
    )
