import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingAccountsResponse } from "@/features/billing/schemas";
import { useBilling } from "@/features/billing/hooks/use-billing";
import { renderWithProviders } from "@/test/utils";

import { BillingPage } from "./billing-page";

vi.mock("@/features/billing/hooks/use-billing", () => ({
  useBilling: vi.fn(),
}));

const useBillingMock = vi.mocked(useBilling);

const billingSummary: BillingAccountsResponse = {
  accounts: [
    {
      id: "business-plan-edixai",
      domain: "edixai.com",
      planCode: "business",
      planName: "Business",
      subscriptionStatus: "active",
      entitled: true,
      paymentStatus: "paid",
      billingCycle: {
        start: new Date("2026-03-23T00:00:00.000Z"),
        end: new Date("2026-04-23T00:00:00.000Z"),
      },
      renewalAt: new Date("2026-04-23T00:00:00.000Z"),
      chatgptSeatsInUse: 5,
      codexSeatsInUse: 5,
      members: [
        {
          id: "member-edixai-owner",
          name: "Edix.ai (You)",
          email: "admin@edixai.com",
          role: "Owner",
          seatType: "ChatGPT",
          dateAdded: "2026-03-23T00:00:00.000Z",
        },
      ],
    },
    {
      id: "business-plan-kozpont",
      domain: "kozpontihusbolt.hu",
      planCode: "business",
      planName: "Business",
      subscriptionStatus: "past_due",
      entitled: false,
      paymentStatus: "past_due",
      billingCycle: {
        start: new Date("2026-03-26T00:00:00.000Z"),
        end: new Date("2026-04-26T00:00:00.000Z"),
      },
      renewalAt: new Date("2026-04-26T00:00:00.000Z"),
      chatgptSeatsInUse: 5,
      codexSeatsInUse: 5,
      members: [
        {
          id: "member-kozpont-admin",
          name: "Kozpont Admin",
          email: "admin@kozpontihusbolt.hu",
          role: "Owner",
          seatType: "ChatGPT",
          dateAdded: "2026-03-23T00:00:00.000Z",
        },
      ],
    },
  ],
};

function mockBillingQuery(
  overrides?: Record<string, unknown>,
  createMutationOverrides?: Record<string, unknown>,
) {
  const mutateAsync = vi.fn().mockResolvedValue(undefined);
  useBillingMock.mockReturnValue({
    billingQuery: {
      data: billingSummary,
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      ...overrides,
    },
    createAccountMutation: {
      mutateAsync,
      isPending: false,
      error: null,
      ...createMutationOverrides,
    },
  } as never);

  return {
    mutateAsync,
  };
}

describe("BillingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders live subscription summary cards and entitlement state", () => {
    mockBillingQuery();

    renderWithProviders(<BillingPage />);

    expect(screen.getByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByText("Live subscription state from Medusa")).toBeInTheDocument();
    expect(screen.getByText("edixai.com")).toBeInTheDocument();
    expect(screen.getByText("kozpontihusbolt.hu")).toBeInTheDocument();
    expect(screen.getAllByText("Past due").length).toBeGreaterThan(0);
    expect(screen.getByText("Not entitled")).toBeInTheDocument();
    expect(screen.getByText("Apr 23, 2026")).toBeInTheDocument();

    const accountsCard = screen.getByText("Billed accounts").closest("div");
    const entitledCard = screen.getByText("Entitled accounts").closest("div");
    const chatgptCard = screen.getByText("ChatGPT seats in use").closest("div");
    const codexCard = screen.getByText("Codex seats in use").closest("div");

    expect(accountsCard).not.toBeNull();
    expect(entitledCard).not.toBeNull();
    expect(chatgptCard).not.toBeNull();
    expect(codexCard).not.toBeNull();

    expect(within(accountsCard as HTMLDivElement).getByText("2")).toBeInTheDocument();
    expect(within(entitledCard as HTMLDivElement).getByText("1 of 2")).toBeInTheDocument();
    expect(within(chatgptCard as HTMLDivElement).getByText("10")).toBeInTheDocument();
    expect(within(codexCard as HTMLDivElement).getByText("10")).toBeInTheDocument();
  });

  it("shows loading state while the live billing summary is pending", () => {
    mockBillingQuery({
      data: undefined,
      isLoading: true,
      isPending: true,
    });

    renderWithProviders(<BillingPage />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Loading live billing summary...")).toBeInTheDocument();
  });

  it("shows degraded error state when the live billing summary fails", () => {
    mockBillingQuery({
      data: undefined,
      isError: true,
      error: new Error("Medusa billing summary is unavailable"),
    });

    renderWithProviders(<BillingPage />);

    expect(screen.getByText("Live billing summary unavailable")).toBeInTheDocument();
    expect(screen.getByText("Medusa billing summary is unavailable")).toBeInTheDocument();
    expect(screen.queryByText("edixai.com")).not.toBeInTheDocument();
  });

  it("opens the account members dialog from the live summary table", async () => {
    const user = userEvent.setup();
    mockBillingQuery();

    renderWithProviders(<BillingPage />);

    await user.click(screen.getByRole("button", { name: "Watch edixai.com accounts list" }));

    const dialog = await screen.findByRole("dialog", { name: "edixai.com · Accounts list" });
    expect(within(dialog).getByText(/Business/)).toBeInTheDocument();
    expect(within(dialog).getByText("Owner")).toBeInTheDocument();
    expect(within(dialog).getByText("ChatGPT")).toBeInTheDocument();
    expect(within(dialog).getByText("Mar 23, 2026")).toBeInTheDocument();
    expect(within(dialog).getByText("admin@edixai.com")).toBeInTheDocument();
  });

  it("submits the add subscription account dialog", async () => {
    const user = userEvent.setup();
    const { mutateAsync } = mockBillingQuery();

    renderWithProviders(<BillingPage />);

    await user.click(screen.getByRole("button", { name: "Add subscription account" }));

    const dialog = await screen.findByRole("dialog", { name: "Add subscription account" });
    await user.type(within(dialog).getByLabelText("Business domain"), "newshop.example");
    await user.click(within(dialog).getByRole("button", { name: "Add account" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      domain: "newshop.example",
      planCode: "business",
      planName: "Business",
    });
  });
});
