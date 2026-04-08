from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from app.core.auth.dependencies import set_dashboard_error_format, validate_dashboard_session
from app.core.exceptions import (
    DashboardBadRequestError,
    DashboardConflictError,
    DashboardNotFoundError,
    DashboardServiceUnavailableError,
)
from app.dependencies import BillingContext, get_billing_context
from app.modules.billing.schemas import (
    BillingAccount,
    BillingAccountCreateRequest,
    BillingAccountDeleteRequest,
    BillingAccountsResponse,
    BillingAccountsUpdateRequest,
    BillingCycle,
    BillingMember,
)
from app.modules.billing.service import (
    BillingAccountConflictError,
    BillingAccountCreateData,
    BillingAccountData,
    BillingAccountNotFoundError,
    BillingAccountValidationError,
    BillingCycleData,
    BillingMemberData,
    BillingSummaryUnavailableError,
)

router = APIRouter(
    prefix="/api/billing",
    tags=["dashboard"],
    dependencies=[Depends(validate_dashboard_session), Depends(set_dashboard_error_format)],
)


@router.get("", response_model=BillingAccountsResponse)
async def get_billing_accounts(
    context: BillingContext = Depends(get_billing_context),
) -> BillingAccountsResponse:
    try:
        payload = await context.service.get_accounts()
    except BillingSummaryUnavailableError as exc:
        raise DashboardServiceUnavailableError(str(exc), code="billing_summary_unavailable") from exc
    return BillingAccountsResponse(accounts=[_to_schema(account) for account in payload.accounts])


@router.put("", response_model=BillingAccountsResponse)
async def update_billing_accounts(
    payload: BillingAccountsUpdateRequest,
    context: BillingContext = Depends(get_billing_context),
) -> BillingAccountsResponse:
    try:
        updated = await context.service.update_accounts([_from_schema(account) for account in payload.accounts])
    except BillingAccountValidationError as exc:
        raise DashboardBadRequestError(str(exc), code="invalid_billing_payload") from exc
    except BillingSummaryUnavailableError as exc:
        raise DashboardServiceUnavailableError(str(exc), code="billing_summary_unavailable") from exc

    return BillingAccountsResponse(accounts=[_to_schema(account) for account in updated.accounts])


@router.post("/accounts", response_model=BillingAccount)
async def create_billing_account(
    payload: BillingAccountCreateRequest,
    context: BillingContext = Depends(get_billing_context),
) -> BillingAccount:
    try:
        account = await context.service.add_account(
            BillingAccountCreateData(
                domain=payload.domain,
                plan_code=payload.plan_code,
                plan_name=payload.plan_name,
                subscription_status=payload.subscription_status,
                payment_status=payload.payment_status,
                entitled=payload.entitled,
                renewal_at=payload.renewal_at,
                chatgpt_seats_in_use=payload.chatgpt_seats_in_use,
                codex_seats_in_use=payload.codex_seats_in_use,
            )
        )
    except BillingAccountConflictError as exc:
        raise DashboardConflictError(str(exc), code="billing_account_exists") from exc
    except BillingAccountValidationError as exc:
        raise DashboardBadRequestError(str(exc), code="invalid_billing_account_payload") from exc
    except BillingSummaryUnavailableError as exc:
        raise DashboardServiceUnavailableError(str(exc), code="billing_summary_unavailable") from exc

    return _to_schema(account)


@router.delete("/accounts", status_code=204, response_class=Response)
async def delete_billing_account(
    payload: BillingAccountDeleteRequest,
    context: BillingContext = Depends(get_billing_context),
) -> Response:
    try:
        await context.service.delete_account(payload.id)
    except BillingAccountNotFoundError as exc:
        raise DashboardNotFoundError(str(exc), code="billing_account_not_found") from exc
    except BillingAccountValidationError as exc:
        raise DashboardBadRequestError(str(exc), code="invalid_billing_account_payload") from exc
    except BillingSummaryUnavailableError as exc:
        raise DashboardServiceUnavailableError(str(exc), code="billing_summary_unavailable") from exc

    return Response(status_code=204)


def _from_schema(account: BillingAccount) -> BillingAccountData:
    return BillingAccountData(
        id=account.id,
        domain=account.domain,
        plan_code=account.plan_code,
        plan_name=account.plan_name,
        subscription_status=account.subscription_status,
        entitled=account.entitled,
        payment_status=account.payment_status,
        billing_cycle=BillingCycleData(
            start=account.billing_cycle.start,
            end=account.billing_cycle.end,
        ),
        renewal_at=account.renewal_at,
        chatgpt_seats_in_use=account.chatgpt_seats_in_use,
        codex_seats_in_use=account.codex_seats_in_use,
        members=[
            BillingMemberData(
                id=member.id,
                name=member.name,
                email=member.email,
                role="Owner" if member.role == "Owner" else "Member",
                seat_type="Codex" if member.seat_type == "Codex" else "ChatGPT",
                date_added=member.date_added,
            )
            for member in account.members
        ],
    )


def _to_schema(account: BillingAccountData) -> BillingAccount:
    return BillingAccount(
        id=account.id,
        domain=account.domain,
        plan_code=account.plan_code,
        plan_name=account.plan_name,
        subscription_status=account.subscription_status,
        entitled=account.entitled,
        payment_status=account.payment_status,
        billing_cycle=BillingCycle(
            start=account.billing_cycle.start,
            end=account.billing_cycle.end,
        ),
        renewal_at=account.renewal_at,
        chatgpt_seats_in_use=account.chatgpt_seats_in_use,
        codex_seats_in_use=account.codex_seats_in_use,
        members=[
            BillingMember(
                id=member.id,
                name=member.name,
                email=member.email,
                role="Owner" if member.role == "Owner" else "Member",
                seat_type="Codex" if member.seat_type == "Codex" else "ChatGPT",
                date_added=member.date_added,
            )
            for member in account.members
        ],
    )
