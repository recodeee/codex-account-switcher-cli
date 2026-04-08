import {
  buildOtpAuthUri,
  encryptSecondFactorSecret,
  decryptSecondFactorSecret,
  verifyTotpCode,
} from "./medusa-admin-second-factor"

describe("medusa admin second-factor helpers", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

  it("builds an otpauth URI for the Medusa admin account", () => {
    expect(buildOtpAuthUri(secret, "admin@example.com")).toBe(
      "otpauth://totp/codex-lb%20Medusa%20Admin:admin%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=codex-lb%20Medusa%20Admin&algorithm=SHA1&digits=6&period=30"
    )
  })

  it("verifies valid TOTP codes and rejects replays", () => {
    const verified = verifyTotpCode(secret, "287082", {
      now: 59_000,
      lastVerifiedStep: null,
    })

    expect(verified.valid).toBe(true)
    expect(verified.matchedStep).toBe(1)

    const replay = verifyTotpCode(secret, "287082", {
      now: 59_000,
      lastVerifiedStep: verified.matchedStep,
    })

    expect(replay.valid).toBe(false)
  })

  it("rejects invalid TOTP codes", () => {
    const result = verifyTotpCode(secret, "000000", {
      now: 59_000,
      lastVerifiedStep: null,
    })

    expect(result.valid).toBe(false)
  })

  it("encrypts and decrypts a secret deterministically with the configured key", () => {
    process.env.MEDUSA_ADMIN_2FA_SECRET = "test-medusa-admin-2fa-secret"

    const encrypted = encryptSecondFactorSecret(secret)

    expect(encrypted).not.toBe(secret)
    expect(decryptSecondFactorSecret(encrypted)).toBe(secret)
  })
})
