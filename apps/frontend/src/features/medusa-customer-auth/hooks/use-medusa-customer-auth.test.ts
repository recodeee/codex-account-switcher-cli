import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getLoggedInMedusaCustomer,
  loginMedusaCustomer,
  registerMedusaCustomer,
} from "@/features/medusa-customer-auth/api";
import { useMedusaCustomerAuthStore } from "@/features/medusa-customer-auth/hooks/use-medusa-customer-auth";
import { MedusaClientError } from "@/lib/medusa/client";

vi.mock("@/features/medusa-customer-auth/api", () => ({
  loginMedusaCustomer: vi.fn(),
  registerMedusaCustomer: vi.fn(),
  getLoggedInMedusaCustomer: vi.fn(),
}));

const STORAGE_KEY = "codex-lb-medusa-customer-token";

function resetStore() {
  useMedusaCustomerAuthStore.setState({
    token: null,
    customer: null,
    initialized: false,
    loading: false,
    error: null,
  });
}

describe("useMedusaCustomerAuthStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem(STORAGE_KEY);
    resetStore();
  });

  it("initializes customer from a stored token", async () => {
    window.localStorage.setItem(STORAGE_KEY, "stored-token");
    vi.mocked(getLoggedInMedusaCustomer).mockResolvedValue({
      id: "cus_123",
      email: "customer@example.com",
      first_name: "Test",
      last_name: "Customer",
      phone: null,
    });

    await useMedusaCustomerAuthStore.getState().initialize();

    const next = useMedusaCustomerAuthStore.getState();
    expect(getLoggedInMedusaCustomer).toHaveBeenCalledWith("stored-token");
    expect(next.initialized).toBe(true);
    expect(next.token).toBe("stored-token");
    expect(next.customer?.email).toBe("customer@example.com");
  });

  it("logs in and stores token + customer", async () => {
    vi.mocked(loginMedusaCustomer).mockResolvedValue("jwt-token");
    vi.mocked(getLoggedInMedusaCustomer).mockResolvedValue({
      id: "cus_123",
      email: "customer@example.com",
      first_name: "Test",
      last_name: "Customer",
      phone: null,
    });

    await useMedusaCustomerAuthStore
      .getState()
      .login("customer@example.com", "supersecret");

    const next = useMedusaCustomerAuthStore.getState();
    expect(loginMedusaCustomer).toHaveBeenCalledWith({
      email: "customer@example.com",
      password: "supersecret",
    });
    expect(next.token).toBe("jwt-token");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("jwt-token");
    expect(next.customer?.email).toBe("customer@example.com");
  });

  it("surfaces medusa API errors when register fails", async () => {
    vi.mocked(registerMedusaCustomer).mockRejectedValue(
      new MedusaClientError(
        "Medusa auth request failed with status 401",
        401,
        JSON.stringify({ message: "Identity with email already exists" }),
      ),
    );

    await expect(
      useMedusaCustomerAuthStore.getState().register({
        email: "customer@example.com",
        password: "supersecret",
      }),
    ).rejects.toBeInstanceOf(MedusaClientError);

    const next = useMedusaCustomerAuthStore.getState();
    expect(next.error).toBe("Identity with email already exists");
    expect(next.loading).toBe(false);
  });

  it("shows explicit publishable key guidance when store requests fail due missing key header", async () => {
    vi.mocked(loginMedusaCustomer).mockResolvedValue("jwt-token");
    vi.mocked(getLoggedInMedusaCustomer).mockRejectedValue(
      new MedusaClientError(
        "Medusa request failed with status 400",
        400,
        JSON.stringify({
          message:
            "Publishable API key required in the request header: x-publishable-api-key.",
        }),
      ),
    );

    await expect(
      useMedusaCustomerAuthStore
        .getState()
        .login("customer@example.com", "supersecret"),
    ).rejects.toBeInstanceOf(MedusaClientError);

    const next = useMedusaCustomerAuthStore.getState();
    expect(next.error).toMatch(/Missing Medusa publishable key/i);
    expect(next.error).toMatch(/NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY/i);
  });

  it("clears auth state on logout", () => {
    useMedusaCustomerAuthStore.setState({
      token: "jwt-token",
      customer: {
        id: "cus_123",
        email: "customer@example.com",
        first_name: "Test",
        last_name: "Customer",
        phone: null,
      },
      initialized: true,
      loading: false,
      error: "some error",
    });
    window.localStorage.setItem(STORAGE_KEY, "jwt-token");

    useMedusaCustomerAuthStore.getState().logout();

    const next = useMedusaCustomerAuthStore.getState();
    expect(next.token).toBeNull();
    expect(next.customer).toBeNull();
    expect(next.error).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
