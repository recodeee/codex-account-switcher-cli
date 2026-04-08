import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { SUBSCRIPTION_MODULE } from "../../modules/subscription"
import SubscriptionModuleService, { SubscriptionAccountValidationError } from "../../modules/subscription/service"
import {
  PaymentStatus,
  SeatType,
  SubscriptionStatus,
  type SubscriptionBillingAccountUpdateInput,
  type SubscriptionBillingMember,
} from "../../modules/subscription/types"

type UpdateBillingAccountsPayload = {
  accounts: SubscriptionBillingAccountUpdateInput[]
}

const SUBSCRIPTION_STATUSES = new Set(Object.values(SubscriptionStatus))
const PAYMENT_STATUSES = new Set(Object.values(PaymentStatus))
const SEAT_TYPES = new Set(Object.values(SeatType))
const MEMBER_ROLES = new Set(["Owner", "Member"])

function parseMember(raw: unknown): SubscriptionBillingMember | null {
  if (!raw || typeof raw !== "object") {
    return null
  }

  const member = raw as Record<string, unknown>
  if (
    typeof member.id !== "string" ||
    typeof member.name !== "string" ||
    typeof member.email !== "string" ||
    typeof member.role !== "string" ||
    typeof member.seat_type !== "string" ||
    typeof member.date_added !== "string"
  ) {
    return null
  }

  if (!MEMBER_ROLES.has(member.role)) {
    return null
  }

  if (!SEAT_TYPES.has(member.seat_type as SeatType)) {
    return null
  }

  return {
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role as SubscriptionBillingMember["role"],
    seat_type: member.seat_type as SeatType,
    date_added: member.date_added,
  }
}

function parseAccount(raw: unknown): SubscriptionBillingAccountUpdateInput | null {
  if (!raw || typeof raw !== "object") {
    return null
  }

  const account = raw as Record<string, unknown>
  if (
    typeof account.id !== "string" ||
    typeof account.domain !== "string" ||
    typeof account.plan_code !== "string" ||
    typeof account.plan_name !== "string" ||
    typeof account.subscription_status !== "string" ||
    typeof account.payment_status !== "string" ||
    typeof account.entitled !== "boolean" ||
    typeof account.chatgpt_seats_in_use !== "number" ||
    typeof account.codex_seats_in_use !== "number" ||
    !account.billing_cycle ||
    typeof account.billing_cycle !== "object" ||
    !Array.isArray(account.members)
  ) {
    return null
  }

  if (!SUBSCRIPTION_STATUSES.has(account.subscription_status as SubscriptionStatus)) {
    return null
  }

  if (!PAYMENT_STATUSES.has(account.payment_status as PaymentStatus)) {
    return null
  }

  if (
    !Number.isInteger(account.chatgpt_seats_in_use) ||
    account.chatgpt_seats_in_use < 0 ||
    !Number.isInteger(account.codex_seats_in_use) ||
    account.codex_seats_in_use < 0
  ) {
    return null
  }

  const billingCycle = account.billing_cycle as Record<string, unknown>
  if (typeof billingCycle.start !== "string" || typeof billingCycle.end !== "string") {
    return null
  }

  if (account.renewal_at !== null && typeof account.renewal_at !== "string") {
    return null
  }

  const members = account.members.map(parseMember)
  if (members.some((member) => member === null)) {
    return null
  }

  return {
    id: account.id,
    domain: account.domain,
    plan_code: account.plan_code,
    plan_name: account.plan_name,
    subscription_status: account.subscription_status as SubscriptionStatus,
    entitled: account.entitled,
    payment_status: account.payment_status as PaymentStatus,
    billing_cycle: {
      start: billingCycle.start,
      end: billingCycle.end,
    },
    renewal_at: account.renewal_at,
    chatgpt_seats_in_use: account.chatgpt_seats_in_use,
    codex_seats_in_use: account.codex_seats_in_use,
    members: members as SubscriptionBillingMember[],
  }
}

function parseUpdateBillingAccountsPayload(raw: unknown): UpdateBillingAccountsPayload | null {
  if (!raw || typeof raw !== "object") {
    return null
  }

  const payload = raw as Record<string, unknown>
  if (!Array.isArray(payload.accounts)) {
    return null
  }

  const accounts = payload.accounts.map(parseAccount)
  if (accounts.some((account) => account === null)) {
    return null
  }

  return {
    accounts: accounts as SubscriptionBillingAccountUpdateInput[],
  }
}

export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const payload = parseUpdateBillingAccountsPayload(req.body)
  if (!payload) {
    return res.status(400).json({
      error: {
        code: "invalid_billing_payload",
        message: "Invalid billing payload",
      },
    })
  }

  const subscriptionModuleService: SubscriptionModuleService = req.scope.resolve(SUBSCRIPTION_MODULE)

  try {
    const summary = await subscriptionModuleService.updateBillingAccounts(payload.accounts)
    return res.status(200).json(summary)
  } catch (error) {
    if (error instanceof SubscriptionAccountValidationError) {
      return res.status(400).json({
        error: {
          code: "invalid_billing_payload",
          message: error.message,
        },
      })
    }

    throw error
  }
}
