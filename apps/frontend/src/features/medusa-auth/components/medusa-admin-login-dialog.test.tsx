import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MedusaAdminLoginDialog } from "@/features/medusa-auth/components/medusa-admin-login-dialog";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";

describe("MedusaAdminLoginDialog second factor flow", () => {
  beforeEach(() => {
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
      login: async () => undefined,
      verifySecondFactor: async () => undefined,
      logout: () => undefined,
      clearError: () => undefined,
    });
  });

  it("switches to a TOTP challenge when login requires second factor", async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockImplementation(async (email: string) => {
      useMedusaAdminAuthStore.setState({
        pendingToken: "jwt-token",
        pendingUser: {
          id: "user_123",
          email,
          first_name: "Admin",
          last_name: "User",
          avatar_url: null,
        },
        challengeRequired: true,
        secondFactorStatus: { email, totpEnabled: true },
      });
    });

    useMedusaAdminAuthStore.setState({
      login,
      clearError: vi.fn(),
    });

    render(<MedusaAdminLoginDialog open onOpenChange={() => undefined} />);

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "secret-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(login).toHaveBeenCalledWith("admin@example.com", "secret-pass");
    expect(await screen.findByLabelText("TOTP code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify code" })).toBeInTheDocument();
  });
});
