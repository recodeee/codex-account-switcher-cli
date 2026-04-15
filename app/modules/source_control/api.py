from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Query

from app.core.auth.dependencies import set_dashboard_error_format, validate_dashboard_session
from app.core.exceptions import DashboardBadRequestError, DashboardNotFoundError
from app.dependencies import AgentsContext, ProjectsContext, get_agents_context, get_projects_context
from app.modules.source_control.schemas import (
    SourceControlBranchDetailsResponse,
    SourceControlCommitActivityResponse,
    SourceControlCreatePullRequestRequest,
    SourceControlCreatePullRequestResponse,
    SourceControlDeleteBranchRequest,
    SourceControlDeleteBranchResponse,
    SourceControlMergePullRequestRequest,
    SourceControlMergePullRequestResponse,
    SourceControlPreviewResponse,
)
from app.modules.source_control.service import SourceControlBotSnapshot, SourceControlError, SourceControlService

router = APIRouter(
    prefix="/api/source-control",
    tags=["dashboard"],
    dependencies=[Depends(validate_dashboard_session), Depends(set_dashboard_error_format)],
)


@router.get("/preview", response_model=SourceControlPreviewResponse)
async def get_source_control_preview(
    project_id: str | None = Query(default=None, alias="projectId"),
    branch_limit: int = Query(default=24, ge=6, le=60, alias="branchLimit"),
    changed_file_limit: int = Query(default=120, ge=20, le=400, alias="changedFileLimit"),
    projects_context: ProjectsContext = Depends(get_projects_context),
    agents_context: AgentsContext = Depends(get_agents_context),
) -> SourceControlPreviewResponse:
    project_path: str | None = None
    if project_id:
        project = await projects_context.service.get_project(project_id)
        if project is None:
            raise DashboardNotFoundError("Project not found", code="project_not_found")
        project_path = project.project_path
        if not project_path:
            raise DashboardBadRequestError(
                "Project path is required to load source control preview.",
                code="project_path_required",
            )

    agents_payload = await agents_context.service.list_agents()
    bots = [
        SourceControlBotSnapshot(
            name=agent.name,
            status=agent.status,
            runtime=agent.runtime,
        )
        for agent in agents_payload.entries
    ]

    service = SourceControlService()
    try:
        return service.build_preview(
            project_path=project_path,
            bots=bots,
            branch_limit=branch_limit,
            changed_file_limit=changed_file_limit,
        )
    except SourceControlError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc


@router.get("/commit-activity", response_model=SourceControlCommitActivityResponse)
async def get_source_control_commit_activity(
    project_id: str | None = Query(default=None, alias="projectId"),
    days: int = Query(default=7, ge=1, le=90),
    limit: int = Query(default=120, ge=1, le=500),
    projects_context: ProjectsContext = Depends(get_projects_context),
) -> SourceControlCommitActivityResponse:
    project_path: str | None = None
    if project_id:
        project = await projects_context.service.get_project(project_id)
        if project is None:
            raise DashboardNotFoundError("Project not found", code="project_not_found")
        project_path = project.project_path
        if not project_path:
            raise DashboardBadRequestError(
                "Project path is required to load source control commit activity.",
                code="project_path_required",
            )

    service = SourceControlService()
    try:
        return service.list_commit_activity(
            project_path=project_path,
            days=days,
            limit=limit,
        )
    except SourceControlError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc


@router.get("/branch-details", response_model=SourceControlBranchDetailsResponse)
async def get_source_control_branch_details(
    branch: str = Query(..., min_length=1),
    project_id: str | None = Query(default=None, alias="projectId"),
    changed_file_limit: int = Query(default=240, ge=20, le=500, alias="changedFileLimit"),
    projects_context: ProjectsContext = Depends(get_projects_context),
    agents_context: AgentsContext = Depends(get_agents_context),
) -> SourceControlBranchDetailsResponse:
    project_path: str | None = None
    if project_id:
        project = await projects_context.service.get_project(project_id)
        if project is None:
            raise DashboardNotFoundError("Project not found", code="project_not_found")
        project_path = project.project_path
        if not project_path:
            raise DashboardBadRequestError(
                "Project path is required to load source control branch details.",
                code="project_path_required",
            )

    agents_payload = await agents_context.service.list_agents()
    bots = [
        SourceControlBotSnapshot(
            name=agent.name,
            status=agent.status,
            runtime=agent.runtime,
        )
        for agent in agents_payload.entries
    ]

    service = SourceControlService()
    try:
        return service.build_branch_details(
            project_path=project_path,
            bots=bots,
            branch=branch,
            changed_file_limit=changed_file_limit,
        )
    except SourceControlError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc


@router.post("/pr/create", response_model=SourceControlCreatePullRequestResponse)
async def create_source_control_pull_request(
    payload: SourceControlCreatePullRequestRequest = Body(...),
    projects_context: ProjectsContext = Depends(get_projects_context),
) -> SourceControlCreatePullRequestResponse:
    project_path: str | None = None
    if payload.project_id:
        project = await projects_context.service.get_project(payload.project_id)
        if project is None:
            raise DashboardNotFoundError("Project not found", code="project_not_found")
        project_path = project.project_path
        if not project_path:
            raise DashboardBadRequestError(
                "Project path is required before creating a pull request.",
                code="project_path_required",
            )

    service = SourceControlService()
    try:
        return service.create_pull_request(
            project_path=project_path,
            branch=payload.branch,
            base_branch=payload.base_branch,
            title=payload.title,
            body=payload.body,
            draft=payload.draft,
        )
    except SourceControlError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc


@router.post("/pr/merge", response_model=SourceControlMergePullRequestResponse)
async def merge_source_control_pull_request(
    payload: SourceControlMergePullRequestRequest = Body(...),
    projects_context: ProjectsContext = Depends(get_projects_context),
) -> SourceControlMergePullRequestResponse:
    project_path: str | None = None
    if payload.project_id:
        project = await projects_context.service.get_project(payload.project_id)
        if project is None:
            raise DashboardNotFoundError("Project not found", code="project_not_found")
        project_path = project.project_path
        if not project_path:
            raise DashboardBadRequestError(
                "Project path is required before merging a pull request.",
                code="project_path_required",
            )

    service = SourceControlService()
    try:
        return service.merge_pull_request(
            project_path=project_path,
            branch=payload.branch,
            pull_request_number=payload.pull_request_number,
            base_branch=payload.base_branch,
            delete_branch=payload.delete_branch,
            squash=payload.squash,
        )
    except SourceControlError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc


@router.post("/branch/delete", response_model=SourceControlDeleteBranchResponse)
async def delete_source_control_branch(
    payload: SourceControlDeleteBranchRequest = Body(...),
    projects_context: ProjectsContext = Depends(get_projects_context),
) -> SourceControlDeleteBranchResponse:
    project_path: str | None = None
    if payload.project_id:
        project = await projects_context.service.get_project(payload.project_id)
        if project is None:
            raise DashboardNotFoundError("Project not found", code="project_not_found")
        project_path = project.project_path
        if not project_path:
            raise DashboardBadRequestError(
                "Project path is required before deleting a branch.",
                code="project_path_required",
            )

    service = SourceControlService()
    try:
        return service.delete_branch(
            project_path=project_path,
            branch=payload.branch,
        )
    except SourceControlError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc
