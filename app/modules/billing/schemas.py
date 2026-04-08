from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.modules.shared.schemas import DashboardModel


class BillingMember(DashboardModel):
    id: str
    name: str
    email: str
    role: Literal["Owner", "Member"]
    seat_type: Literal["ChatGPT", "Codex"]
    date_added: str


class BillingCycle(DashboardModel):
    start: datetime
    end: datetime


class BillingAccount(DashboardModel):
    id: str
    domain: str
    plan_code: str
    plan_name: str
    subscription_status: Literal["trialing", "active", "past_due", "canceled", "expired"]
    entitled: bool
    payment_status: Literal["paid", "requires_action", "past_due", "unpaid"]
    billing_cycle: BillingCycle
    renewal_at: datetime | None = None
    chatgpt_seats_in_use: int = Field(ge=0)
    codex_seats_in_use: int = Field(ge=0)
    members: list[BillingMember]


class BillingAccountsResponse(DashboardModel):
    accounts: list[BillingAccount]


class BillingAccountsUpdateRequest(DashboardModel):
    accounts: list[BillingAccount]


class BillingAccountCreateRequest(DashboardModel):
    domain: str = Field(min_length=1, max_length=255)
    plan_code: str = Field(default="business", min_length=1, max_length=64)
    plan_name: str = Field(default="Business", min_length=1, max_length=128)
    subscription_status: Literal["trialing", "active", "past_due", "canceled", "expired"] = "active"
    payment_status: Literal["paid", "requires_action", "past_due", "unpaid"] = "paid"
    entitled: bool = True
    renewal_at: datetime | None = None
    chatgpt_seats_in_use: int = Field(default=0, ge=0)
    codex_seats_in_use: int = Field(default=0, ge=0)
