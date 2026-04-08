import { DELETE, POST } from "./route"
import {
  SubscriptionAccountConflictError,
  SubscriptionAccountNotFoundError,
  SubscriptionAccountValidationError,
} from "../../../modules/subscription/service"

describe("POST /billing/accounts", () => {
  it("creates a subscription account through the subscription module", async () => {
    const addBillingAccount = jest.fn().mockResolvedValue({
      id: "business-plan-example",
      domain: "example.com",
    })

    const req = {
      body: {
        domain: "example.com",
      },
      scope: {
        resolve: jest.fn().mockReturnValue({ addBillingAccount }),
      },
    } as any
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    await POST(req, res)

    expect(addBillingAccount).toHaveBeenCalledWith({ domain: "example.com" })
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({
      id: "business-plan-example",
      domain: "example.com",
    })
  })

  it("returns 400 when payload is invalid", async () => {
    const req = {
      body: {
        domain: "",
      },
      scope: {
        resolve: jest.fn(),
      },
    } as any
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "invalid_billing_account_payload",
        message: "Invalid billing account payload",
      },
    })
  })

  it("returns 409 when the domain already exists", async () => {
    const addBillingAccount = jest
      .fn()
      .mockRejectedValue(new SubscriptionAccountConflictError("Subscription account already exists for example.com"))

    const req = {
      body: {
        domain: "example.com",
      },
      scope: {
        resolve: jest.fn().mockReturnValue({ addBillingAccount }),
      },
    } as any
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "billing_account_exists",
        message: "Subscription account already exists for example.com",
      },
    })
  })

  it("returns 400 for validation errors raised by the service", async () => {
    const addBillingAccount = jest
      .fn()
      .mockRejectedValue(new SubscriptionAccountValidationError("Domain is required"))

    const req = {
      body: {
        domain: "example.com",
      },
      scope: {
        resolve: jest.fn().mockReturnValue({ addBillingAccount }),
      },
    } as any
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "invalid_billing_account_payload",
        message: "Domain is required",
      },
    })
  })
})

describe("DELETE /billing/accounts", () => {
  it("deletes a subscription account through the subscription module", async () => {
    const deleteBillingAccount = jest.fn().mockResolvedValue(undefined)

    const req = {
      body: {
        id: "business-plan-example",
      },
      scope: {
        resolve: jest.fn().mockReturnValue({ deleteBillingAccount }),
      },
    } as any
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    } as any

    await DELETE(req, res)

    expect(deleteBillingAccount).toHaveBeenCalledWith("business-plan-example")
    expect(res.status).toHaveBeenCalledWith(204)
    expect(res.send).toHaveBeenCalled()
  })

  it("returns 400 when delete payload is invalid", async () => {
    const req = {
      body: {
        id: "",
      },
      scope: {
        resolve: jest.fn(),
      },
    } as any
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    } as any

    await DELETE(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "invalid_billing_account_payload",
        message: "Invalid billing account payload",
      },
    })
  })

  it("returns 404 when the billing account is missing", async () => {
    const deleteBillingAccount = jest
      .fn()
      .mockRejectedValue(new SubscriptionAccountNotFoundError("Billing account not found: missing"))

    const req = {
      body: {
        id: "missing",
      },
      scope: {
        resolve: jest.fn().mockReturnValue({ deleteBillingAccount }),
      },
    } as any
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    } as any

    await DELETE(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "billing_account_not_found",
        message: "Billing account not found: missing",
      },
    })
  })
})
