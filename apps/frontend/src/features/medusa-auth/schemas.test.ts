import { describe, expect, it } from "vitest";

import {
  MedusaAdminLoginRequestSchema,
  MedusaAdminLoginResponseSchema,
  MedusaAdminUserResponseSchema,
} from "@/features/medusa-auth/schemas";

describe("Medusa admin auth schemas", () => {
  it("validates email/password login payload", () => {
    expect(
      MedusaAdminLoginRequestSchema.safeParse({
        email: "admin@example.com",
        password: "secret",
      }).success,
    ).toBe(true);

    expect(
      MedusaAdminLoginRequestSchema.safeParse({
        email: "not-an-email",
        password: "secret",
      }).success,
    ).toBe(false);
  });

  it("accepts token or location auth responses", () => {
    expect(
      MedusaAdminLoginResponseSchema.safeParse({ token: "jwt-token" }).success,
    ).toBe(true);
    expect(
      MedusaAdminLoginResponseSchema.safeParse({ location: "https://example.com" }).success,
    ).toBe(true);
  });

  it("parses admin user payload", () => {
    const parsed = MedusaAdminUserResponseSchema.parse({
      user: {
        id: "user_123",
        email: "admin@example.com",
        first_name: "Admin",
        last_name: "User",
        avatar_url: null,
      },
    });

    expect(parsed.user.email).toBe("admin@example.com");
  });
});
