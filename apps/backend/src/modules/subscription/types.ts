export enum SubscriptionStatus {
  TRIALING = "trialing",
  ACTIVE = "active",
  PAST_DUE = "past_due",
  CANCELED = "canceled",
  EXPIRED = "expired",
}

export enum PaymentStatus {
  PAID = "paid",
  REQUIRES_ACTION = "requires_action",
  PAST_DUE = "past_due",
  UNPAID = "unpaid",
}

export enum SeatType {
  CHATGPT = "ChatGPT",
  CODEX = "Codex",
}

export type SubscriptionBillingMember = {
  id: string
  name: string
  email: string
  role: "Owner" | "Member"
  seat_type: SeatType
  date_added: string
}

export type SubscriptionBillingCycle = {
  start: string
  end: string
}

export type SubscriptionBillingAccount = {
  id: string
  domain: string
  plan_code: string
  plan_name: string
  subscription_status: SubscriptionStatus
  entitled: boolean
  payment_status: PaymentStatus
  billing_cycle: SubscriptionBillingCycle
  renewal_at: string | null
  chatgpt_seats_in_use: number
  codex_seats_in_use: number
  members: SubscriptionBillingMember[]
}

export type SubscriptionBillingSummary = {
  accounts: SubscriptionBillingAccount[]
}

export type SubscriptionBillingAccountCreateInput = {
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
