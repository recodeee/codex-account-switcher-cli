import { GET } from "./route"
import { getMedusaAdminSecondFactorStatus } from "../../../../lib/medusa-admin-second-factor-service"

jest.mock("../../../../lib/medusa-admin-second-factor-service", () => ({
  getMedusaAdminSecondFactorStatus: jest.fn(),
}))

describe("GET /admin/second-factor/status", () => {
  it("returns the authenticated admin user's second-factor status", async () => {
    ;(getMedusaAdminSecondFactorStatus as jest.Mock).mockResolvedValue({
      enabled: true,
    })

    const req = {
      auth_context: { actor_id: "user_123" },
      scope: { resolve: jest.fn() },
    } as any
    const res = { json: jest.fn() } as any

    await GET(req, res)

    expect(getMedusaAdminSecondFactorStatus).toHaveBeenCalledWith(req)
    expect(res.json).toHaveBeenCalledWith({ enabled: true })
  })
})
