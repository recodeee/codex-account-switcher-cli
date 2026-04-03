import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccountCards } from "@/features/dashboard/components/account-cards";
import { createAccountSummary } from "@/test/mocks/factories";
import type { UsageWindow } from "@/features/dashboard/schemas";

function buildWindow(
  windowKey: "primary" | "secondary",
  accountId: string,
  capacity: number,
  remaining: number,
  remainingPercentAvg: number | null = 50,
): UsageWindow {
  return {
    windowKey,
    windowMinutes: windowKey === "primary" ? 300 : 10080,
    accounts: [
      {
        accountId,
        remainingPercentAvg,
        capacityCredits: capacity,
        remainingCredits: remaining,
      },
    ],
  };
}

describe("AccountCards", () => {
  it("renders working accounts in a dedicated top section before other accounts", () => {
    const idle = createAccountSummary({
      accountId: "acc_idle",
      email: "idle@example.com",
      displayName: "idle@example.com",
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "idle",
        activeSnapshotName: "working",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
    });
    const working = createAccountSummary({
      accountId: "acc_working",
      email: "working@example.com",
      displayName: "working@example.com",
      codexSessionCount: 2,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "working",
        activeSnapshotName: "working",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
    });

    const { container } = render(
      <AccountCards
        accounts={[idle, working]}
        primaryWindow={buildWindow("primary", "acc_working", 1000, 900)}
        secondaryWindow={null}
      />,
    );

    expect(screen.getByRole("heading", { name: "Working now" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Other accounts" })).toBeInTheDocument();
    expect(
      screen.getByText("Live accounts are grouped first so you can switch faster."),
    ).toBeInTheDocument();
    expect(screen.getByText("2 live sessions")).toBeInTheDocument();
    expect(screen.getByText(/5h avg \d+%/i)).toBeInTheDocument();
    expect(screen.getByText(/weekly avg \d+%/i)).toBeInTheDocument();

    const cards = Array.from(container.querySelectorAll(".card-hover"));
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText("working@example.com")).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText("idle@example.com")).toBeInTheDocument();
  });

  it("uses primary window consumption for regular-account tokens used", () => {
    const account = createAccountSummary({
      accountId: "acc_regular",
      email: "regular@example.com",
      displayName: "regular@example.com",
      requestUsage: {
        requestCount: 0,
        totalTokens: 11,
        cachedInputTokens: 0,
        totalCostUsd: 0,
      },
      windowMinutesPrimary: 300,
      windowMinutesSecondary: 10080,
    });

    render(
      <AccountCards
        accounts={[account]}
        primaryWindow={buildWindow("primary", "acc_regular", 1000, 900)}
        secondaryWindow={null}
      />,
    );

    const card = screen.getByText("regular@example.com").closest(".card-hover");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText("100k")).toBeInTheDocument();
  });

  it("uses secondary window consumption for weekly-only-account tokens used", () => {
    const account = createAccountSummary({
      accountId: "acc_weekly",
      email: "weekly@example.com",
      displayName: "weekly@example.com",
      requestUsage: {
        requestCount: 0,
        totalTokens: 77,
        cachedInputTokens: 0,
        totalCostUsd: 0,
      },
      windowMinutesPrimary: null,
      windowMinutesSecondary: 10080,
    });

    render(
      <AccountCards
        accounts={[account]}
        primaryWindow={null}
        secondaryWindow={buildWindow("secondary", "acc_weekly", 2000, 500)}
      />,
    );

    const card = screen.getByText("weekly@example.com").closest(".card-hover");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText("1,500k")).toBeInTheDocument();
  });

  it("renders deactivated accounts after active accounts", () => {
    const activeOne = createAccountSummary({
      accountId: "acc_active_1",
      email: "active-1@example.com",
      displayName: "active-1@example.com",
      status: "active",
    });
    const activeTwo = createAccountSummary({
      accountId: "acc_active_2",
      email: "active-2@example.com",
      displayName: "active-2@example.com",
      status: "active",
    });
    const deactivated = createAccountSummary({
      accountId: "acc_deactivated",
      email: "deactivated@example.com",
      displayName: "deactivated@example.com",
      status: "deactivated",
      codexAuth: {
        hasSnapshot: false,
        snapshotName: null,
        activeSnapshotName: null,
        isActiveSnapshot: false,
      },
    });

    const { container } = render(
      <AccountCards accounts={[activeOne, deactivated, activeTwo]} primaryWindow={null} secondaryWindow={null} />,
    );

    const cards = Array.from(container.querySelectorAll(".card-hover"));
    const titles = cards.map((card) => card.querySelector("p.truncate.text-sm.font-semibold.leading-tight")?.textContent);
    expect(titles).toEqual(["active-1@example.com", "active-2@example.com", "deactivated@example.com"]);
  });

  it("falls back to request-usage tokens when window row is unknown", () => {
    const account = createAccountSummary({
      accountId: "acc_unknown",
      email: "unknown@example.com",
      displayName: "unknown@example.com",
      requestUsage: {
        requestCount: 0,
        totalTokens: 777,
        cachedInputTokens: 0,
        totalCostUsd: 0,
      },
      windowMinutesPrimary: 300,
      windowMinutesSecondary: 10080,
    });

    render(
      <AccountCards
        accounts={[account]}
        primaryWindow={buildWindow("primary", "acc_unknown", 1000, 0, null)}
        secondaryWindow={null}
      />,
    );

    const card = screen.getByText("unknown@example.com").closest(".card-hover");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText("777k")).toBeInTheDocument();
  });
});
