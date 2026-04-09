import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DASHBOARD_OVERVIEW_METADATA_KEY,
  DASHBOARD_OVERVIEW_METADATA_SAVED_AT_KEY,
  loadMedusaCustomerDashboardOverviewState,
  saveMedusaCustomerDashboardOverviewState,
} from "@/features/medusa-customer-auth/api";
import { medusaStoreFetch } from "@/lib/medusa/client";

vi.mock("@/lib/medusa/client", () => ({
  MedusaClientError: class MedusaClientError extends Error {
    status: number;
    body: string;

    constructor(message: string, status: number, body: string) {
      super(message);
      this.name = "MedusaClientError";
      this.status = status;
      this.body = body;
    }
  },
  medusaStoreFetch: vi.fn(),
}));

describe("medusa customer dashboard state metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads persisted dashboard overview from customer metadata", async () => {
    vi.mocked(medusaStoreFetch).mockResolvedValueOnce({
      customer: {
        id: "cus_123",
        email: "user@example.com",
        metadata: {
          [DASHBOARD_OVERVIEW_METADATA_KEY]: { summary: { metrics: { totalAccounts: 3 } } },
        },
      },
    });

    const result = await loadMedusaCustomerDashboardOverviewState("token-123");

    expect(result).toEqual({ summary: { metrics: { totalAccounts: 3 } } });
    expect(medusaStoreFetch).toHaveBeenCalledWith("/customers/me", {
      headers: {
        Authorization: "Bearer token-123",
      },
    });
  });

  it("saves dashboard overview by merging existing customer metadata", async () => {
    vi.mocked(medusaStoreFetch)
      .mockResolvedValueOnce({
        customer: {
          id: "cus_123",
          email: "user@example.com",
          metadata: {
            theme: "dark",
          },
        },
      })
      .mockResolvedValueOnce({
        customer: {
          id: "cus_123",
          email: "user@example.com",
        },
      });

    await saveMedusaCustomerDashboardOverviewState("token-123", {
      accounts: [{ accountId: "acc_1" }],
    });

    expect(medusaStoreFetch).toHaveBeenNthCalledWith(1, "/customers/me", {
      headers: {
        Authorization: "Bearer token-123",
      },
    });

    const secondCall = vi.mocked(medusaStoreFetch).mock.calls[1];
    expect(secondCall?.[0]).toBe("/customers/me");
    expect(secondCall?.[1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer token-123",
      },
    });

    const secondCallInit = secondCall?.[1] as RequestInit | undefined;
    const parsedBody = JSON.parse(String(secondCallInit?.body)) as {
      metadata?: Record<string, unknown>;
    };
    expect(parsedBody.metadata?.theme).toBe("dark");
    expect(parsedBody.metadata?.[DASHBOARD_OVERVIEW_METADATA_KEY]).toEqual({
      accounts: [{ accountId: "acc_1" }],
    });
    expect(typeof parsedBody.metadata?.[DASHBOARD_OVERVIEW_METADATA_SAVED_AT_KEY]).toBe(
      "string",
    );
  });
});
