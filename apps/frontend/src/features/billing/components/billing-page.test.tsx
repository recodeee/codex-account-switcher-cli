import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingAccountsResponse } from "@/features/billing/schemas";
import type { DashboardOverview } from "@/features/dashboard/schemas";
import { useBilling } from "@/features/billing/hooks/use-billing";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { renderWithProviders } from "@/test/utils";

import { BillingPage } from "./billing-page";

vi.mock("@/features/billing/hooks/use-billing", () => ({
  useBilling: vi.fn(),
}));

vi.mock("@/features/dashboard/hooks/use-dashboard", () => ({
  useDashboard: vi.fn(),
}));

const useBillingMock = vi.mocked(useBilling);
const useDashboardMock = vi.mocked(useDashboard);

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

const dashboardOverview: DashboardOverview = {
  lastSyncAt: "2026-04-08T10:00:00.000Z",
  accounts: [
    {
      accountId: "acc-edixai-owner",
      email: "admin@edixai.com",
      displayName: "Edix.ai (You)",
      planType: "team",
      status: "active",
      usage: null,
      auth: null,
      codexAuth: { hasSnapshot: true },
      additionalQuotas: [],
    },
    {
      accountId: "acc-edixai-helper",
      email: "helper@edixai.com",
      displayName: "Edix.ai Helper",
      planType: "team",
      status: "active",
      usage: null,
      auth: null,
      codexAuth: { hasSnapshot: true },
      additionalQuotas: [],
    },
    {
      accountId: "acc-gmail-fallback",
      email: "personal@gmail.com",
      displayName: "Personal Gmail",
      planType: "team",
      status: "active",
      usage: null,
      auth: null,
      codexAuth: { hasSnapshot: true },
      additionalQuotas: [],
    },
    {
      accountId: "acc-kozpont-owner",
      email: "admin@kozpontihusbolt.hu",
      displayName: "Kozpont Admin",
      planType: "team",
      status: "active",
      usage: null,
      auth: null,
      codexAuth: { hasSnapshot: true },
      additionalQuotas: [],
    },
  ],
  summary: {
    primaryWindow: {
      remainingPercent: 100,
      capacityCredits: 100,
      remainingCredits: 100,
      resetAt: null,
      windowMinutes: null,
    },
    secondaryWindow: null,
    cost: {
      currency: "EUR",
      totalUsd7d: 0,
    },
    metrics: null,
  },
  windows: {
    primary: {
      windowKey: "primary",
      windowMinutes: null,
      accounts: [],
    },
    secondary: null,
  },
  trends: {
    requests: [],
    tokens: [],
    cost: [],
    errorRate: [],
  },
  additionalQuotas: [],
};

function mockDashboardQuery(data: DashboardOverview = dashboardOverview) {
  useDashboardMock.mockReturnValue({
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
  } as never);
}

function mockBillingQuery(
  overrides?: Record<string, unknown>,
  createMutationOverrides?: Record<string, unknown>,
  updateMutationOverrides?: Record<string, unknown>,
  deleteMutationOverrides?: Record<string, unknown>,
) {
  mockDashboardQuery();

  const mutateAsync = vi.fn().mockResolvedValue(undefined);
  const updateMutateAsync = vi.fn().mockResolvedValue(undefined);
  const deleteMutateAsync = vi.fn().mockResolvedValue(undefined);
  useBillingMock.mockReturnValue({
    billingQuery: {
      data: billingSummary,
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      ...overrides,
    },
    updateAccountsMutation: {
      mutateAsync: updateMutateAsync,
      isPending: false,
      error: null,
      ...updateMutationOverrides,
    },
    createAccountMutation: {
      mutateAsync,
      isPending: false,
      error: null,
      ...createMutationOverrides,
    },
    deleteAccountMutation: {
      mutateAsync: deleteMutateAsync,
      isPending: false,
      error: null,
      ...deleteMutationOverrides,
    },
  } as never);

  return {
    mutateAsync,
    updateMutateAsync,
    deleteMutateAsync,
  };
}

describe("BillingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDashboardQuery();
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
    const monthlySpendCard = screen.getByText("Monthly spend").closest("div");

    expect(accountsCard).not.toBeNull();
    expect(entitledCard).not.toBeNull();
    expect(chatgptCard).not.toBeNull();
    expect(codexCard).not.toBeNull();
    expect(monthlySpendCard).not.toBeNull();

    expect(within(accountsCard as HTMLDivElement).getByText("2")).toBeInTheDocument();
    expect(within(entitledCard as HTMLDivElement).getByText("1 of 2")).toBeInTheDocument();
    expect(within(chatgptCard as HTMLDivElement).getByText("10")).toBeInTheDocument();
    expect(within(codexCard as HTMLDivElement).getByText("10")).toBeInTheDocument();
    expect(within(monthlySpendCard as HTMLDivElement).getByText("€260.00")).toBeInTheDocument();
    expect(
      within(monthlySpendCard as HTMLDivElement).getByText("10 ChatGPT × €26 · 10 Codex × €0"),
    ).toBeInTheDocument();
  });

  it("does not duplicate plan label when plan name and code are the same", () => {
    mockBillingQuery();

    renderWithProviders(<BillingPage />);

    const row = screen.getByText("edixai.com").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLTableRowElement).getAllByText("Business")).toHaveLength(1);
    expect(within(row as HTMLTableRowElement).queryByText("BUSINESS")).not.toBeInTheDocument();
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
    expect(within(dialog).getAllByText("ChatGPT").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Mar 23, 2026")).toBeInTheDocument();
    expect(within(dialog).getByText("admin@edixai.com")).toBeInTheDocument();
  });

  it("groups dashboard accounts into billed business accounts by email domain and fallback assignment", async () => {
    const user = userEvent.setup();
    mockBillingQuery();

    renderWithProviders(<BillingPage />);

    await user.click(screen.getByRole("button", { name: "Watch edixai.com accounts list" }));

    const dialog = await screen.findByRole("dialog", { name: "edixai.com · Accounts list" });
    expect(within(dialog).getByText("helper@edixai.com")).toBeInTheDocument();
    expect(within(dialog).getByText("personal@gmail.com")).toBeInTheDocument();
    expect(within(dialog).queryByText("admin@kozpontihusbolt.hu")).not.toBeInTheDocument();
  });

  it("opens the edit dialog and submits updated seat settings", async () => {
    const user = userEvent.setup();
    const { updateMutateAsync } = mockBillingQuery();

    renderWithProviders(<BillingPage />);

    await user.click(screen.getByRole("button", { name: "Edit edixai.com subscription account" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit edixai.com" });
    await user.clear(within(dialog).getByLabelText("ChatGPT seats in use"));
    await user.type(within(dialog).getByLabelText("ChatGPT seats in use"), "7");
    await user.clear(within(dialog).getByLabelText("Codex seats in use"));
    await user.type(within(dialog).getByLabelText("Codex seats in use"), "3");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(updateMutateAsync).toHaveBeenCalledWith({
      accounts: [
        {
          ...billingSummary.accounts[0],
          chatgptSeatsInUse: 7,
          codexSeatsInUse: 3,
        },
        billingSummary.accounts[1],
      ],
    });
  });

  it("lets operators add and remove billed members from the account list dialog and saves recomputed seat totals", async () => {
    const user = userEvent.setup();
    const { updateMutateAsync } = mockBillingQuery();

    renderWithProviders(<BillingPage />);

    await user.click(screen.getByRole("button", { name: "Watch edixai.com accounts list" }));

    const dialog = await screen.findByRole("dialog", { name: "edixai.com · Accounts list" });
    await user.click(within(dialog).getByRole("button", { name: "Add account" }));
    await user.type(within(dialog).getByLabelText("Account name"), "New Billing User");
    await user.type(within(dialog).getByLabelText("Account email"), "new.user@edixai.com");
    await user.click(within(dialog).getByRole("button", { name: "Add member" }));

    await user.click(within(dialog).getByRole("button", { name: "Remove admin@edixai.com" }));
    await user.click(within(dialog).getByRole("button", { name: "Save account list" }));

    expect(updateMutateAsync).toHaveBeenCalledWith({
      accounts: [
        expect.objectContaining({
          id: "business-plan-edixai",
          chatgptSeatsInUse: 3,
          codexSeatsInUse: 0,
          members: expect.arrayContaining([
            expect.objectContaining({ email: "helper@edixai.com" }),
            expect.objectContaining({ email: "personal@gmail.com" }),
            expect.objectContaining({ email: "new.user@edixai.com" }),
          ]),
        }),
        billingSummary.accounts[1],
      ],
    });
  });

  it("shows currently active accounts in add-member form and quick-adds them", async () => {
    const user = userEvent.setup();
    const { updateMutateAsync } = mockBillingQuery();

    renderWithProviders(<BillingPage />);

    await user.click(screen.getByRole("button", { name: "Watch edixai.com accounts list" }));

    const dialog = await screen.findByRole("dialog", { name: "edixai.com · Accounts list" });
    await user.click(within(dialog).getByRole("button", { name: "Add account" }));

    expect(within(dialog).getByText("Current active accounts")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Add admin@kozpontihusbolt.hu" }));
    expect(within(dialog).getByText("admin@kozpontihusbolt.hu")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Save account list" }));

    expect(updateMutateAsync).toHaveBeenCalledWith({
      accounts: [
        expect.objectContaining({
          id: "business-plan-edixai",
          members: expect.arrayContaining([
            expect.objectContaining({ email: "admin@kozpontihusbolt.hu" }),
          ]),
        }),
        billingSummary.accounts[1],
      ],
    });
  });

  it("deletes a subscription account from the live summary table", async () => {
    const user = userEvent.setup();
    const { deleteMutateAsync } = mockBillingQuery();

    renderWithProviders(<BillingPage />);

    await user.click(screen.getByRole("button", { name: "Delete edixai.com subscription account" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete edixai.com?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));

    expect(deleteMutateAsync).toHaveBeenCalledWith({
      id: billingSummary.accounts[0].id,
    });
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

  it("keeps add subscription account available when no rows are present", async () => {
    const user = userEvent.setup();
    mockBillingQuery({
      data: {
        accounts: [],
      },
    });

    renderWithProviders(<BillingPage />);

    expect(screen.getByText("No billed accounts yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add subscription account" }));
    expect(await screen.findByRole("dialog", { name: "Add subscription account" })).toBeInTheDocument();
  });
});
