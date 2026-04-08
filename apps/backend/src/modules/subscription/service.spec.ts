import SubscriptionModuleService, {
  SubscriptionAccountNotFoundError,
  SubscriptionAccountValidationError,
} from "./service"
import { subscriptionBillingFixture } from "./fixtures/summary"
import { PaymentStatus, SeatType, SubscriptionStatus, type SubscriptionBillingAccount } from "./types"

type PersistedSeat = {
  id: string
  member_name: string
  member_email: string
  role: "Owner" | "Member"
  seat_type: SeatType
  date_added: Date
}

type PersistedAccount = {
  id: string
  domain: string
  plan_code: string
  plan_name: string
  subscription_status: SubscriptionStatus
  entitled: boolean
  payment_status: PaymentStatus
  billing_cycle_start: Date
  billing_cycle_end: Date
  renewal_at: Date | null
  chatgpt_seats_in_use: number
  codex_seats_in_use: number
  seats: PersistedSeat[]
}

function toPersistedAccount(account: SubscriptionBillingAccount): PersistedAccount {
  return {
    id: account.id,
    domain: account.domain,
    plan_code: account.plan_code,
    plan_name: account.plan_name,
    subscription_status: account.subscription_status,
    entitled: account.entitled,
    payment_status: account.payment_status,
    billing_cycle_start: new Date(account.billing_cycle.start),
    billing_cycle_end: new Date(account.billing_cycle.end),
    renewal_at: account.renewal_at ? new Date(account.renewal_at) : null,
    chatgpt_seats_in_use: account.chatgpt_seats_in_use,
    codex_seats_in_use: account.codex_seats_in_use,
    seats: account.members.map((member) => ({
      id: member.id,
      member_name: member.name,
      member_email: member.email,
      role: member.role,
      seat_type: member.seat_type,
      date_added: new Date(member.date_added),
    })),
  }
}

function buildPersistedSummary(): PersistedAccount[] {
  return subscriptionBillingFixture.accounts.map(toPersistedAccount)
}

function instantiateService(): SubscriptionModuleService {
  const ServiceConstructor = SubscriptionModuleService as unknown as {
    new (container: Record<string, unknown>): SubscriptionModuleService
  }

  return new ServiceConstructor({})
}

describe("SubscriptionModuleService persistence", () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it("seeds fixture accounts into module storage when the billing store is empty", async () => {
    const service = instantiateService()
    const seededAccounts = buildPersistedSummary()

    const listSubscriptionAccounts = jest
      .spyOn(service as any, "listSubscriptionAccounts")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(seededAccounts)
    const createSubscriptionAccounts = jest
      .spyOn(service as any, "createSubscriptionAccounts")
      .mockResolvedValue(seededAccounts)
    const createSubscriptionSeats = jest
      .spyOn(service as any, "createSubscriptionSeats")
      .mockResolvedValue(
        seededAccounts.flatMap((account) => account.seats) as any
      )

    const summary = await service.getBillingSummary()

    expect(listSubscriptionAccounts).toHaveBeenCalledTimes(2)
    expect(createSubscriptionAccounts).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "business-plan-edixai",
          domain: "edixai.com",
          plan_code: "business",
          plan_name: "Business",
        }),
      ])
    )
    expect(createSubscriptionSeats).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          account_id: "business-plan-edixai",
          member_name: "Edix.ai (You)",
          member_email: "admin@edixai.com",
          seat_type: SeatType.CHATGPT,
        }),
      ])
    )
    expect(summary.accounts).toHaveLength(subscriptionBillingFixture.accounts.length)
    expect(summary.accounts[0]).toEqual(
      expect.objectContaining({
        id: "business-plan-edixai",
        domain: "edixai.com",
      })
    )
  })

  it("creates a new billing account through persisted subscription records", async () => {
    const service = instantiateService()
    const existingAccounts = buildPersistedSummary()
    const createdAccount = {
      id: "business-plan-example-com",
      domain: "example.com",
      plan_code: "business",
      plan_name: "Business",
      subscription_status: SubscriptionStatus.ACTIVE,
      entitled: true,
      payment_status: PaymentStatus.PAID,
      billing_cycle_start: new Date("2026-04-08T00:00:00.000Z"),
      billing_cycle_end: new Date("2026-05-08T00:00:00.000Z"),
      renewal_at: new Date("2026-05-08T00:00:00.000Z"),
      chatgpt_seats_in_use: 2,
      codex_seats_in_use: 1,
      seats: [],
    } satisfies PersistedAccount

    jest.spyOn(service as any, "listSubscriptionAccounts").mockResolvedValue(existingAccounts)
    const createSubscriptionAccounts = jest
      .spyOn(service as any, "createSubscriptionAccounts")
      .mockResolvedValue(createdAccount as any)

    const account = await service.addBillingAccount({
      domain: "example.com",
      plan_code: "business",
      plan_name: "Business",
      chatgpt_seats_in_use: 2,
      codex_seats_in_use: 1,
    })

    expect(createSubscriptionAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "business-plan-example-com",
        domain: "example.com",
        plan_code: "business",
        plan_name: "Business",
        chatgpt_seats_in_use: 2,
        codex_seats_in_use: 1,
      })
    )
    expect(account).toEqual(
      expect.objectContaining({
        id: "business-plan-example-com",
        domain: "example.com",
        chatgpt_seats_in_use: 2,
        codex_seats_in_use: 1,
      })
    )
  })

  it("updates existing billing accounts by replacing persisted seat rows", async () => {
    const service = instantiateService()
    const baselineAccounts = buildPersistedSummary()
    const target = baselineAccounts[0]
    const updatedPersistedAccounts = baselineAccounts.map((account) =>
      account.id === target.id
        ? {
            ...account,
            plan_name: "Business Plus",
            chatgpt_seats_in_use: account.chatgpt_seats_in_use + 2,
            codex_seats_in_use: account.codex_seats_in_use + 1,
          }
        : account
    )

    const listSubscriptionAccounts = jest
      .spyOn(service as any, "listSubscriptionAccounts")
      .mockResolvedValueOnce(baselineAccounts)
      .mockResolvedValueOnce(updatedPersistedAccounts)
    const updateSubscriptionAccounts = jest
      .spyOn(service as any, "updateSubscriptionAccounts")
      .mockResolvedValue(updatedPersistedAccounts as any)
    const deleteSubscriptionSeats = jest
      .spyOn(service as any, "deleteSubscriptionSeats")
      .mockResolvedValue(
        baselineAccounts.flatMap((account) => account.seats.map((seat) => seat.id))
      )
    const createSubscriptionSeats = jest
      .spyOn(service as any, "createSubscriptionSeats")
      .mockResolvedValue(
        updatedPersistedAccounts.flatMap((account) => account.seats) as any
      )

    const result = await service.updateBillingAccounts(
      subscriptionBillingFixture.accounts.map((account) =>
        account.id === target.id
          ? {
              ...account,
              plan_name: "Business Plus",
              chatgpt_seats_in_use: account.chatgpt_seats_in_use + 2,
              codex_seats_in_use: account.codex_seats_in_use + 1,
            }
          : account
      )
    )

    expect(listSubscriptionAccounts).toHaveBeenCalledTimes(2)
    expect(updateSubscriptionAccounts).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: target.id,
          plan_name: "Business Plus",
          chatgpt_seats_in_use: target.chatgpt_seats_in_use + 2,
          codex_seats_in_use: target.codex_seats_in_use + 1,
        }),
      ])
    )
    expect(deleteSubscriptionSeats).toHaveBeenCalledWith(
      expect.arrayContaining(
        baselineAccounts.flatMap((account) => account.seats.map((seat) => seat.id))
      )
    )
    expect(createSubscriptionSeats).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          account_id: target.id,
          member_name: target.seats[0].member_name,
          member_email: target.seats[0].member_email,
        }),
      ])
    )
    expect(result.accounts).toHaveLength(subscriptionBillingFixture.accounts.length)
    expect(result.accounts.find((account) => account.id === target.id)).toEqual(
      expect.objectContaining({
        plan_name: "Business Plus",
        chatgpt_seats_in_use: target.chatgpt_seats_in_use + 2,
        codex_seats_in_use: target.codex_seats_in_use + 1,
      })
    )
  })

  it("rejects updates that change the account set", async () => {
    const service = instantiateService()

    jest.spyOn(service as any, "listSubscriptionAccounts").mockResolvedValue(buildPersistedSummary())
    const updateSubscriptionAccounts = jest.spyOn(service as any, "updateSubscriptionAccounts")

    await expect(service.updateBillingAccounts(subscriptionBillingFixture.accounts.slice(0, 1))).rejects.toThrow(
      new SubscriptionAccountValidationError("Billing account updates must preserve the existing account set")
    )

    expect(updateSubscriptionAccounts).not.toHaveBeenCalled()
  })

  it("deletes an existing billing account and its persisted seat rows", async () => {
    const service = instantiateService()
    const baselineAccounts = buildPersistedSummary()
    const target = baselineAccounts[0]

    jest.spyOn(service as any, "listSubscriptionAccounts").mockResolvedValue(baselineAccounts)
    const deleteSubscriptionSeats = jest
      .spyOn(service as any, "deleteSubscriptionSeats")
      .mockResolvedValue(target.seats.map((seat) => seat.id))
    const deleteSubscriptionAccounts = jest
      .spyOn(service as any, "deleteSubscriptionAccounts")
      .mockResolvedValue([target.id])

    await service.deleteBillingAccount(target.id)

    expect(deleteSubscriptionSeats).toHaveBeenCalledWith(
      expect.arrayContaining(target.seats.map((seat) => seat.id))
    )
    expect(deleteSubscriptionAccounts).toHaveBeenCalledWith(target.id)
  })

  it("rejects deleting a billing account that does not exist", async () => {
    const service = instantiateService()

    jest.spyOn(service as any, "listSubscriptionAccounts").mockResolvedValue(buildPersistedSummary())

    await expect(service.deleteBillingAccount("missing")).rejects.toThrow(
      new SubscriptionAccountNotFoundError("Billing account not found: missing")
    )
  })
})
