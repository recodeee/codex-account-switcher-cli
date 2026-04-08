import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getMedusaAdminSecondFactorStatus,
  getMedusaAdminUser,
  loginMedusaAdmin,
} from "@/features/medusa-auth/api";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";

vi.mock("@/features/medusa-auth/api", () => ({
  loginMedusaAdmin: vi.fn(),
  getMedusaAdminUser: vi.fn(),
  getMedusaAdminSecondFactorStatus: vi.fn(),
}));

function resetStore() {
  useMedusaAdminAuthStore.setState({
    token: null,
    user: null,
    lastAuthenticatedEmail: null,
    pendingToken: null,
    pendingUser: null,
    secondFactorStatus: null,
    challengeRequired: false,
    setupSecret: null,
    setupQrDataUri: null,
    loading: false,
    error: null,
  });
}

describe("useMedusaAdminAuthStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("remembers the Medusa login email entered by the operator, not the backend user email", async () => {
    vi.mocked(loginMedusaAdmin).mockResolvedValue("jwt-token");
    vi.mocked(getMedusaAdminUser).mockResolvedValue({
      id: "user_123",
      email: "admin@recodee.com",
      first_name: "Admin",
      last_name: "User",
      avatar_url: null,
    });
    vi.mocked(getMedusaAdminSecondFactorStatus).mockResolvedValue({
      email: "admin@recodee.com",
      totpEnabled: false,
    });

    await useMedusaAdminAuthStore.getState().login("nagy.viktordp@gmail.com", "secret-pass");

    const next = useMedusaAdminAuthStore.getState() as Record<string, unknown>;
    expect(next.token).toBe("jwt-token");
    expect(next.user).toMatchObject({ email: "admin@recodee.com" });
    expect(next.lastAuthenticatedEmail).toBe("nagy.viktordp@gmail.com");
    expect(next.error).toBeNull();
    expect(next.loading).toBe(false);
    expect("lastLoginCredentials" in next).toBe(false);
  });

  it("preserves the remembered login email across logout", () => {
    useMedusaAdminAuthStore.setState({
      token: "jwt-token",
      user: {
        id: "user_123",
        email: "admin@recodee.com",
        first_name: "Admin",
        last_name: "User",
        avatar_url: null,
      },
      lastAuthenticatedEmail: "nagy.viktordp@gmail.com",
      pendingToken: "pending-token",
      pendingUser: {
        id: "user_123",
        email: "admin@recodee.com",
        first_name: "Admin",
        last_name: "User",
        avatar_url: null,
      },
      challengeRequired: true,
      secondFactorStatus: { email: "admin@recodee.com", totpEnabled: true },
      error: "Nope",
    });

    useMedusaAdminAuthStore.getState().logout();

    const loggedOut = useMedusaAdminAuthStore.getState();
    expect(loggedOut.token).toBeNull();
    expect(loggedOut.user).toBeNull();
    expect(loggedOut.pendingToken).toBeNull();
    expect(loggedOut.pendingUser).toBeNull();
    expect(loggedOut.challengeRequired).toBe(false);
    expect(loggedOut.lastAuthenticatedEmail).toBe("nagy.viktordp@gmail.com");
    expect(loggedOut.error).toBeNull();
  });
});
