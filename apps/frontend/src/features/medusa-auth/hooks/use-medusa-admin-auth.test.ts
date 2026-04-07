import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMedusaAdminUser, loginMedusaAdmin } from "@/features/medusa-auth/api";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";
import { MedusaClientError } from "@/lib/medusa/client";

vi.mock("@/features/medusa-auth/api", () => ({
  loginMedusaAdmin: vi.fn(),
  getMedusaAdminUser: vi.fn(),
}));

function resetStore() {
  useMedusaAdminAuthStore.setState({
    token: null,
    user: null,
    loading: false,
    error: null,
  });
}

describe("useMedusaAdminAuthStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("logs in with Medusa admin credentials and stores token + user", async () => {
    vi.mocked(loginMedusaAdmin).mockResolvedValue("jwt-token");
    vi.mocked(getMedusaAdminUser).mockResolvedValue({
      id: "user_123",
      email: "admin@example.com",
      first_name: "Admin",
      last_name: "User",
      avatar_url: null,
    });

    await useMedusaAdminAuthStore.getState().login("admin@example.com", "secret");

    const next = useMedusaAdminAuthStore.getState();
    expect(loginMedusaAdmin).toHaveBeenCalledWith({
      email: "admin@example.com",
      password: "secret",
    });
    expect(getMedusaAdminUser).toHaveBeenCalledWith("jwt-token");
    expect(next.token).toBe("jwt-token");
    expect(next.user?.email).toBe("admin@example.com");
    expect(next.error).toBeNull();
    expect(next.loading).toBe(false);
  });

  it("maps Medusa API error message when login fails", async () => {
    vi.mocked(loginMedusaAdmin).mockRejectedValue(
      new MedusaClientError(
        "Medusa admin request failed with status 401",
        401,
        JSON.stringify({ message: "Invalid email or password" }),
      ),
    );

    await expect(
      useMedusaAdminAuthStore.getState().login("admin@example.com", "bad-pass"),
    ).rejects.toBeInstanceOf(MedusaClientError);

    const next = useMedusaAdminAuthStore.getState();
    expect(next.error).toBe("Invalid email or password");
    expect(next.loading).toBe(false);
    expect(next.user).toBeNull();
  });

  it("clears state on logout", () => {
    useMedusaAdminAuthStore.setState({
      token: "token",
      user: {
        id: "user_123",
        email: "admin@example.com",
        first_name: null,
        last_name: null,
        avatar_url: null,
      },
      error: "some error",
      loading: false,
    });

    useMedusaAdminAuthStore.getState().logout();

    const next = useMedusaAdminAuthStore.getState();
    expect(next.token).toBeNull();
    expect(next.user).toBeNull();
    expect(next.error).toBeNull();
  });
});
