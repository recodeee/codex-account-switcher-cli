import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { AccountMenu } from "@/components/layout/account-menu";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";
import { renderWithProviders } from "@/test/utils";

describe("AccountMenu component", () => {
  beforeEach(() => {
    useMedusaAdminAuthStore.setState({
      token: null,
      user: null,
      lastAuthenticatedEmail: null,
      loading: false,
      error: null,
      login: async () => undefined,
      logout: () => undefined,
      clearError: () => undefined,
    });
  });

  it("shows Medusa sign-in state when no admin session exists", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<AccountMenu onLogout={() => undefined} />);

    await user.click(screen.getByRole("button", { name: "Open account menu" }));

    expect(screen.getByRole("menuitem", { name: "Sign in Medusa admin" })).toBeInTheDocument();
    expect(screen.getByText("Not signed in")).toBeInTheDocument();
    expect(screen.getByText("No Medusa admin login recorded yet")).toBeInTheDocument();
  });

  it("shows the backend-authenticated Medusa admin account instead of local credentials", async () => {
    const user = userEvent.setup({ delay: null });

    useMedusaAdminAuthStore.setState({
      token: "jwt-token",
      lastAuthenticatedEmail: "nagy.viktordp@gmail.com",
      user: {
        id: "user_123",
        email: "admin@recodee.com",
        first_name: "Admin",
        last_name: "User",
        avatar_url: null,
      },
    });

    renderWithProviders(<AccountMenu onLogout={() => undefined} />);

    await user.click(screen.getByRole("button", { name: "Open account menu" }));

    expect(screen.getByRole("menuitem", { name: "Sign out Medusa admin" })).toBeInTheDocument();
    expect(screen.getByText("admin@recodee.com")).toBeInTheDocument();
    expect(screen.getAllByText("nagy.viktordp@gmail.com").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("odin@recodee.com")).not.toBeInTheDocument();
    expect(screen.queryByText("medusa-secret")).not.toBeInTheDocument();
  });
});
