from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, Protocol

from app.core.resilience.degradation import set_degraded, set_normal
from app.modules.billing.repository import BillingRepository

SubscriptionStatus = Literal["trialing", "active", "past_due", "canceled", "expired"]
PaymentStatus = Literal["paid", "requires_action", "past_due", "unpaid"]
BillingRole = Literal["Owner", "Member"]
SeatType = Literal["ChatGPT", "Codex"]
_EXCLUDED_AUTO_DOMAIN_SUFFIXES = ("gmail.com", "googlemail.com")
_AUTO_CHATGPT_SEATS = 5
_AUTO_CODEX_SEATS = 0
_AUTO_RENEWAL_OFFSET_DAYS = 30


class BillingSummaryUnavailableError(RuntimeError):
    """Raised when the live Medusa billing summary cannot be trusted."""


class BillingAccountConflictError(RuntimeError):
    """Raised when a billing account cannot be created because it already exists."""


class BillingAccountNotFoundError(RuntimeError):
    """Raised when a billing account does not exist."""


class BillingAccountValidationError(RuntimeError):
    """Raised when billing account creation input is invalid."""


@dataclass(frozen=True, slots=True)
class BillingMemberData:
    id: str
    name: str
    email: str
    role: BillingRole
    seat_type: SeatType
    date_added: str


@dataclass(frozen=True, slots=True)
class BillingCycleData:
    start: datetime
    end: datetime


@dataclass(frozen=True, slots=True)
class BillingAccountData:
    id: str
    domain: str
    plan_code: str
    plan_name: str
    subscription_status: SubscriptionStatus
    entitled: bool
    payment_status: PaymentStatus
    billing_cycle: BillingCycleData
    renewal_at: datetime | None
    chatgpt_seats_in_use: int
    codex_seats_in_use: int
    members: list[BillingMemberData]


@dataclass(frozen=True, slots=True)
class BillingAccountsData:
    accounts: list[BillingAccountData]


@dataclass(frozen=True, slots=True)
class BillingAccountCreateData:
    domain: str
    plan_code: str
    plan_name: str
    subscription_status: SubscriptionStatus
    payment_status: PaymentStatus
    entitled: bool
    renewal_at: datetime | None
    chatgpt_seats_in_use: int
    codex_seats_in_use: int


class BillingSummaryProvider(Protocol):
    async def fetch_accounts(self) -> list[BillingAccountData]: ...
    async def update_accounts(self, accounts: list[BillingAccountData]) -> list[BillingAccountData]: ...
    async def add_account(self, account: BillingAccountCreateData) -> BillingAccountData: ...
    async def delete_account(self, account_id: str) -> None: ...


class BillingService:
    def __init__(
        self,
        repository: BillingRepository,
        summary_provider: BillingSummaryProvider,
    ) -> None:
        self._repository = repository
        self._summary_provider = summary_provider

    async def get_accounts(self) -> BillingAccountsData:
        try:
            accounts = await self._summary_provider.fetch_accounts()
        except BillingSummaryUnavailableError as exc:
            set_degraded(str(exc))
            raise

        accounts = await self._auto_seed_runtime_domains(accounts)
        set_normal()
        return BillingAccountsData(accounts=accounts)

    async def update_accounts(self, accounts: list[BillingAccountData]) -> BillingAccountsData:
        updated_accounts = await self._summary_provider.update_accounts(accounts)
        set_normal()
        return BillingAccountsData(accounts=updated_accounts)

    async def add_account(self, account: BillingAccountCreateData) -> BillingAccountData:
        created_account = await self._summary_provider.add_account(account)
        set_normal()
        return created_account

    async def delete_account(self, account_id: str) -> None:
        await self._summary_provider.delete_account(account_id)
        set_normal()

    async def _auto_seed_runtime_domains(
        self,
        accounts: list[BillingAccountData],
    ) -> list[BillingAccountData]:
        runtime_domains = await self._repository.list_runtime_domains()
        existing_domains = {account.domain.strip().lower() for account in accounts}
        attempted_create = False

        for record in runtime_domains:
            domain = record.domain.strip().lower()
            if not domain:
                continue
            if domain.endswith(_EXCLUDED_AUTO_DOMAIN_SUFFIXES):
                continue
            if domain in existing_domains:
                continue

            attempted_create = True
            try:
                created_account = await self._summary_provider.add_account(
                    BillingAccountCreateData(
                        domain=domain,
                        plan_code="business",
                        plan_name="Business",
                        subscription_status="active",
                        payment_status="paid",
                        entitled=True,
                        renewal_at=record.first_detected_at + timedelta(days=_AUTO_RENEWAL_OFFSET_DAYS),
                        chatgpt_seats_in_use=_AUTO_CHATGPT_SEATS,
                        codex_seats_in_use=_AUTO_CODEX_SEATS,
                    )
                )
            except (
                BillingAccountConflictError,
                BillingAccountValidationError,
                BillingSummaryUnavailableError,
            ):
                continue

            existing_domains.add(domain)
            accounts.append(created_account)

        if attempted_create:
            try:
                return await self._summary_provider.fetch_accounts()
            except BillingSummaryUnavailableError:
                return accounts
        return accounts
