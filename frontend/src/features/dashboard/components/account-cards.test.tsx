import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccountCards } from "@/features/dashboard/components/account-cards";
import { createAccountSummary } from "@/test/mocks/factories";
import type { UsageWindow } from "@/features/dashboard/schemas";

function buildWindow(windowKey: "primary" | "secondary", accountId: string, capacity: number, remaining: number): UsageWindow {
  return {
    windowKey,
    windowMinutes: windowKey === "primary" ? 300 : 10080,
    accounts: [
      {
        accountId,
        remainingPercentAvg: null,
        capacityCredits: capacity,
        remainingCredits: remaining,
      },
    ],
  };
}

describe("AccountCards", () => {
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
});
