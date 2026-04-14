import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "@/features/auth/components/auth-gate";
import { useMedusaCustomerAuthStore } from "@/features/medusa-customer-auth/hooks/use-medusa-customer-auth";
import { markNavigationLoaderSuppressed } from "@/lib/navigation-loader";

function setAuthState(
  patch: Partial<ReturnType<typeof useMedusaCustomerAuthStore.getState>>,
): void {
  useMedusaCustomerAuthStore.setState({
    token: null,
    customer: null,
    initialized: true,
    loading: false,
    error: null,
    ...patch,
  });
}

function setDocumentReferrer(value: string): void {
  Object.defineProperty(document, "referrer", {
    configurable: true,
    value,
  });
}

describe("AuthGate", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    setDocumentReferrer("");
    setAuthState({
      initialize: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("shows Medusa login/register page when unauthenticated", async () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    setAuthState({
      initialize,
      customer: null,
      token: null,
      initialized: true,
    });

    render(
      <AuthGate>
        <div>Protected content</div>
      </AuthGate>,
    );

    expect(screen.getByRole("tab", { name: "Login" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Register" })).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
  });

  it("shows children when customer is authenticated", async () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    setAuthState({
      initialize,
      token: "test-medusa-token",
      customer: {
        id: "cus_123",
        email: "customer@example.com",
        first_name: "Test",
        last_name: "Customer",
        phone: null,
      },
      initialized: true,
      loading: false,
    });

    render(
      <AuthGate>
        <div>Protected content</div>
      </AuthGate>,
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
  });

  it("keeps children visible while authenticated auth state is loading", async () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    setAuthState({
      initialize,
      token: "test-medusa-token",
      customer: {
        id: "cus_123",
        email: "customer@example.com",
        first_name: "Test",
        last_name: "Customer",
        phone: null,
      },
      initialized: true,
      loading: true,
    });

    render(
      <AuthGate>
        <div>Protected content</div>
      </AuthGate>,
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
  });

  it("shows blocking loader before initial auth restore by default", async () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    setAuthState({
      initialize,
      customer: null,
      token: null,
      initialized: false,
      loading: false,
    });

    render(
      <AuthGate>
        <div>Protected content</div>
      </AuthGate>,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
  });

  it("keeps app shell visible during navigation suppression even before auth restore finishes", async () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    setAuthState({
      initialize,
      customer: null,
      token: null,
      initialized: false,
      loading: false,
    });
    markNavigationLoaderSuppressed(10_000);

    render(
      <AuthGate>
        <div>Protected content</div>
      </AuthGate>,
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
  });

  it("keeps app shell visible during same-origin page navigation even without explicit suppression flag", async () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    setAuthState({
      initialize,
      customer: null,
      token: null,
      initialized: false,
      loading: false,
    });
    setDocumentReferrer(`${window.location.origin}/dashboard`);

    render(
      <AuthGate>
        <div>Protected content</div>
      </AuthGate>,
    );

    expect(screen.getByText("Protected content")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
  });

  it("does not crash when initial Medusa session restore fails", async () => {
    const initialize = vi.fn().mockRejectedValue(new Error("Request failed"));
    setAuthState({
      initialize,
      customer: null,
      token: null,
      initialized: true,
    });

    render(
      <AuthGate>
        <div>Protected content</div>
      </AuthGate>,
    );

    expect(screen.getByRole("tab", { name: "Login" })).toBeInTheDocument();
    expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
  });
});
