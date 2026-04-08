import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getMedusaAdminSecondFactorStatus,
  getMedusaAdminUser,
  loginMedusaAdmin,
  verifyMedusaAdminSecondFactor,
} from "@/features/medusa-auth/api";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";

vi.mock("@/features/medusa-auth/api", () => ({
  loginMedusaAdmin: vi.fn(),
  getMedusaAdminUser: vi.fn(),
  getMedusaAdminSecondFactorStatus: vi.fn(),
  verifyMedusaAdminSecondFactor: vi.fn(),
}));

function resetStore() {
  useMedusaAdminAuthStore.setState({
    token: null,
    user: null,
    pendingToken: null,
    pendingUser: null,
    secondFactorStatus: null,
    challengeRequired: false,
    loading: false,
    error: null,
  });
}

describe("useMedusaAdminAuthStore second factor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("keeps Medusa session pending when second factor is enabled", async () => {
    vi.mocked(loginMedusaAdmin).mockResolvedValue("jwt-token");
    vi.mocked(getMedusaAdminUser).mockResolvedValue({
      id: "user_123",
      email: "admin@example.com",
      first_name: "Admin",
      last_name: "User",
      avatar_url: null,
    });
    vi.mocked(getMedusaAdminSecondFactorStatus).mockResolvedValue({
      email: "admin@example.com",
      totpEnabled: true,
    });

    await useMedusaAdminAuthStore
      .getState()
      .login("admin@example.com", "secret");

    const next = useMedusaAdminAuthStore.getState();
    expect(next.token).toBeNull();
    expect(next.user).toBeNull();
    expect(next.pendingToken).toBe("jwt-token");
    expect(next.pendingUser?.email).toBe("admin@example.com");
    expect(next.challengeRequired).toBe(true);
  });

  it("promotes pending session after successful second-factor verification", async () => {
    useMedusaAdminAuthStore.setState({
      pendingToken: "jwt-token",
      pendingUser: {
        id: "user_123",
        email: "admin@example.com",
        first_name: "Admin",
        last_name: "User",
        avatar_url: null,
      },
      challengeRequired: true,
      secondFactorStatus: { email: "admin@example.com", totpEnabled: true },
    });
    vi.mocked(verifyMedusaAdminSecondFactor).mockResolvedValue({
      status: "ok",
    });

    await useMedusaAdminAuthStore.getState().verifySecondFactor("123456");

    const next = useMedusaAdminAuthStore.getState();
    expect(next.token).toBe("jwt-token");
    expect(next.user?.email).toBe("admin@example.com");
    expect(next.pendingToken).toBeNull();
    expect(next.challengeRequired).toBe(false);
  });
});
