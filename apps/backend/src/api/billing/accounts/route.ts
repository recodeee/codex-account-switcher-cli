import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import SubscriptionModuleService, {
  SubscriptionAccountConflictError,
  SubscriptionAccountValidationError,
} from "../../../modules/subscription/service"
import { PaymentStatus, SubscriptionStatus } from "../../../modules/subscription/types"

type CreateBillingAccountPayload = {
  domain: string
  plan_code?: string
  plan_name?: string
  subscription_status?: SubscriptionStatus
  payment_status?: PaymentStatus
  entitled?: boolean
  renewal_at?: string | null
  chatgpt_seats_in_use?: number
  codex_seats_in_use?: number
}

const SUBSCRIPTION_STATUSES = new Set(Object.values(SubscriptionStatus))
const PAYMENT_STATUSES = new Set(Object.values(PaymentStatus))

function parseCreateBillingAccountPayload(raw: unknown): CreateBillingAccountPayload | null {
  if (!raw || typeof raw !== "object") {
    return null
  }

  const payload = raw as Record<string, unknown>
  if (typeof payload.domain !== "string" || payload.domain.trim().length === 0) {
    return null
  }

  const parsed: CreateBillingAccountPayload = {
    domain: payload.domain,
  }

  if (payload.plan_code !== undefined) {
    if (typeof payload.plan_code !== "string" || payload.plan_code.trim().length === 0) {
      return null
    }
    parsed.plan_code = payload.plan_code
  }

  if (payload.plan_name !== undefined) {
    if (typeof payload.plan_name !== "string" || payload.plan_name.trim().length === 0) {
      return null
    }
    parsed.plan_name = payload.plan_name
  }

  if (payload.subscription_status !== undefined) {
    if (typeof payload.subscription_status !== "string" || !SUBSCRIPTION_STATUSES.has(payload.subscription_status as SubscriptionStatus)) {
      return null
    }
    parsed.subscription_status = payload.subscription_status as SubscriptionStatus
  }

  if (payload.payment_status !== undefined) {
    if (typeof payload.payment_status !== "string" || !PAYMENT_STATUSES.has(payload.payment_status as PaymentStatus)) {
      return null
    }
    parsed.payment_status = payload.payment_status as PaymentStatus
  }

  if (payload.entitled !== undefined) {
    if (typeof payload.entitled !== "boolean") {
      return null
    }
    parsed.entitled = payload.entitled
  }

  if (payload.renewal_at !== undefined) {
    if (payload.renewal_at !== null && typeof payload.renewal_at !== "string") {
      return null
    }
    parsed.renewal_at = payload.renewal_at
  }

  if (payload.chatgpt_seats_in_use !== undefined) {
    if (
      typeof payload.chatgpt_seats_in_use !== "number" ||
      !Number.isInteger(payload.chatgpt_seats_in_use) ||
      payload.chatgpt_seats_in_use < 0
    ) {
      return null
    }
    parsed.chatgpt_seats_in_use = payload.chatgpt_seats_in_use
  }

  if (payload.codex_seats_in_use !== undefined) {
    if (
      typeof payload.codex_seats_in_use !== "number" ||
      !Number.isInteger(payload.codex_seats_in_use) ||
      payload.codex_seats_in_use < 0
    ) {
      return null
    }
    parsed.codex_seats_in_use = payload.codex_seats_in_use
  }

  return parsed
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const payload = parseCreateBillingAccountPayload(req.body)
  if (!payload) {
    return res.status(400).json({
      error: {
        code: "invalid_billing_account_payload",
        message: "Invalid billing account payload",
      },
    })
  }

  const subscriptionModuleService: SubscriptionModuleService = req.scope.resolve(SUBSCRIPTION_MODULE)

  try {
    const account = await subscriptionModuleService.addBillingAccount(payload)
    return res.status(201).json(account)
  } catch (error) {
    if (error instanceof SubscriptionAccountConflictError) {
      return res.status(409).json({
        error: {
          code: "billing_account_exists",
          message: error.message,
        },
      })
    }

    if (error instanceof SubscriptionAccountValidationError) {
      return res.status(400).json({
        error: {
          code: "invalid_billing_account_payload",
          message: error.message,
        },
      })
    }

    throw error
  }
}
