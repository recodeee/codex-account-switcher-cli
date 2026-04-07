import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MedusaAdminLoginDialog } from "@/features/medusa-auth/components/medusa-admin-login-dialog";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";

describe("MedusaAdminLoginDialog", () => {
  beforeEach(() => {
    useMedusaAdminAuthStore.setState({
      token: null,
      user: null,
      loading: false,
      error: null,
      login: async () => undefined,
      logout: () => undefined,
      clearError: () => undefined,
    });
  });

  it("submits admin credentials", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const login = vi.fn().mockResolvedValue(undefined);
    const clearError = vi.fn();

    useMedusaAdminAuthStore.setState({
      loading: false,
      error: null,
      login,
      clearError,
    });

    render(<MedusaAdminLoginDialog open onOpenChange={onOpenChange} />);

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "secret-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(clearError).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith("admin@example.com", "secret-pass");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows error state from store", () => {
    useMedusaAdminAuthStore.setState({
      error: "Invalid email or password",
      loading: false,
    });

    render(<MedusaAdminLoginDialog open onOpenChange={() => undefined} />);

    expect(screen.getByText("Invalid email or password")).toBeInTheDocument();
  });
});
