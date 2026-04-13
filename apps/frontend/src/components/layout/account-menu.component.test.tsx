import { screen, waitFor } from "@testing-library/react";
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

  it("hides signed-out Medusa menu state when no admin session exists", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<AccountMenu onLogout={() => undefined} />);

    await user.click(screen.getByRole("button", { name: "Open account menu" }));

    expect(screen.queryByRole("menuitem", { name: "Sign in Medusa admin" })).not.toBeInTheDocument();
    expect(screen.queryByText("Medusa admin")).not.toBeInTheDocument();
    expect(screen.queryByText("Not signed in")).not.toBeInTheDocument();
    expect(screen.queryByText("Last Medusa admin login")).not.toBeInTheDocument();
    expect(screen.queryByText("No Medusa admin login recorded yet")).not.toBeInTheDocument();
  });

  it("uses the last Medusa login as the displayed login when no active Medusa session exists", async () => {
    const user = userEvent.setup({ delay: null });

    useMedusaAdminAuthStore.setState({
      token: null,
      user: null,
      lastAuthenticatedEmail: "nagy.viktordp@gmail.com",
    });

    renderWithProviders(<AccountMenu onLogout={() => undefined} />);

    await user.click(screen.getByRole("button", { name: "Open account menu" }));

    expect(screen.queryByRole("menuitem", { name: "Sign in Medusa admin" })).not.toBeInTheDocument();
    expect(screen.queryByText("Medusa admin")).not.toBeInTheDocument();
    expect(screen.queryByText("Last Medusa admin login")).not.toBeInTheDocument();
    expect(screen.getAllByText("nagy.viktordp@gmail.com").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps menu focused on profile/theme/privacy/logout while still showing backend-authenticated identity details", async () => {
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

    const { queryClient } = renderWithProviders(<AccountMenu onLogout={() => undefined} />);
    queryClient.setQueryData(["dashboard", "overview"], {
      accounts: [
        {
          accountId: "account_123",
          email: "admin@recodee.com",
          status: "active",
          codexLiveSessionCount: 0,
          codexTrackedSessionCount: 0,
          codexSessionCount: 0,
          codexAuth: null,
        },
      ],
    });

    const trigger = screen.getByRole("button", { name: "Open account menu" });
    expect(trigger).toHaveTextContent("admin@recodee.com");

    await user.click(trigger);

    expect(screen.queryByRole("menuitem", { name: "Sign out Medusa admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Accounts" })).not.toBeInTheDocument();
    expect(screen.getByText("Logged in account")).toBeInTheDocument();
    expect(screen.getAllByText("admin@recodee.com").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Last Medusa admin login")).toBeInTheDocument();
    expect(screen.getByText("nagy.viktordp@gmail.com")).toBeInTheDocument();
    expect(screen.getAllByText("Active Codex account").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("odin@recodee.com")).not.toBeInTheDocument();
    expect(screen.queryByText("medusa-secret")).not.toBeInTheDocument();
  });

  it("falls back to the active Codex account email when no dashboard login email is recorded", async () => {
    renderWithProviders(<AccountMenu onLogout={() => undefined} />);

    await waitFor(() => {
      const trigger = screen.getByRole("button", { name: "Open account menu" });
      expect(trigger).toHaveTextContent("primary@example.com");
      expect(trigger).not.toHaveTextContent("No dashboard login recorded yet");
    });
  });
});
