import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { AccountMenu } from "@/components/layout/account-menu";
import { useMedusaCustomerAuthStore } from "@/features/medusa-customer-auth/hooks/use-medusa-customer-auth";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";
import { renderWithProviders } from "@/test/utils";

describe("AccountMenu component", () => {
  beforeEach(() => {
    useMedusaCustomerAuthStore.setState({
      token: null,
      customer: null,
      initialized: true,
      loading: false,
      error: null,
      initialize: async () => undefined,
      login: async () => undefined,
      register: async () => undefined,
      logout: () => undefined,
      clearError: () => undefined,
    });
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

  it("does not use the last Medusa login as the displayed identity fallback", async () => {
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
    expect(
      screen.getAllByText("No dashboard login recorded yet").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("keeps menu focused on profile/theme/privacy/logout while still showing backend-authenticated identity details", async () => {
    const user = userEvent.setup({ delay: null });

    useMedusaCustomerAuthStore.setState({
      customer: {
        id: "cust_123",
        email: "customer@recodee.com",
        first_name: "Customer",
        last_name: "User",
        phone: null,
      },
    });
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
    expect(trigger).toHaveTextContent("customer@recodee.com");

    await user.click(trigger);

    expect(screen.queryByRole("menuitem", { name: "Sign out Medusa admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Accounts" })).not.toBeInTheDocument();
    expect(screen.getByText("Logged in account")).toBeInTheDocument();
    expect(screen.getAllByText("customer@recodee.com").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Medusa admin")).toBeInTheDocument();
    expect(screen.getByText("admin@recodee.com")).toBeInTheDocument();
    expect(screen.getByText("Last Medusa admin login")).toBeInTheDocument();
    expect(screen.getByText("nagy.viktordp@gmail.com")).toBeInTheDocument();
    expect(screen.getAllByText("Active Codex account").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("odin@recodee.com")).not.toBeInTheDocument();
    expect(screen.queryByText("medusa-secret")).not.toBeInTheDocument();
  });

  it("shows active Codex account only as secondary detail when no login identity is available", async () => {
    renderWithProviders(<AccountMenu onLogout={() => undefined} />);

    await waitFor(() => {
      const trigger = screen.getByRole("button", { name: "Open account menu" });
      expect(trigger).toHaveTextContent("No dashboard login recorded yet");
      expect(trigger).toHaveTextContent(
        "Active Codex account: primary@example.com",
      );
    });
  });
});
