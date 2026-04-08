from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.modules.billing.service import (
    BillingAccountData,
    BillingAccountCreateData,
    BillingAccountValidationError,
    BillingAccountsData,
    BillingCycleData,
    BillingMemberData,
    BillingService,
    BillingSummaryUnavailableError,
)


def _account(*, entitled: bool = True, subscription_status: str = "active") -> BillingAccountData:
    return BillingAccountData(
        id="business-plan-edixai",
        domain="edixai.com",
        plan_code="business",
        plan_name="Business",
        subscription_status=subscription_status,
        entitled=entitled,
        payment_status="paid",
        billing_cycle=BillingCycleData(
            start=datetime(2026, 3, 23, tzinfo=UTC),
            end=datetime(2026, 4, 23, tzinfo=UTC),
        ),
        renewal_at=datetime(2026, 4, 23, tzinfo=UTC),
        chatgpt_seats_in_use=5,
        codex_seats_in_use=5,
        members=[
            BillingMemberData(
                id="member-edixai-owner",
                name="Edix.ai (You)",
                email="admin@edixai.com",
                role="Owner",
                seat_type="ChatGPT",
                date_added="2026-03-23T00:00:00.000Z",
            )
        ],
    )


@pytest.mark.asyncio
async def test_get_accounts_reads_medusa_summary_without_python_seed_defaults() -> None:
    repository = SimpleNamespace(
        list_accounts=AsyncMock(return_value=[]),
        replace_accounts=AsyncMock(),
    )
    summary_provider = SimpleNamespace(fetch_accounts=AsyncMock(return_value=[_account()]))
    service = BillingService(repository, summary_provider)

    with patch("app.modules.billing.service.set_normal") as set_normal:
        result = await service.get_accounts()

    assert result == BillingAccountsData(accounts=[_account()])
    summary_provider.fetch_accounts.assert_awaited_once()
    repository.list_accounts.assert_not_awaited()
    repository.replace_accounts.assert_not_awaited()
    set_normal.assert_called_once_with()


@pytest.mark.asyncio
async def test_get_accounts_marks_degraded_and_raises_when_medusa_summary_is_unavailable() -> None:
    repository = SimpleNamespace(
        list_accounts=AsyncMock(return_value=[]),
        replace_accounts=AsyncMock(),
    )
    summary_provider = SimpleNamespace(
        fetch_accounts=AsyncMock(
            side_effect=BillingSummaryUnavailableError("Medusa billing summary is unavailable")
        )
    )
    service = BillingService(repository, summary_provider)

    with (
        patch("app.modules.billing.service.set_degraded") as set_degraded,
        patch("app.modules.billing.service.set_normal") as set_normal,
    ):
        with pytest.raises(BillingSummaryUnavailableError, match="Medusa billing summary is unavailable"):
            await service.get_accounts()

    summary_provider.fetch_accounts.assert_awaited_once()
    repository.list_accounts.assert_not_awaited()
    repository.replace_accounts.assert_not_awaited()
    set_degraded.assert_called_once()
    set_normal.assert_not_called()


@pytest.mark.asyncio
async def test_add_account_passes_creation_to_summary_provider() -> None:
    repository = SimpleNamespace(
        list_accounts=AsyncMock(return_value=[]),
        replace_accounts=AsyncMock(),
    )
    created_account = _account()
    summary_provider = SimpleNamespace(
        fetch_accounts=AsyncMock(return_value=[]),
        add_account=AsyncMock(return_value=created_account),
    )
    service = BillingService(repository, summary_provider)

    payload = BillingAccountCreateData(
        domain="newshop.example",
        plan_code="business",
        plan_name="Business",
        subscription_status="active",
        payment_status="paid",
        entitled=True,
        renewal_at=datetime(2026, 5, 1, tzinfo=UTC),
        chatgpt_seats_in_use=2,
        codex_seats_in_use=1,
    )

    with patch("app.modules.billing.service.set_normal") as set_normal:
        result = await service.add_account(payload)

    assert result == created_account
    summary_provider.add_account.assert_awaited_once_with(payload)
    set_normal.assert_called_once_with()


@pytest.mark.asyncio
async def test_add_account_propagates_validation_errors() -> None:
    repository = SimpleNamespace(
        list_accounts=AsyncMock(return_value=[]),
        replace_accounts=AsyncMock(),
    )
    summary_provider = SimpleNamespace(
        fetch_accounts=AsyncMock(return_value=[]),
        add_account=AsyncMock(side_effect=BillingAccountValidationError("Domain is required")),
    )
    service = BillingService(repository, summary_provider)

    payload = BillingAccountCreateData(
        domain="",
        plan_code="business",
        plan_name="Business",
        subscription_status="active",
        payment_status="paid",
        entitled=True,
        renewal_at=None,
        chatgpt_seats_in_use=0,
        codex_seats_in_use=0,
    )

    with patch("app.modules.billing.service.set_normal") as set_normal:
        with pytest.raises(BillingAccountValidationError, match="Domain is required"):
            await service.add_account(payload)

    set_normal.assert_not_called()
