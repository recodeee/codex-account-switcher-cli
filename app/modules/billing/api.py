from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.auth.dependencies import set_dashboard_error_format, validate_dashboard_session
from app.core.exceptions import (
    DashboardBadRequestError,
    DashboardConflictError,
    DashboardServiceUnavailableError,
)
from app.dependencies import BillingContext, get_billing_context
from app.modules.billing.schemas import (
    BillingAccount,
    BillingAccountCreateRequest,
    BillingAccountsResponse,
    BillingCycle,
    BillingMember,
)
from app.modules.billing.service import (
    BillingAccountCreateData,
    BillingAccountConflictError,
    BillingAccountData,
    BillingAccountValidationError,
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
    context: BillingContext = Depends(get_billing_context),
) -> BillingAccountsResponse:
    del context
    raise DashboardBadRequestError(
        "Billing mutations must be applied through Medusa workflows",
        code="billing_mutations_unavailable",
    )


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
