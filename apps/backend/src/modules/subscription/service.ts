import { MedusaService } from "@medusajs/framework/utils"

import { subscriptionBillingFixture } from "./fixtures/summary"
import SubscriptionAccount from "./models/subscription-account"
import SubscriptionSeat from "./models/subscription-seat"
import {
  PaymentStatus,
  SubscriptionStatus,
  type SubscriptionBillingAccount,
  type SubscriptionBillingAccountCreateInput,
  type SubscriptionBillingSummary,
} from "./types"

const DEFAULT_PLAN_CODE = "business"
const DEFAULT_PLAN_NAME = "Business"
const BILLING_CYCLE_DAYS = 30

function cloneAccount(account: SubscriptionBillingAccount): SubscriptionBillingAccount {
  return {
    ...account,
    billing_cycle: { ...account.billing_cycle },
    members: account.members.map((member) => ({ ...member })),
  }
}

const billingAccountsStore: SubscriptionBillingAccount[] = subscriptionBillingFixture.accounts.map((account) =>
  cloneAccount(account)
)

function sanitizeDomain(value: string): string {
  return value.trim().toLowerCase()
}

function buildAccountId(domain: string): string {
  const token = domain
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")

  return `business-plan-${token || "account"}`
}

function withSuffix(value: string, suffix: number): string {
  return `${value}-${suffix}`
}

export class SubscriptionAccountValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SubscriptionAccountValidationError"
  }
}

export class SubscriptionAccountConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SubscriptionAccountConflictError"
  }
}

class SubscriptionModuleService extends MedusaService({
  SubscriptionAccount,
  SubscriptionSeat,
}) {
  async getBillingSummary(): Promise<SubscriptionBillingSummary> {
    return {
      accounts: billingAccountsStore.map((account) => cloneAccount(account)),
    }
  }

  async addBillingAccount(input: SubscriptionBillingAccountCreateInput): Promise<SubscriptionBillingAccount> {
    const domain = sanitizeDomain(input.domain ?? "")
    if (!domain) {
      throw new SubscriptionAccountValidationError("Domain is required")
    }

    const duplicate = billingAccountsStore.find(
      (account) => account.domain.toLowerCase() === domain
    )
    if (duplicate) {
      throw new SubscriptionAccountConflictError(`Subscription account already exists for ${domain}`)
    }

    const now = new Date()
    const cycleEnd = new Date(now.getTime() + BILLING_CYCLE_DAYS * 24 * 60 * 60 * 1000)

    const normalizedStatus = input.subscription_status ?? SubscriptionStatus.ACTIVE
    const entitled =
      normalizedStatus === SubscriptionStatus.CANCELED || normalizedStatus === SubscriptionStatus.EXPIRED
        ? false
        : (input.entitled ?? true)

    const baseId = buildAccountId(domain)
    const existingIds = new Set(billingAccountsStore.map((account) => account.id))
    let accountId = baseId
    let suffix = 2
    while (existingIds.has(accountId)) {
      accountId = withSuffix(baseId, suffix)
      suffix += 1
    }

    const account: SubscriptionBillingAccount = {
      id: accountId,
      domain,
      plan_code: input.plan_code?.trim() || DEFAULT_PLAN_CODE,
      plan_name: input.plan_name?.trim() || DEFAULT_PLAN_NAME,
      subscription_status: normalizedStatus,
      entitled,
      payment_status: input.payment_status ?? PaymentStatus.PAID,
      billing_cycle: {
        start: now.toISOString(),
        end: cycleEnd.toISOString(),
      },
      renewal_at: input.renewal_at ?? cycleEnd.toISOString(),
      chatgpt_seats_in_use: Math.max(0, Math.floor(input.chatgpt_seats_in_use ?? 0)),
      codex_seats_in_use: Math.max(0, Math.floor(input.codex_seats_in_use ?? 0)),
      members: [],
    }

    billingAccountsStore.push(account)

    return cloneAccount(account)
  }
}

export default SubscriptionModuleService
