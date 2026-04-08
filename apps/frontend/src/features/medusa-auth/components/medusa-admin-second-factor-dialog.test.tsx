import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MedusaAdminSecondFactorDialog } from "@/features/medusa-auth/components/medusa-admin-second-factor-dialog";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";

describe("MedusaAdminSecondFactorDialog", () => {
  beforeEach(() => {
    useMedusaAdminAuthStore.setState({
      token: "jwt-token",
      user: {
        id: "user_123",
        email: "admin@example.com",
        first_name: null,
        last_name: null,
        avatar_url: null,
      },
      lastAuthenticatedEmail: "admin@example.com",
      pendingToken: null,
      pendingUser: null,
      secondFactorStatus: { email: "admin@example.com", totpEnabled: false },
      challengeRequired: false,
      setupSecret: null,
      setupQrDataUri: null,
      loading: false,
      error: null,
      refreshSecondFactorStatus: async () => ({ email: "admin@example.com", totpEnabled: false }),
      beginSecondFactorSetup: async () => undefined,
      confirmSecondFactorSetup: async () => undefined,
      disableSecondFactor: async () => undefined,
      clearError: () => undefined,
    });
  });

  it("renders QR setup state and confirms setup", async () => {
    const user = userEvent.setup();
    const confirmSecondFactorSetup = vi.fn().mockResolvedValue(undefined);

    useMedusaAdminAuthStore.setState({
      setupSecret: "SECRET123",
      setupQrDataUri: "data:image/svg+xml;base64,abc",
      confirmSecondFactorSetup,
    });

    render(<MedusaAdminSecondFactorDialog open onOpenChange={() => undefined} />);

    expect(screen.getByAltText("Medusa admin TOTP QR code")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Verification code"), "287082");
    await user.click(screen.getByRole("button", { name: "Confirm setup" }));

    expect(confirmSecondFactorSetup).toHaveBeenCalledWith("287082");
  });
});
