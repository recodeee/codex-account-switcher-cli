import { PUT } from "./route"
import { SubscriptionAccountValidationError } from "../../modules/subscription/service"

describe("PUT /billing", () => {
  it("updates billing accounts through the subscription module", async () => {
    const updateBillingAccounts = jest.fn().mockResolvedValue({
      accounts: [{ id: "business-plan-edixai", domain: "edixai.com" }],
    })

    const req = {
      body: {
        accounts: [
          {
            id: "business-plan-edixai",
            domain: "edixai.com",
            plan_code: "business",
            plan_name: "Business",
            subscription_status: "active",
            entitled: true,
            payment_status: "paid",
            billing_cycle: {
              start: "2026-03-23T00:00:00.000Z",
              end: "2026-04-23T00:00:00.000Z",
            },
            renewal_at: "2026-04-23T00:00:00.000Z",
            chatgpt_seats_in_use: 7,
            codex_seats_in_use: 3,
            members: [],
          },
        ],
      },
      scope: {
        resolve: jest.fn().mockReturnValue({ updateBillingAccounts }),
      },
    } as any
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    await PUT(req, res)

    expect(updateBillingAccounts).toHaveBeenCalledWith(req.body.accounts)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      accounts: [{ id: "business-plan-edixai", domain: "edixai.com" }],
    })
  })

  it("returns 400 when payload is invalid", async () => {
    const req = {
      body: {
        accounts: [{ id: "missing-fields" }],
      },
      scope: {
        resolve: jest.fn(),
      },
    } as any
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    await PUT(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "invalid_billing_payload",
        message: "Invalid billing payload",
      },
    })
  })

  it("returns 400 for validation errors raised by the service", async () => {
    const updateBillingAccounts = jest
      .fn()
      .mockRejectedValue(new SubscriptionAccountValidationError("Unknown billing account missing"))

    const req = {
      body: {
        accounts: [
          {
            id: "missing",
            domain: "edixai.com",
            plan_code: "business",
            plan_name: "Business",
            subscription_status: "active",
            entitled: true,
            payment_status: "paid",
            billing_cycle: {
              start: "2026-03-23T00:00:00.000Z",
              end: "2026-04-23T00:00:00.000Z",
            },
            renewal_at: "2026-04-23T00:00:00.000Z",
            chatgpt_seats_in_use: 7,
            codex_seats_in_use: 3,
            members: [],
          },
        ],
      },
      scope: {
        resolve: jest.fn().mockReturnValue({ updateBillingAccounts }),
      },
    } as any
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    await PUT(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "invalid_billing_payload",
        message: "Unknown billing account missing",
      },
    })
  })
})
