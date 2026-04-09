from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.auth.dependencies import set_dashboard_error_format, validate_dashboard_session
from app.core.exceptions import DashboardNotFoundError, DashboardServiceUnavailableError
from app.modules.plans.schemas import (
    OpenSpecPlanDetail,
    OpenSpecPlanRuntime,
    PlanPromptBundle,
    PlanPromptItem,
    OpenSpecPlansResponse,
    OpenSpecPlanRoleDetail,
    OpenSpecPlanSummary,
    PlanCheckpoint,
    PlanOverallProgress,
    PlanRuntimeAgent,
    PlanRuntimeError,
    PlanRuntimeEvent,
    PlanRoleProgress,
)
from app.modules.plans.service import OpenSpecPlansError, OpenSpecPlansService

router = APIRouter(
    prefix="/api/projects/plans",
    tags=["dashboard"],
    dependencies=[Depends(validate_dashboard_session), Depends(set_dashboard_error_format)],
)


def get_plans_service() -> OpenSpecPlansService:
    return OpenSpecPlansService()


@router.get("", response_model=OpenSpecPlansResponse)
async def list_open_spec_plans(
    service: OpenSpecPlansService = Depends(get_plans_service),
) -> OpenSpecPlansResponse:
    try:
        entries = service.list_plans()
    except OpenSpecPlansError as exc:
        raise DashboardServiceUnavailableError(
            "Unable to read OpenSpec plans",
            code="plans_unavailable",
        ) from exc

    return OpenSpecPlansResponse(
        entries=[
            OpenSpecPlanSummary(
                slug=entry.slug,
                title=entry.title,
                status=entry.status,
                created_at=entry.created_at,
                updated_at=entry.updated_at,
                summary_markdown=entry.summary_markdown,
                roles=[
                    PlanRoleProgress(
                        role=role.role,
                        total_checkpoints=role.total_checkpoints,
                        done_checkpoints=role.done_checkpoints,
                    )
                    for role in entry.roles
                ],
                overall_progress=PlanOverallProgress(
                    total_checkpoints=entry.overall_progress.total_checkpoints,
                    done_checkpoints=entry.overall_progress.done_checkpoints,
                    percent_complete=entry.overall_progress.percent_complete,
                ),
                current_checkpoint=(
                    PlanCheckpoint(
                        timestamp=entry.current_checkpoint.timestamp,
                        role=entry.current_checkpoint.role,
                        checkpoint_id=entry.current_checkpoint.checkpoint_id,
                        state=entry.current_checkpoint.state,
                        message=entry.current_checkpoint.message,
                    )
                    if entry.current_checkpoint is not None
                    else None
                ),
            )
            for entry in entries
        ]
    )


@router.get("/{plan_slug}", response_model=OpenSpecPlanDetail)
async def get_open_spec_plan(
    plan_slug: str,
    service: OpenSpecPlansService = Depends(get_plans_service),
) -> OpenSpecPlanDetail:
    try:
        detail = service.get_plan(plan_slug)
    except OpenSpecPlansError as exc:
        raise DashboardServiceUnavailableError(
            "Unable to read OpenSpec plan",
            code="plans_unavailable",
        ) from exc

    if detail is None:
        raise DashboardNotFoundError("Plan not found", code="plan_not_found")

    return OpenSpecPlanDetail(
        slug=detail.slug,
        title=detail.title,
        status=detail.status,
        created_at=detail.created_at,
        updated_at=detail.updated_at,
        summary_markdown=detail.summary_markdown,
        checkpoints_markdown=detail.checkpoints_markdown,
        roles=[
            OpenSpecPlanRoleDetail(
                role=role.role,
                total_checkpoints=role.total_checkpoints,
                done_checkpoints=role.done_checkpoints,
                tasks_markdown=role.tasks_markdown,
                checkpoints_markdown=role.checkpoints_markdown,
            )
            for role in detail.roles
        ],
        overall_progress=PlanOverallProgress(
            total_checkpoints=detail.overall_progress.total_checkpoints,
            done_checkpoints=detail.overall_progress.done_checkpoints,
            percent_complete=detail.overall_progress.percent_complete,
        ),
        current_checkpoint=(
            PlanCheckpoint(
                timestamp=detail.current_checkpoint.timestamp,
                role=detail.current_checkpoint.role,
                checkpoint_id=detail.current_checkpoint.checkpoint_id,
                state=detail.current_checkpoint.state,
                message=detail.current_checkpoint.message,
            )
            if detail.current_checkpoint is not None
            else None
        ),
        prompt_bundles=[
            PlanPromptBundle(
                id=bundle.id,
                title=bundle.title,
                source_path=bundle.source_path,
                prompts=[
                    PlanPromptItem(
                        id=prompt.id,
                        title=prompt.title,
                        content=prompt.content,
                        source_path=prompt.source_path,
                    )
                    for prompt in bundle.prompts
                ],
            )
            for bundle in detail.prompt_bundles
        ],
    )


@router.get("/{plan_slug}/runtime", response_model=OpenSpecPlanRuntime)
async def get_open_spec_plan_runtime(
    plan_slug: str,
    service: OpenSpecPlansService = Depends(get_plans_service),
) -> OpenSpecPlanRuntime:
    try:
        runtime = service.get_plan_runtime(plan_slug)
    except OpenSpecPlansError as exc:
        raise DashboardServiceUnavailableError(
            "Unable to read OpenSpec plan runtime",
            code="plans_runtime_unavailable",
        ) from exc

    if runtime is None:
        raise DashboardNotFoundError("Plan not found", code="plan_not_found")

    return OpenSpecPlanRuntime(
        available=runtime.available,
        session_id=runtime.session_id,
        correlation_confidence=runtime.correlation_confidence,
        mode=runtime.mode,
        phase=runtime.phase,
        active=runtime.active,
        updated_at=runtime.updated_at,
        agents=[
            PlanRuntimeAgent(
                name=agent.name,
                role=agent.role,
                model=agent.model,
                status=agent.status,
                started_at=agent.started_at,
                updated_at=agent.updated_at,
                source=agent.source,
                authoritative=agent.authoritative,
            )
            for agent in runtime.agents
        ],
        events=[
            PlanRuntimeEvent(
                ts=event.ts,
                kind=event.kind,
                message=event.message,
                agent_name=event.agent_name,
                role=event.role,
                model=event.model,
                status=event.status,
                source=event.source,
                authoritative=event.authoritative,
            )
            for event in runtime.events
        ],
        last_checkpoint=(
            PlanCheckpoint(
                timestamp=runtime.last_checkpoint.timestamp,
                role=runtime.last_checkpoint.role,
                checkpoint_id=runtime.last_checkpoint.checkpoint_id,
                state=runtime.last_checkpoint.state,
                message=runtime.last_checkpoint.message,
            )
            if runtime.last_checkpoint is not None
            else None
        ),
        last_error=(
            PlanRuntimeError(
                timestamp=runtime.last_error.timestamp,
                code=runtime.last_error.code,
                message=runtime.last_error.message,
                source=runtime.last_error.source,
                recoverable=runtime.last_error.recoverable,
            )
            if runtime.last_error is not None
            else None
        ),
        can_resume=runtime.can_resume,
        partial=runtime.partial,
        stale_after_seconds=runtime.stale_after_seconds,
        reasons=runtime.reasons,
        unavailable_reason=runtime.unavailable_reason,
    )
