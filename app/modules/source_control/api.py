from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.core.auth.dependencies import set_dashboard_error_format, validate_dashboard_session
from app.core.exceptions import DashboardBadRequestError, DashboardNotFoundError
from app.dependencies import AgentsContext, ProjectsContext, get_agents_context, get_projects_context
from app.modules.source_control.schemas import SourceControlPreviewResponse
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

