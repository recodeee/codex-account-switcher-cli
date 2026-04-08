from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Literal

import aiohttp
from pydantic import BaseModel, ConfigDict, ValidationError

from app.core.clients.http import get_http_client
from app.core.config.settings import get_settings
from app.core.types import JsonObject
from app.core.utils.request_id import get_request_id
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

BILLING_SUMMARY_UNAVAILABLE_MESSAGE = "Medusa billing summary is unavailable"


class _MedusaBillingModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class MedusaBillingMemberPayload(_MedusaBillingModel):
    id: str
    name: str
    email: str
    role: Literal["Owner", "Member"]
    seat_type: Literal["ChatGPT", "Codex"]
    date_added: str


class MedusaBillingCyclePayload(_MedusaBillingModel):
    start: str
    end: str


class MedusaBillingAccountPayload(_MedusaBillingModel):
    id: str
    domain: str
    plan_code: str
    plan_name: str
    subscription_status: Literal["trialing", "active", "past_due", "canceled", "expired"]
    entitled: bool
    payment_status: Literal["paid", "requires_action", "past_due", "unpaid"]
    billing_cycle: MedusaBillingCyclePayload
    renewal_at: str | None = None
    chatgpt_seats_in_use: int
    codex_seats_in_use: int
    members: list[MedusaBillingMemberPayload]


class MedusaBillingSummaryPayload(_MedusaBillingModel):
    accounts: list[MedusaBillingAccountPayload]


class MedusaErrorEnvelope(_MedusaBillingModel):
    message: str | None = None
    code: str | None = None


class MedusaErrorPayload(_MedusaBillingModel):
    error: MedusaErrorEnvelope | None = None


class MedusaBillingSummaryClient:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        session: aiohttp.ClientSession | None = None,
    ) -> None:
        self._base_url = (base_url or get_settings().medusa_backend_url).rstrip("/")
        self._session = session

    async def fetch_accounts(self) -> list[BillingAccountData]:
        settings = get_settings()
        client_session = self._session or get_http_client().session
        headers = {"Accept": "application/json"}
        request_id = get_request_id()
        if request_id:
            headers["x-request-id"] = request_id
        timeout = aiohttp.ClientTimeout(total=settings.billing_summary_timeout_seconds)
        url = f"{self._base_url}/billing/summary"

        try:
            async with client_session.get(url, headers=headers, timeout=timeout) as response:
                payload = await _safe_json(response)
                if response.status >= 400:
                    raise BillingSummaryUnavailableError(BILLING_SUMMARY_UNAVAILABLE_MESSAGE)
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            raise BillingSummaryUnavailableError(BILLING_SUMMARY_UNAVAILABLE_MESSAGE) from exc

        return _parse_summary_accounts(payload)

    async def update_accounts(self, accounts: list[BillingAccountData]) -> list[BillingAccountData]:
        settings = get_settings()
        client_session = self._session or get_http_client().session
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        request_id = get_request_id()
        if request_id:
            headers["x-request-id"] = request_id
        timeout = aiohttp.ClientTimeout(total=settings.billing_summary_timeout_seconds)
        url = f"{self._base_url}/billing"

        payload = {"accounts": [_account_to_json(account) for account in accounts]}

        try:
            async with client_session.put(url, headers=headers, json=payload, timeout=timeout) as response:
                raw_payload = await _safe_json(response)
                if response.status >= 500:
                    raise BillingSummaryUnavailableError(BILLING_SUMMARY_UNAVAILABLE_MESSAGE)
                if response.status >= 400:
                    raise BillingAccountValidationError(
                        _extract_error_message(raw_payload, "Billing payload is invalid")
                    )
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            raise BillingSummaryUnavailableError(BILLING_SUMMARY_UNAVAILABLE_MESSAGE) from exc

        return _parse_summary_accounts(raw_payload)

    async def add_account(self, account: BillingAccountCreateData) -> BillingAccountData:
        settings = get_settings()
        client_session = self._session or get_http_client().session
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        request_id = get_request_id()
        if request_id:
            headers["x-request-id"] = request_id
        timeout = aiohttp.ClientTimeout(total=settings.billing_summary_timeout_seconds)
        url = f"{self._base_url}/billing/accounts"

        payload = {
            "domain": account.domain,
            "plan_code": account.plan_code,
            "plan_name": account.plan_name,
            "subscription_status": account.subscription_status,
            "payment_status": account.payment_status,
            "entitled": account.entitled,
            "renewal_at": account.renewal_at.isoformat().replace("+00:00", "Z")
            if account.renewal_at is not None
            else None,
            "chatgpt_seats_in_use": account.chatgpt_seats_in_use,
            "codex_seats_in_use": account.codex_seats_in_use,
        }

        try:
            async with client_session.post(url, headers=headers, json=payload, timeout=timeout) as response:
                raw_payload = await _safe_json(response)
                if response.status == 409:
                    raise BillingAccountConflictError(_extract_error_message(raw_payload, "Billing account already exists"))
                if response.status >= 500:
                    raise BillingSummaryUnavailableError(BILLING_SUMMARY_UNAVAILABLE_MESSAGE)
                if response.status >= 400:
                    raise BillingAccountValidationError(
                        _extract_error_message(raw_payload, "Billing account payload is invalid")
                    )
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            raise BillingSummaryUnavailableError(BILLING_SUMMARY_UNAVAILABLE_MESSAGE) from exc

        try:
            created = MedusaBillingAccountPayload.model_validate(raw_payload)
        except ValidationError as exc:
            raise BillingSummaryUnavailableError(BILLING_SUMMARY_UNAVAILABLE_MESSAGE) from exc

        return _to_account(created)

    async def delete_account(self, account_id: str) -> None:
        settings = get_settings()
        client_session = self._session or get_http_client().session
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        request_id = get_request_id()
        if request_id:
            headers["x-request-id"] = request_id
        timeout = aiohttp.ClientTimeout(total=settings.billing_summary_timeout_seconds)
        url = f"{self._base_url}/billing/accounts"

        try:
            async with client_session.delete(
                url,
                headers=headers,
                json={"id": account_id},
                timeout=timeout,
            ) as response:
                raw_payload = await _safe_json(response)
                if response.status == 404:
                    raise BillingAccountNotFoundError(
                        _extract_error_message(raw_payload, f"Billing account not found: {account_id}")
                    )
                if response.status >= 500:
                    raise BillingSummaryUnavailableError(BILLING_SUMMARY_UNAVAILABLE_MESSAGE)
                if response.status >= 400:
                    raise BillingAccountValidationError(
                        _extract_error_message(raw_payload, "Billing account payload is invalid")
                    )
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            raise BillingSummaryUnavailableError(BILLING_SUMMARY_UNAVAILABLE_MESSAGE) from exc


async def _safe_json(response: aiohttp.ClientResponse) -> JsonObject:
    try:
        payload = await response.json(content_type=None)
    except Exception:
        text = await response.text()
        return {"error": {"message": text.strip()}}
    return payload if isinstance(payload, dict) else {"error": {"message": str(payload)}}


def _parse_summary_accounts(payload: JsonObject) -> list[BillingAccountData]:
    try:
        summary = MedusaBillingSummaryPayload.model_validate(payload)
    except ValidationError as exc:
        raise BillingSummaryUnavailableError(BILLING_SUMMARY_UNAVAILABLE_MESSAGE) from exc

    return [_to_account(account) for account in summary.accounts]


def _account_to_json(account: BillingAccountData) -> JsonObject:
    return {
        "id": account.id,
        "domain": account.domain,
        "plan_code": account.plan_code,
        "plan_name": account.plan_name,
        "subscription_status": account.subscription_status,
        "entitled": account.entitled,
        "payment_status": account.payment_status,
        "billing_cycle": {
            "start": account.billing_cycle.start.isoformat().replace("+00:00", "Z"),
            "end": account.billing_cycle.end.isoformat().replace("+00:00", "Z"),
        },
        "renewal_at": account.renewal_at.isoformat().replace("+00:00", "Z") if account.renewal_at else None,
        "chatgpt_seats_in_use": account.chatgpt_seats_in_use,
        "codex_seats_in_use": account.codex_seats_in_use,
        "members": [
            {
                "id": member.id,
                "name": member.name,
                "email": member.email,
                "role": member.role,
                "seat_type": member.seat_type,
                "date_added": member.date_added,
            }
            for member in account.members
        ],
    }


def _to_account(payload: MedusaBillingAccountPayload) -> BillingAccountData:
    return BillingAccountData(
        id=payload.id,
        domain=payload.domain,
        plan_code=payload.plan_code,
        plan_name=payload.plan_name,
        subscription_status=payload.subscription_status,
        entitled=payload.entitled,
        payment_status=payload.payment_status,
        billing_cycle=BillingCycleData(
            start=_parse_datetime(payload.billing_cycle.start),
            end=_parse_datetime(payload.billing_cycle.end),
        ),
        renewal_at=None if payload.renewal_at is None else _parse_datetime(payload.renewal_at),
        chatgpt_seats_in_use=payload.chatgpt_seats_in_use,
        codex_seats_in_use=payload.codex_seats_in_use,
        members=[
            BillingMemberData(
                id=member.id,
                name=member.name,
                email=member.email,
                role=member.role,
                seat_type=member.seat_type,
                date_added=member.date_added,
            )
            for member in payload.members
        ],
    )


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _extract_error_message(payload: JsonObject, fallback: str) -> str:
    try:
        parsed = MedusaErrorPayload.model_validate(payload)
    except ValidationError:
        return fallback
    if parsed.error is None or not parsed.error.message:
        return fallback
    return parsed.error.message
