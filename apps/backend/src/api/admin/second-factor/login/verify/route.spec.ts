import { POST } from "./route"
import { verifyMedusaAdminSecondFactorLogin } from "../../../../../lib/medusa-admin-second-factor-service"

jest.mock("../../../../../lib/medusa-admin-second-factor-service", () => ({
  verifyMedusaAdminSecondFactorLogin: jest.fn(),
}))

describe("POST /admin/second-factor/login/verify", () => {
  it("verifies the pending Medusa admin login challenge", async () => {
    ;(verifyMedusaAdminSecondFactorLogin as jest.Mock).mockResolvedValue({
      status: "ok",
    })

    const req = {
      body: { code: "287082" },
      auth_context: { actor_id: "user_123" },
      scope: { resolve: jest.fn() },
    } as any
    const res = { json: jest.fn() } as any

    await POST(req, res)

    expect(verifyMedusaAdminSecondFactorLogin).toHaveBeenCalledWith(req, "287082")
    expect(res.json).toHaveBeenCalledWith({ status: "ok" })
  })
})
