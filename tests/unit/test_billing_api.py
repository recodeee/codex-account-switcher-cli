from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest

from app.dependencies import BillingContext, get_billing_context
from app.modules.billing.service import (
    BillingAccountData,
    BillingAccountConflictError,
    BillingAccountNotFoundError,
    BillingAccountValidationError,
    BillingAccountsData,
    BillingCycleData,
    BillingMemberData,
    BillingSummaryUnavailableError,
)


def _billing_account(*, entitled: bool = True, subscription_status: str = "active") -> BillingAccountData:
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


def _context(
    *,
    get_accounts: AsyncMock | None = None,
    update_accounts: AsyncMock | None = None,
    add_account: AsyncMock | None = None,
    delete_account: AsyncMock | None = None,
) -> BillingContext:
    service = SimpleNamespace(
        get_accounts=get_accounts or AsyncMock(),
        update_accounts=update_accounts or AsyncMock(),
        add_account=add_account or AsyncMock(),
        delete_account=delete_account or AsyncMock(),
    )
    return cast(
        BillingContext,
        SimpleNamespace(
            session=object(),
            repository=object(),
            service=service,
        ),
    )


@pytest.mark.asyncio
async def test_get_billing_accounts_returns_live_subscription_fields(async_client, app_instance) -> None:
    context = _context(
        get_accounts=AsyncMock(return_value=BillingAccountsData(accounts=[_billing_account()])),
    )
    app_instance.dependency_overrides[get_billing_context] = lambda: context

    try:
        response = await async_client.get("/api/billing")
    finally:
        app_instance.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {
        "accounts": [
            {
                "id": "business-plan-edixai",
                "domain": "edixai.com",
                "planCode": "business",
                "planName": "Business",
                "subscriptionStatus": "active",
                "entitled": True,
                "paymentStatus": "paid",
                "billingCycle": {
                    "start": "2026-03-23T00:00:00Z",
                    "end": "2026-04-23T00:00:00Z",
                },
                "renewalAt": "2026-04-23T00:00:00Z",
                "chatgptSeatsInUse": 5,
                "codexSeatsInUse": 5,
                "members": [
                    {
                        "id": "member-edixai-owner",
                        "name": "Edix.ai (You)",
                        "email": "admin@edixai.com",
                        "role": "Owner",
                        "seatType": "ChatGPT",
                        "dateAdded": "2026-03-23T00:00:00.000Z",
                    }
                ],
            }
        ]
    }


@pytest.mark.asyncio
async def test_get_billing_accounts_returns_503_when_medusa_summary_is_unavailable(
    async_client,
    app_instance,
) -> None:
    context = _context(
        get_accounts=AsyncMock(
            side_effect=BillingSummaryUnavailableError("Medusa billing summary is unavailable")
        ),
    )
    app_instance.dependency_overrides[get_billing_context] = lambda: context

    try:
        response = await async_client.get("/api/billing")
    finally:
        app_instance.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "billing_summary_unavailable",
            "message": "Medusa billing summary is unavailable",
        }
    }


@pytest.mark.asyncio
async def test_update_billing_accounts_returns_updated_summary(async_client, app_instance) -> None:
    updated_account = _billing_account()
    context = _context(
        update_accounts=AsyncMock(return_value=BillingAccountsData(accounts=[updated_account])),
    )
    app_instance.dependency_overrides[get_billing_context] = lambda: context

    try:
        response = await async_client.put(
            "/api/billing",
            json={
                "accounts": [
                    {
                        "id": "business-plan-edixai",
                        "domain": "edixai.com",
                        "planCode": "business",
                        "planName": "Business",
                        "subscriptionStatus": "active",
                        "entitled": True,
                        "paymentStatus": "paid",
                        "billingCycle": {
                            "start": "2026-03-23T00:00:00Z",
                            "end": "2026-04-23T00:00:00Z",
                        },
                        "renewalAt": "2026-04-23T00:00:00Z",
                        "chatgptSeatsInUse": 7,
                        "codexSeatsInUse": 3,
                        "members": [
                            {
                                "id": "member-edixai-owner",
                                "name": "Edix.ai (You)",
                                "email": "admin@edixai.com",
                                "role": "Owner",
                                "seatType": "ChatGPT",
                                "dateAdded": "2026-03-23T00:00:00.000Z",
                            }
                        ],
                    }
                ]
            },
        )
    finally:
        app_instance.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["accounts"][0]["id"] == "business-plan-edixai"
    context.service.update_accounts.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_billing_accounts_returns_bad_request_for_invalid_payload(async_client, app_instance) -> None:
    context = _context(
        update_accounts=AsyncMock(side_effect=BillingAccountValidationError("Unknown billing account missing")),
    )
    app_instance.dependency_overrides[get_billing_context] = lambda: context

    try:
        response = await async_client.put(
            "/api/billing",
            json={
                "accounts": [
                    {
                        "id": "missing",
                        "domain": "edixai.com",
                        "planCode": "business",
                        "planName": "Business",
                        "subscriptionStatus": "active",
                        "entitled": True,
                        "paymentStatus": "paid",
                        "billingCycle": {
                            "start": "2026-03-23T00:00:00Z",
                            "end": "2026-04-23T00:00:00Z",
                        },
                        "renewalAt": "2026-04-23T00:00:00Z",
                        "chatgptSeatsInUse": 7,
                        "codexSeatsInUse": 3,
                        "members": [],
                    }
                ]
            },
        )
    finally:
        app_instance.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json() == {
        "error": {
            "code": "invalid_billing_payload",
            "message": "Unknown billing account missing",
        }
    }


@pytest.mark.asyncio
async def test_create_billing_account_returns_created_account(async_client, app_instance) -> None:
    created_account = _billing_account()
    context = _context(
        add_account=AsyncMock(return_value=created_account),
    )
    app_instance.dependency_overrides[get_billing_context] = lambda: context

    try:
        response = await async_client.post(
            "/api/billing/accounts",
            json={
                "domain": "newshop.example",
                "planCode": "business",
                "planName": "Business",
                "subscriptionStatus": "active",
                "paymentStatus": "paid",
                "entitled": True,
                "renewalAt": "2026-04-23T00:00:00Z",
                "chatgptSeatsInUse": 0,
                "codexSeatsInUse": 0,
            },
        )
    finally:
        app_instance.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "business-plan-edixai"
    assert payload["domain"] == "edixai.com"
    context.service.add_account.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_billing_account_returns_conflict_for_duplicate_domain(async_client, app_instance) -> None:
    context = _context(
        add_account=AsyncMock(
            side_effect=BillingAccountConflictError("Subscription account already exists for edixai.com")
        ),
    )
    app_instance.dependency_overrides[get_billing_context] = lambda: context

    try:
        response = await async_client.post("/api/billing/accounts", json={"domain": "edixai.com"})
    finally:
        app_instance.dependency_overrides.clear()

    assert response.status_code == 409
    assert response.json() == {
        "error": {
            "code": "billing_account_exists",
            "message": "Subscription account already exists for edixai.com",
        }
    }


@pytest.mark.asyncio
async def test_create_billing_account_returns_bad_request_for_invalid_payload(async_client, app_instance) -> None:
    context = _context(
        add_account=AsyncMock(side_effect=BillingAccountValidationError("Domain is required")),
    )
    app_instance.dependency_overrides[get_billing_context] = lambda: context

    try:
        response = await async_client.post("/api/billing/accounts", json={"domain": "newshop.example"})
    finally:
        app_instance.dependency_overrides.clear()

    assert response.status_code == 400
    assert response.json() == {
        "error": {
            "code": "invalid_billing_account_payload",
            "message": "Domain is required",
        }
    }


@pytest.mark.asyncio
async def test_create_billing_account_returns_422_when_domain_is_missing(async_client) -> None:
    response = await async_client.post("/api/billing/accounts", json={})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_billing_account_returns_503_when_medusa_is_unavailable(async_client, app_instance) -> None:
    context = _context(
        add_account=AsyncMock(
            side_effect=BillingSummaryUnavailableError("Medusa billing summary is unavailable")
        ),
    )
    app_instance.dependency_overrides[get_billing_context] = lambda: context

    try:
        response = await async_client.post("/api/billing/accounts", json={"domain": "newshop.example"})
    finally:
        app_instance.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "billing_summary_unavailable",
            "message": "Medusa billing summary is unavailable",
        }
    }


@pytest.mark.asyncio
async def test_delete_billing_account_returns_204(async_client, app_instance) -> None:
    context = _context(
        delete_account=AsyncMock(return_value=None),
    )
    app_instance.dependency_overrides[get_billing_context] = lambda: context

    try:
        response = await async_client.request(
            "DELETE",
            "/api/billing/accounts",
            json={"id": "business-plan-edixai"},
        )
    finally:
        app_instance.dependency_overrides.clear()

    assert response.status_code == 204
    context.service.delete_account.assert_awaited_once_with("business-plan-edixai")


@pytest.mark.asyncio
async def test_delete_billing_account_returns_404_for_missing_account(async_client, app_instance) -> None:
    context = _context(
        delete_account=AsyncMock(
            side_effect=BillingAccountNotFoundError("Billing account not found: missing")
        ),
    )
    app_instance.dependency_overrides[get_billing_context] = lambda: context

    try:
        response = await async_client.request(
            "DELETE",
            "/api/billing/accounts",
            json={"id": "missing"},
        )
    finally:
        app_instance.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "billing_account_not_found",
            "message": "Billing account not found: missing",
        }
    }
