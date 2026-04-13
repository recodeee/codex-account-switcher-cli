from __future__ import annotations

from datetime import UTC, datetime, timedelta
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


def _repository_stub(*, runtime_domains: list[SimpleNamespace] | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        list_accounts=AsyncMock(return_value=[]),
        replace_accounts=AsyncMock(),
        list_runtime_domains=AsyncMock(return_value=runtime_domains or []),
    )


@pytest.mark.asyncio
async def test_get_accounts_reads_medusa_summary_without_python_seed_defaults() -> None:
    repository = _repository_stub()
    summary_provider = SimpleNamespace(
        fetch_accounts=AsyncMock(return_value=[_account()]),
        update_accounts=AsyncMock(),
        add_account=AsyncMock(),
        delete_account=AsyncMock(),
    )
    service = BillingService(repository, summary_provider)

    with patch("app.modules.billing.service.set_normal") as set_normal:
        result = await service.get_accounts()

    assert result == BillingAccountsData(accounts=[_account()])
    summary_provider.fetch_accounts.assert_awaited_once()
    repository.list_runtime_domains.assert_awaited_once()
    repository.list_accounts.assert_not_awaited()
    repository.replace_accounts.assert_not_awaited()
    set_normal.assert_called_once_with()


@pytest.mark.asyncio
async def test_get_accounts_marks_degraded_and_raises_when_medusa_summary_is_unavailable() -> None:
    repository = _repository_stub()
    summary_provider = SimpleNamespace(
        fetch_accounts=AsyncMock(
            side_effect=BillingSummaryUnavailableError("Medusa billing summary is unavailable")
        ),
        update_accounts=AsyncMock(),
        add_account=AsyncMock(),
        delete_account=AsyncMock(),
    )
    service = BillingService(repository, summary_provider)

    with (
        patch("app.modules.billing.service.set_degraded") as set_degraded,
        patch("app.modules.billing.service.set_normal") as set_normal,
    ):
        with pytest.raises(BillingSummaryUnavailableError, match="Medusa billing summary is unavailable"):
            await service.get_accounts()

    summary_provider.fetch_accounts.assert_awaited_once()
    repository.list_runtime_domains.assert_not_awaited()
    repository.list_accounts.assert_not_awaited()
    repository.replace_accounts.assert_not_awaited()
    set_degraded.assert_called_once()
    set_normal.assert_not_called()


@pytest.mark.asyncio
async def test_update_accounts_passes_updates_to_summary_provider() -> None:
    repository = _repository_stub()
    updated_account = _account()
    summary_provider = SimpleNamespace(
        fetch_accounts=AsyncMock(return_value=[]),
        update_accounts=AsyncMock(return_value=[updated_account]),
        add_account=AsyncMock(),
    )
    service = BillingService(repository, summary_provider)

    with patch("app.modules.billing.service.set_normal") as set_normal:
        result = await service.update_accounts([updated_account])

    assert result == BillingAccountsData(accounts=[updated_account])
    summary_provider.update_accounts.assert_awaited_once_with([updated_account])
    set_normal.assert_called_once_with()


@pytest.mark.asyncio
async def test_add_account_passes_creation_to_summary_provider() -> None:
    repository = _repository_stub()
    created_account = _account()
    summary_provider = SimpleNamespace(
        fetch_accounts=AsyncMock(return_value=[]),
        update_accounts=AsyncMock(return_value=[]),
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
    repository = _repository_stub()
    summary_provider = SimpleNamespace(
        fetch_accounts=AsyncMock(return_value=[]),
        update_accounts=AsyncMock(return_value=[]),
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


@pytest.mark.asyncio
async def test_delete_account_passes_deletion_to_summary_provider() -> None:
    repository = _repository_stub()
    summary_provider = SimpleNamespace(
        fetch_accounts=AsyncMock(return_value=[]),
        update_accounts=AsyncMock(return_value=[]),
        add_account=AsyncMock(),
        delete_account=AsyncMock(return_value=None),
    )
    service = BillingService(repository, summary_provider)

    with patch("app.modules.billing.service.set_normal") as set_normal:
        await service.delete_account("business-plan-edixai")

    summary_provider.delete_account.assert_awaited_once_with("business-plan-edixai")
    set_normal.assert_called_once_with()


@pytest.mark.asyncio
async def test_get_accounts_auto_adds_runtime_domains_with_default_chatgpt_seats() -> None:
    runtime_domains = [
        SimpleNamespace(domain="newshop.hu", first_detected_at=datetime(2026, 4, 10, tzinfo=UTC)),
        SimpleNamespace(domain="gmail.com", first_detected_at=datetime(2026, 4, 8, tzinfo=UTC)),
    ]
    repository = _repository_stub(runtime_domains=runtime_domains)
    summary_provider = SimpleNamespace(
        fetch_accounts=AsyncMock(side_effect=[[_account()], [_account(), _account()]]),
        update_accounts=AsyncMock(return_value=[]),
        add_account=AsyncMock(return_value=_account()),
        delete_account=AsyncMock(),
    )
    service = BillingService(repository, summary_provider)

    with patch("app.modules.billing.service.set_normal"):
        await service.get_accounts()

    summary_provider.add_account.assert_awaited_once()
    payload = summary_provider.add_account.await_args.args[0]
    assert payload.domain == "newshop.hu"
    assert payload.chatgpt_seats_in_use == 5
    assert payload.codex_seats_in_use == 0
    assert payload.renewal_at == datetime(2026, 4, 10, tzinfo=UTC) + timedelta(days=30)
    assert summary_provider.fetch_accounts.await_count == 2


@pytest.mark.asyncio
async def test_get_accounts_skips_auto_add_for_existing_or_gmail_domains() -> None:
    runtime_domains = [
        SimpleNamespace(domain="edixai.com", first_detected_at=datetime(2026, 4, 1, tzinfo=UTC)),
        SimpleNamespace(domain="gmail.com", first_detected_at=datetime(2026, 4, 2, tzinfo=UTC)),
    ]
    repository = _repository_stub(runtime_domains=runtime_domains)
    summary_provider = SimpleNamespace(
        fetch_accounts=AsyncMock(return_value=[_account()]),
        update_accounts=AsyncMock(return_value=[]),
        add_account=AsyncMock(),
        delete_account=AsyncMock(),
    )
    service = BillingService(repository, summary_provider)

    with patch("app.modules.billing.service.set_normal"):
        await service.get_accounts()

    summary_provider.add_account.assert_not_awaited()
