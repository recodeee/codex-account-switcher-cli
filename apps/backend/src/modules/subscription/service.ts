import { MedusaService } from "@medusajs/framework/utils"

import { subscriptionBillingFixture } from "./fixtures/summary"
import SubscriptionAccount from "./models/subscription-account"
import SubscriptionSeat from "./models/subscription-seat"
import {
  PaymentStatus,
  type SeatType,
  SubscriptionStatus,
  type SubscriptionBillingAccount,
  type SubscriptionBillingAccountCreateInput,
  type SubscriptionBillingAccountUpdateInput,
  type SubscriptionBillingMember,
  type SubscriptionBillingSummary,
} from "./types"

const DEFAULT_PLAN_CODE = "business"
const DEFAULT_PLAN_NAME = "Business"
const BILLING_CYCLE_DAYS = 30

type PersistedSubscriptionSeat = {
  id: string
  member_name: string
  member_email: string
  role: SubscriptionBillingMember["role"]
  seat_type: SeatType
  date_added: Date | string
}

type PersistedSubscriptionAccount = {
  id: string
  domain: string
  plan_code: string
  plan_name: string
  subscription_status: SubscriptionStatus
  entitled: boolean
  payment_status: PaymentStatus
  billing_cycle_start: Date | string
  billing_cycle_end: Date | string
  renewal_at: Date | string | null
  chatgpt_seats_in_use: number
  codex_seats_in_use: number
  seats?: PersistedSubscriptionSeat[]
}

type SubscriptionPersistenceCrud = {
  listSubscriptionAccounts(
    filters?: Record<string, unknown>,
    config?: {
      relations?: string[]
      order?: Record<string, "ASC" | "DESC" | string>
    }
  ): Promise<PersistedSubscriptionAccount[]>
  createSubscriptionAccounts(data: Record<string, unknown>[] | Record<string, unknown>): Promise<PersistedSubscriptionAccount[] | PersistedSubscriptionAccount>
  createSubscriptionSeats(data: Record<string, unknown>[] | Record<string, unknown>): Promise<PersistedSubscriptionSeat[] | PersistedSubscriptionSeat>
  updateSubscriptionAccounts(data: Record<string, unknown>[] | Record<string, unknown>): Promise<PersistedSubscriptionAccount[] | PersistedSubscriptionAccount>
  deleteSubscriptionAccounts(ids: string[] | string): Promise<string[]>
  deleteSubscriptionSeats(ids: string[] | string): Promise<string[]>
}

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

function parseIsoDate(value: string, label: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new SubscriptionAccountValidationError(`${label} must be a valid date`)
  }
  return parsed.toISOString()
}

function toDate(value: Date | string, label: string): Date {
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new SubscriptionAccountValidationError(`${label} must be a valid date`)
  }

  return parsed
}

function normalizeMember(member: SubscriptionBillingMember): SubscriptionBillingMember {
  if (!member.id?.trim()) {
    throw new SubscriptionAccountValidationError("Member id is required")
  }
  if (!member.name?.trim()) {
    throw new SubscriptionAccountValidationError("Member name is required")
  }
  if (!member.email?.trim()) {
    throw new SubscriptionAccountValidationError("Member email is required")
  }

  return {
    ...member,
    id: member.id.trim(),
    name: member.name.trim(),
    email: member.email.trim().toLowerCase(),
    date_added: parseIsoDate(member.date_added, "Member added date"),
  }
}

function normalizeUpdatedAccount(input: SubscriptionBillingAccountUpdateInput): SubscriptionBillingAccount {
  if (!input.id?.trim()) {
    throw new SubscriptionAccountValidationError("Billing account id is required")
  }

  const domain = sanitizeDomain(input.domain ?? "")
  if (!domain) {
    throw new SubscriptionAccountValidationError("Domain is required")
  }

  const planCode = input.plan_code?.trim() || DEFAULT_PLAN_CODE
  const planName = input.plan_name?.trim() || DEFAULT_PLAN_NAME
  if (!planCode) {
    throw new SubscriptionAccountValidationError("Plan code is required")
  }
  if (!planName) {
    throw new SubscriptionAccountValidationError("Plan name is required")
  }

  const normalizedStatus = input.subscription_status
  const entitled =
    normalizedStatus === SubscriptionStatus.CANCELED || normalizedStatus === SubscriptionStatus.EXPIRED
      ? false
      : input.entitled

  const memberIds = new Set<string>()
  const members = input.members.map((member) => {
    const normalizedMember = normalizeMember(member)
    if (memberIds.has(normalizedMember.id)) {
      throw new SubscriptionAccountValidationError(`Duplicate member id ${normalizedMember.id}`)
    }
    memberIds.add(normalizedMember.id)
    return normalizedMember
  })

  return {
    id: input.id.trim(),
    domain,
    plan_code: planCode,
    plan_name: planName,
    subscription_status: normalizedStatus,
    entitled,
    payment_status: input.payment_status,
    billing_cycle: {
      start: parseIsoDate(input.billing_cycle.start, "Billing cycle start"),
      end: parseIsoDate(input.billing_cycle.end, "Billing cycle end"),
    },
    renewal_at: input.renewal_at ? parseIsoDate(input.renewal_at, "Renewal date") : null,
    chatgpt_seats_in_use: Math.max(0, Math.floor(input.chatgpt_seats_in_use)),
    codex_seats_in_use: Math.max(0, Math.floor(input.codex_seats_in_use)),
    members,
  }
}

function sortMembers(a: PersistedSubscriptionSeat, b: PersistedSubscriptionSeat): number {
  const byDate = toDate(a.date_added, "Member added date").getTime() - toDate(b.date_added, "Member added date").getTime()
  if (byDate !== 0) {
    return byDate
  }

  return a.member_name.localeCompare(b.member_name)
}

function toBillingMember(member: PersistedSubscriptionSeat): SubscriptionBillingMember {
  return {
    id: member.id,
    name: member.member_name,
    email: member.member_email,
    role: member.role,
    seat_type: member.seat_type,
    date_added: toDate(member.date_added, "Member added date").toISOString(),
  }
}

function toBillingAccount(account: PersistedSubscriptionAccount): SubscriptionBillingAccount {
  const members = [...(account.seats ?? [])].sort(sortMembers).map(toBillingMember)

  return {
    id: account.id,
    domain: account.domain,
    plan_code: account.plan_code,
    plan_name: account.plan_name,
    subscription_status: account.subscription_status,
    entitled: account.entitled,
    payment_status: account.payment_status,
    billing_cycle: {
      start: toDate(account.billing_cycle_start, "Billing cycle start").toISOString(),
      end: toDate(account.billing_cycle_end, "Billing cycle end").toISOString(),
    },
    renewal_at: account.renewal_at ? toDate(account.renewal_at, "Renewal date").toISOString() : null,
    chatgpt_seats_in_use: account.chatgpt_seats_in_use,
    codex_seats_in_use: account.codex_seats_in_use,
    members,
  }
}

function toPersistedAccountPayload(account: SubscriptionBillingAccount) {
  return {
    id: account.id,
    domain: account.domain,
    plan_code: account.plan_code,
    plan_name: account.plan_name,
    subscription_status: account.subscription_status,
    entitled: account.entitled,
    payment_status: account.payment_status,
    billing_cycle_start: toDate(account.billing_cycle.start, "Billing cycle start"),
    billing_cycle_end: toDate(account.billing_cycle.end, "Billing cycle end"),
    renewal_at: account.renewal_at ? toDate(account.renewal_at, "Renewal date") : null,
    chatgpt_seats_in_use: account.chatgpt_seats_in_use,
    codex_seats_in_use: account.codex_seats_in_use,
  }
}

function toPersistedSeatPayload(accountId: string, member: SubscriptionBillingMember) {
  return {
    id: member.id,
    member_name: member.name,
    member_email: member.email,
    role: member.role,
    seat_type: member.seat_type,
    date_added: toDate(member.date_added, "Member added date"),
    account_id: accountId,
  }
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

export class SubscriptionAccountNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SubscriptionAccountNotFoundError"
  }
}

class SubscriptionModuleService extends MedusaService({
  SubscriptionAccount,
  SubscriptionSeat,
}) {
  private get persistence(): SubscriptionPersistenceCrud {
    return this as unknown as SubscriptionPersistenceCrud
  }

  private async listStoredAccounts(): Promise<PersistedSubscriptionAccount[]> {
    return await this.persistence.listSubscriptionAccounts(
      {},
      {
        relations: ["seats"],
        order: {
          created_at: "ASC",
        },
      }
    )
  }

  private async ensureSeededAccounts(): Promise<PersistedSubscriptionAccount[]> {
    const accounts = await this.listStoredAccounts()
    if (accounts.length > 0) {
      return accounts
    }

    await this.persistence.createSubscriptionAccounts(
      subscriptionBillingFixture.accounts.map((account) => toPersistedAccountPayload(account))
    )

    const seatPayloads = subscriptionBillingFixture.accounts.flatMap((account) =>
      account.members.map((member) => toPersistedSeatPayload(account.id, member))
    )

    if (seatPayloads.length > 0) {
      await this.persistence.createSubscriptionSeats(seatPayloads)
    }

    return await this.listStoredAccounts()
  }

  async getBillingSummary(): Promise<SubscriptionBillingSummary> {
    const accounts = await this.ensureSeededAccounts()

    return {
      accounts: accounts.map((account) => toBillingAccount(account)),
    }
  }

  async addBillingAccount(input: SubscriptionBillingAccountCreateInput): Promise<SubscriptionBillingAccount> {
    const existingAccounts = await this.ensureSeededAccounts()

    const domain = sanitizeDomain(input.domain ?? "")
    if (!domain) {
      throw new SubscriptionAccountValidationError("Domain is required")
    }

    const duplicate = existingAccounts.find((account) => account.domain.toLowerCase() === domain)
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
    const existingIds = new Set(existingAccounts.map((account) => account.id))
    let accountId = baseId
    let suffix = 2
    while (existingIds.has(accountId)) {
      accountId = withSuffix(baseId, suffix)
      suffix += 1
    }

    const createdAccount = (await this.persistence.createSubscriptionAccounts({
      id: accountId,
      domain,
      plan_code: input.plan_code?.trim() || DEFAULT_PLAN_CODE,
      plan_name: input.plan_name?.trim() || DEFAULT_PLAN_NAME,
      subscription_status: normalizedStatus,
      entitled,
      payment_status: input.payment_status ?? PaymentStatus.PAID,
      billing_cycle_start: now,
      billing_cycle_end: cycleEnd,
      renewal_at: input.renewal_at ? toDate(input.renewal_at, "Renewal date") : cycleEnd,
      chatgpt_seats_in_use: Math.max(0, Math.floor(input.chatgpt_seats_in_use ?? 0)),
      codex_seats_in_use: Math.max(0, Math.floor(input.codex_seats_in_use ?? 0)),
    })) as PersistedSubscriptionAccount

    return toBillingAccount({
      ...createdAccount,
      seats: createdAccount.seats ?? [],
    })
  }

  async deleteBillingAccount(accountId: string): Promise<void> {
    const normalizedAccountId = accountId.trim()
    if (!normalizedAccountId) {
      throw new SubscriptionAccountValidationError("Billing account id is required")
    }

    const currentAccounts = await this.ensureSeededAccounts()
    const existingAccount = currentAccounts.find((account) => account.id === normalizedAccountId)
    if (!existingAccount) {
      throw new SubscriptionAccountNotFoundError(`Billing account not found: ${normalizedAccountId}`)
    }

    const existingSeatIds = (existingAccount.seats ?? []).map((seat) => seat.id)
    if (existingSeatIds.length > 0) {
      await this.persistence.deleteSubscriptionSeats(existingSeatIds)
    }
    await this.persistence.deleteSubscriptionAccounts(normalizedAccountId)
  }

  async updateBillingAccounts(
    accounts: SubscriptionBillingAccountUpdateInput[]
  ): Promise<SubscriptionBillingSummary> {
    const currentAccounts = await this.ensureSeededAccounts()
    const currentIds = new Set(currentAccounts.map((account) => account.id))

    if (accounts.length !== currentAccounts.length) {
      throw new SubscriptionAccountValidationError(
        "Billing account updates must preserve the existing account set"
      )
    }

    const seenIds = new Set<string>()
    const normalizedAccounts = accounts.map((account) => {
      const normalizedAccount = normalizeUpdatedAccount(account)
      if (!currentIds.has(normalizedAccount.id)) {
        throw new SubscriptionAccountValidationError(`Unknown billing account ${normalizedAccount.id}`)
      }
      if (seenIds.has(normalizedAccount.id)) {
        throw new SubscriptionAccountValidationError(`Duplicate billing account ${normalizedAccount.id}`)
      }
      seenIds.add(normalizedAccount.id)
      return normalizedAccount
    })

    const seenDomains = new Set<string>()
    for (const account of normalizedAccounts) {
      if (seenDomains.has(account.domain)) {
        throw new SubscriptionAccountValidationError(
          `Subscription account already exists for ${account.domain}`
        )
      }
      seenDomains.add(account.domain)
    }

    await this.persistence.updateSubscriptionAccounts(
      normalizedAccounts.map((account) => toPersistedAccountPayload(account))
    )

    const existingSeatIds = currentAccounts.flatMap((account) =>
      (account.seats ?? []).map((seat) => seat.id)
    )
    if (existingSeatIds.length > 0) {
      await this.persistence.deleteSubscriptionSeats(existingSeatIds)
    }

    const nextSeatPayloads = normalizedAccounts.flatMap((account) =>
      account.members.map((member) => toPersistedSeatPayload(account.id, member))
    )
    if (nextSeatPayloads.length > 0) {
      await this.persistence.createSubscriptionSeats(nextSeatPayloads)
    }

    const updatedAccounts = await this.listStoredAccounts()

    return {
      accounts: updatedAccounts.map((account) => toBillingAccount(account)),
    }
  }
}

export default SubscriptionModuleService
