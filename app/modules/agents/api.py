from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Response
from starlette.status import HTTP_204_NO_CONTENT

from app.core.auth.dependencies import set_dashboard_error_format, validate_dashboard_session
from app.core.exceptions import DashboardBadRequestError, DashboardConflictError, DashboardNotFoundError
from app.dependencies import AgentsContext, get_agents_context
from app.modules.agents.schemas import (
    AgentCreateRequest,
    AgentEntry,
    AgentsResponse,
    AgentUpdateRequest,
)
from app.modules.agents.service import AgentNameExistsError, AgentValidationError

router = APIRouter(
    prefix="/api/agents",
    tags=["dashboard"],
    dependencies=[Depends(validate_dashboard_session), Depends(set_dashboard_error_format)],
)


@router.get("", response_model=AgentsResponse)
async def list_agents(
    context: AgentsContext = Depends(get_agents_context),
) -> AgentsResponse:
    payload = await context.service.list_agents()
    return AgentsResponse(entries=[AgentEntry.model_validate(entry, from_attributes=True) for entry in payload.entries])


@router.post("", response_model=AgentEntry)
async def create_agent(
    payload: AgentCreateRequest = Body(...),
    context: AgentsContext = Depends(get_agents_context),
) -> AgentEntry:
    try:
        created = await context.service.add_agent(
            name=payload.name,
            description=payload.description,
            visibility=payload.visibility,
            runtime=payload.runtime,
            instructions=payload.instructions,
            max_concurrent_tasks=payload.max_concurrent_tasks,
            avatar_data_url=payload.avatar_data_url,
        )
    except AgentValidationError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc
    except AgentNameExistsError as exc:
        raise DashboardConflictError(str(exc), code="agent_name_exists") from exc

    return AgentEntry.model_validate(created, from_attributes=True)


@router.put("/{agent_id}", response_model=AgentEntry)
async def update_agent(
    agent_id: str,
    payload: AgentUpdateRequest = Body(...),
    context: AgentsContext = Depends(get_agents_context),
) -> AgentEntry:
    try:
        updated = await context.service.update_agent(
            agent_id=agent_id,
            name=payload.name,
            status=payload.status,
            description=payload.description,
            visibility=payload.visibility,
            runtime=payload.runtime,
            instructions=payload.instructions,
            max_concurrent_tasks=payload.max_concurrent_tasks,
            avatar_data_url=payload.avatar_data_url,
        )
    except AgentValidationError as exc:
        raise DashboardBadRequestError(str(exc), code=exc.code) from exc
    except AgentNameExistsError as exc:
        raise DashboardConflictError(str(exc), code="agent_name_exists") from exc

    if updated is None:
        raise DashboardNotFoundError("Agent not found", code="agent_not_found")

    return AgentEntry.model_validate(updated, from_attributes=True)


@router.delete("/{agent_id}", status_code=HTTP_204_NO_CONTENT, response_class=Response)
async def delete_agent(
    agent_id: str,
    context: AgentsContext = Depends(get_agents_context),
) -> Response:
    deleted = await context.service.remove_agent(agent_id)
    if not deleted:
        raise DashboardNotFoundError("Agent not found", code="agent_not_found")
    return Response(status_code=HTTP_204_NO_CONTENT)
