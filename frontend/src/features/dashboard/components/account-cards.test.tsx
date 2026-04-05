import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountCards } from "@/features/dashboard/components/account-cards";
import { createAccountSummary } from "@/test/mocks/factories";
import type { UsageWindow } from "@/features/dashboard/schemas";

function buildWindow(
  windowKey: "primary" | "secondary",
  accountId: string,
  capacity: number,
  remaining: number,
  remainingPercentAvg: number | null = 50,
  windowMinutes?: number,
): UsageWindow {
  return {
    windowKey,
    windowMinutes: windowMinutes ?? (windowKey === "primary" ? 300 : 10080),
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
    const nowIso = new Date().toISOString();
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
      codexLiveSessionCount: 2,
      codexSessionCount: 2,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "working",
        activeSnapshotName: "working",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
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
      screen.getByText("Accounts with active CLI sessions are grouped first so you can switch faster."),
    ).toBeInTheDocument();
    expect(screen.getByText("2 live sessions")).toBeInTheDocument();
    expect(screen.getByText(/5h avg \d+%/i)).toBeInTheDocument();
    expect(screen.getByText(/weekly avg \d+%/i)).toBeInTheDocument();

    const cards = Array.from(container.querySelectorAll(".card-hover"));
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText("working@example.com")).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText("idle@example.com")).toBeInTheDocument();
  });

  it("uses primary window remaining for regular-account token balance", () => {
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
    expect(within(card as HTMLElement).getByText("900k")).toBeInTheDocument();
  });

  it("uses the primary window duration label in working summary chips", () => {
    const nowIso = new Date().toISOString();
    const working = createAccountSummary({
      accountId: "acc_working",
      email: "working@example.com",
      displayName: "working@example.com",
      codexLiveSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "working",
        activeSnapshotName: "working",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(
      <AccountCards
        accounts={[working]}
        primaryWindow={buildWindow("primary", "acc_working", 1000, 900, 50, 480)}
        secondaryWindow={null}
      />,
    );

    expect(screen.getByText(/8h avg \d+%/i)).toBeInTheDocument();
    expect(screen.queryByText(/5h avg \d+%/i)).not.toBeInTheDocument();
  });

  it("keeps accounts in working-now when primary rounds to 0% but sessions are active", () => {
    const nowIso = new Date().toISOString();
    const working = createAccountSummary({
      accountId: "acc_reset",
      email: "reset@example.com",
      displayName: "reset@example.com",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      resetAtPrimary: new Date(Date.now() - 60_000).toISOString(),
      codexLiveSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "reset",
        activeSnapshotName: "reset",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(
      <AccountCards
        accounts={[working]}
        primaryWindow={buildWindow("primary", "acc_reset", 1000, 0)}
        secondaryWindow={buildWindow("secondary", "acc_reset", 1000, 880)}
      />,
    );

    expect(screen.getByRole("heading", { name: "Working now" })).toBeInTheDocument();
    expect(screen.getByText("reset@example.com")).toBeInTheDocument();
  });

  it("keeps usage-limit-hit accounts in working-now after 1 minute when sessions are still active", () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-04T21:04:00.000Z");
    vi.setSystemTime(now);
    const working = createAccountSummary({
      accountId: "acc_limit_hit",
      email: "limit-hit@example.com",
      displayName: "limit-hit@example.com",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 87,
      },
      codexLiveSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "korona",
        activeSnapshotName: "korona",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: now.toISOString(),
      lastUsageRecordedAtSecondary: now.toISOString(),
    });

    try {
      render(
        <AccountCards
          accounts={[working]}
          primaryWindow={buildWindow("primary", "acc_limit_hit", 1000, 0)}
          secondaryWindow={buildWindow("secondary", "acc_limit_hit", 1000, 870)}
        />,
      );

      expect(
        screen.getByRole("heading", { name: "Working now" }),
      ).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(61_000);
      });

      expect(
        screen.getByRole("heading", { name: "Working now" }),
      ).toBeInTheDocument();
      expect(screen.getByText("limit-hit@example.com")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps depleted 5h accounts out of working-now when no sessions are active", () => {
    const depletedIdle = createAccountSummary({
      accountId: "acc_depleted_idle",
      email: "depleted-idle@example.com",
      displayName: "depleted-idle@example.com",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      resetAtPrimary: new Date(Date.now() - 60_000).toISOString(),
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "depleted-idle",
        activeSnapshotName: "depleted-idle",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });

    render(
      <AccountCards
        accounts={[depletedIdle]}
        primaryWindow={buildWindow("primary", "acc_depleted_idle", 1000, 0)}
        secondaryWindow={buildWindow("secondary", "acc_depleted_idle", 1000, 880)}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Working now" })).not.toBeInTheDocument();
    expect(screen.getByText("depleted-idle@example.com")).toBeInTheDocument();
  });

  it("keeps no-live-telemetry accounts in working-now when snapshot still reports a live session", () => {
    const account = createAccountSummary({
      accountId: "acc_itrexsale",
      email: "itrexsale@example.com",
      displayName: "itrexsale@example.com",
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: "no cli sessions sampled",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "itrexsale",
        activeSnapshotName: "codexina",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["itrexsale"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-codexina.jsonl",
            snapshotName: "codexina",
            recordedAt: "2026-04-04T11:59:00.000Z",
            stale: false,
            primary: { usedPercent: 56, remainingPercent: 44, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 40, remainingPercent: 60, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });

    render(
      <AccountCards
        accounts={[account]}
        primaryWindow={buildWindow("primary", "acc_itrexsale", 1000, 440)}
        secondaryWindow={buildWindow("secondary", "acc_itrexsale", 1000, 600)}
      />,
    );

    expect(screen.getByRole("heading", { name: "Working now" })).toBeInTheDocument();
    expect(screen.getByText("itrexsale@example.com")).toBeInTheDocument();
  });

  it("uses secondary window remaining for weekly-only-account token balance", () => {
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
    expect(within(card as HTMLElement).getByText("500k")).toBeInTheDocument();
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

  it("orders accounts by available 5h quota, then weekly quota", () => {
    const medium = createAccountSummary({
      accountId: "acc_medium",
      email: "medium@example.com",
      displayName: "medium@example.com",
      usage: {
        primaryRemainingPercent: 65,
        secondaryRemainingPercent: 95,
      },
    });
    const highestWeeklyTieBreaker = createAccountSummary({
      accountId: "acc_high_weekly",
      email: "high-weekly@example.com",
      displayName: "high-weekly@example.com",
      usage: {
        primaryRemainingPercent: 80,
        secondaryRemainingPercent: 70,
      },
    });
    const highestPrimary = createAccountSummary({
      accountId: "acc_high_primary",
      email: "high-primary@example.com",
      displayName: "high-primary@example.com",
      usage: {
        primaryRemainingPercent: 80,
        secondaryRemainingPercent: 55,
      },
    });

    const { container } = render(
      <AccountCards
        accounts={[medium, highestPrimary, highestWeeklyTieBreaker]}
        primaryWindow={null}
        secondaryWindow={null}
      />,
    );

    const cards = Array.from(container.querySelectorAll(".card-hover"));
    const titles = cards.map((card) => card.querySelector("p.truncate.text-sm.font-semibold.leading-tight")?.textContent);
    expect(titles).toEqual([
      "high-weekly@example.com",
      "high-primary@example.com",
      "medium@example.com",
    ]);
  });

  it("places weekly-depleted accounts at the end even when 5h remaining is higher", () => {
    const healthyWeekly = createAccountSummary({
      accountId: "acc_weekly_ok",
      email: "weekly-ok@example.com",
      displayName: "weekly-ok@example.com",
      usage: {
        primaryRemainingPercent: 41,
        secondaryRemainingPercent: 44,
      },
    });
    const weeklyDepletedHigh5h = createAccountSummary({
      accountId: "acc_weekly_zero",
      email: "weekly-zero@example.com",
      displayName: "weekly-zero@example.com",
      usage: {
        primaryRemainingPercent: 92,
        secondaryRemainingPercent: 0,
      },
    });

    const { container } = render(
      <AccountCards
        accounts={[weeklyDepletedHigh5h, healthyWeekly]}
        primaryWindow={null}
        secondaryWindow={null}
      />,
    );

    const cards = Array.from(container.querySelectorAll(".card-hover"));
    const titles = cards.map((card) =>
      card.querySelector("p.truncate.text-sm.font-semibold.leading-tight")?.textContent,
    );
    expect(titles).toEqual([
      "weekly-ok@example.com",
      "weekly-zero@example.com",
    ]);
  });

  it("treats near-zero weekly quota as depleted when ordering cards", () => {
    const usageLimitHit = createAccountSummary({
      accountId: "acc_usage_limit_hit",
      email: "usage-limit-hit@example.com",
      displayName: "usage-limit-hit@example.com",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 80,
      },
    });
    const weeklyNearZero = createAccountSummary({
      accountId: "acc_weekly_near_zero",
      email: "weekly-near-zero@example.com",
      displayName: "weekly-near-zero@example.com",
      usage: {
        primaryRemainingPercent: 94,
        secondaryRemainingPercent: 4,
      },
      resetAtSecondary: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const { container } = render(
      <AccountCards
        accounts={[weeklyNearZero, usageLimitHit]}
        primaryWindow={null}
        secondaryWindow={null}
      />,
    );

    const cards = Array.from(container.querySelectorAll(".card-hover"));
    const titles = cards.map((card) =>
      card.querySelector("p.truncate.text-sm.font-semibold.leading-tight")?.textContent,
    );
    expect(titles).toEqual([
      "usage-limit-hit@example.com",
      "weekly-near-zero@example.com",
    ]);
  });

  it("keeps weekly-depleted accounts at the end even when the weekly reset is sooner than 5h", () => {
    const now = Date.now();
    const healthyWeekly = createAccountSummary({
      accountId: "acc_weekly_ok_soon_reset",
      email: "weekly-ok-soon-reset@example.com",
      displayName: "weekly-ok-soon-reset@example.com",
      usage: {
        primaryRemainingPercent: 41,
        secondaryRemainingPercent: 44,
      },
    });
    const weeklyDepletedSoonerThan5h = createAccountSummary({
      accountId: "acc_weekly_zero_soon_reset",
      email: "weekly-zero-soon-reset@example.com",
      displayName: "weekly-zero-soon-reset@example.com",
      usage: {
        primaryRemainingPercent: 92,
        secondaryRemainingPercent: 0,
      },
      resetAtPrimary: new Date(now + 60 * 60 * 1000).toISOString(),
      resetAtSecondary: new Date(now + 30 * 60 * 1000).toISOString(),
    });

    const { container } = render(
      <AccountCards
        accounts={[healthyWeekly, weeklyDepletedSoonerThan5h]}
        primaryWindow={null}
        secondaryWindow={null}
      />,
    );

    const cards = Array.from(container.querySelectorAll(".card-hover"));
    const titles = cards.map((card) =>
      card.querySelector("p.truncate.text-sm.font-semibold.leading-tight")?.textContent,
    );
    expect(titles).toEqual([
      "weekly-ok-soon-reset@example.com",
      "weekly-zero-soon-reset@example.com",
    ]);
  });

  it("orders weekly-depleted accounts by the nearest weekly reset time", () => {
    const now = Date.now();
    const weeklyOk = createAccountSummary({
      accountId: "acc_weekly_ok_2",
      email: "weekly-ok-2@example.com",
      displayName: "weekly-ok-2@example.com",
      usage: {
        primaryRemainingPercent: 34,
        secondaryRemainingPercent: 28,
      },
    });
    const weeklyDepletedSoonerReset = createAccountSummary({
      accountId: "acc_weekly_zero_soon",
      email: "weekly-zero-soon@example.com",
      displayName: "weekly-zero-soon@example.com",
      usage: {
        primaryRemainingPercent: 6,
        secondaryRemainingPercent: 0,
      },
      resetAtSecondary: new Date(now + 4 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000).toISOString(),
    });
    const weeklyDepletedLaterReset = createAccountSummary({
      accountId: "acc_weekly_zero_later",
      email: "weekly-zero-later@example.com",
      displayName: "weekly-zero-later@example.com",
      usage: {
        primaryRemainingPercent: 97,
        secondaryRemainingPercent: 0,
      },
      resetAtSecondary: new Date(now + 6 * 24 * 60 * 60 * 1000 + 1 * 60 * 60 * 1000).toISOString(),
    });

    const { container } = render(
      <AccountCards
        accounts={[weeklyDepletedLaterReset, weeklyOk, weeklyDepletedSoonerReset]}
        primaryWindow={null}
        secondaryWindow={null}
      />,
    );

    const cards = Array.from(container.querySelectorAll(".card-hover"));
    const titles = cards.map((card) =>
      card.querySelector("p.truncate.text-sm.font-semibold.leading-tight")?.textContent,
    );
    expect(titles).toEqual([
      "weekly-ok-2@example.com",
      "weekly-zero-soon@example.com",
      "weekly-zero-later@example.com",
    ]);
  });

  it("keeps stale last-seen accounts after recently seen accounts even when stale usage is higher", () => {
    const now = Date.now();
    const recentHighest = createAccountSummary({
      accountId: "acc_recent_high",
      email: "recent-high@example.com",
      displayName: "recent-high@example.com",
      usage: {
        primaryRemainingPercent: 78,
        secondaryRemainingPercent: 42,
      },
      lastUsageRecordedAtPrimary: new Date(now - 5 * 60 * 1000).toISOString(),
      lastUsageRecordedAtSecondary: new Date(now - 8 * 60 * 1000).toISOString(),
    });
    const recentLower = createAccountSummary({
      accountId: "acc_recent_low",
      email: "recent-low@example.com",
      displayName: "recent-low@example.com",
      usage: {
        primaryRemainingPercent: 26,
        secondaryRemainingPercent: 90,
      },
      lastUsageRecordedAtPrimary: new Date(now - 12 * 60 * 1000).toISOString(),
      lastUsageRecordedAtSecondary: new Date(now - 18 * 60 * 1000).toISOString(),
    });
    const staleHighest = createAccountSummary({
      accountId: "acc_stale_high",
      email: "stale-high@example.com",
      displayName: "stale-high@example.com",
      usage: {
        primaryRemainingPercent: 99,
        secondaryRemainingPercent: 99,
      },
      lastUsageRecordedAtPrimary: new Date(now - 45 * 60 * 1000).toISOString(),
      lastUsageRecordedAtSecondary: new Date(now - 50 * 60 * 1000).toISOString(),
    });

    const { container } = render(
      <AccountCards
        accounts={[staleHighest, recentLower, recentHighest]}
        primaryWindow={null}
        secondaryWindow={null}
      />,
    );

    const cards = Array.from(container.querySelectorAll(".card-hover"));
    const titles = cards.map((card) =>
      card.querySelector("p.truncate.text-sm.font-semibold.leading-tight")?.textContent,
    );
    expect(titles).toEqual([
      "recent-high@example.com",
      "recent-low@example.com",
      "stale-high@example.com",
    ]);
  });

  it("keeps weekly-depleted accounts at the end even when they are more recently seen", () => {
    const now = Date.now();
    const weeklyDepletedRecent = createAccountSummary({
      accountId: "acc_weekly_depleted_recent",
      email: "weekly-depleted-recent@example.com",
      displayName: "weekly-depleted-recent@example.com",
      usage: {
        primaryRemainingPercent: 100,
        secondaryRemainingPercent: 0,
      },
      resetAtSecondary: new Date(now + 4 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000).toISOString(),
      lastUsageRecordedAtPrimary: new Date(now - 3 * 60 * 1000).toISOString(),
      lastUsageRecordedAtSecondary: new Date(now - 4 * 60 * 1000).toISOString(),
    });
    const weeklyAvailableStale = createAccountSummary({
      accountId: "acc_weekly_available_stale",
      email: "weekly-available-stale@example.com",
      displayName: "weekly-available-stale@example.com",
      usage: {
        primaryRemainingPercent: 22,
        secondaryRemainingPercent: 73,
      },
      lastUsageRecordedAtPrimary: new Date(now - 45 * 60 * 1000).toISOString(),
      lastUsageRecordedAtSecondary: new Date(now - 50 * 60 * 1000).toISOString(),
    });
    const weeklyDepletedLater = createAccountSummary({
      accountId: "acc_weekly_depleted_later",
      email: "weekly-depleted-later@example.com",
      displayName: "weekly-depleted-later@example.com",
      usage: {
        primaryRemainingPercent: 5,
        secondaryRemainingPercent: 0,
      },
      resetAtSecondary: new Date(now + 6 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
      lastUsageRecordedAtPrimary: new Date(now - 6 * 60 * 1000).toISOString(),
      lastUsageRecordedAtSecondary: new Date(now - 6 * 60 * 1000).toISOString(),
    });

    const { container } = render(
      <AccountCards
        accounts={[weeklyDepletedRecent, weeklyAvailableStale, weeklyDepletedLater]}
        primaryWindow={null}
        secondaryWindow={null}
      />,
    );

    const cards = Array.from(container.querySelectorAll(".card-hover"));
    const titles = cards.map((card) =>
      card.querySelector("p.truncate.text-sm.font-semibold.leading-tight")?.textContent,
    );
    expect(titles).toEqual([
      "weekly-available-stale@example.com",
      "weekly-depleted-recent@example.com",
      "weekly-depleted-later@example.com",
    ]);
  });

  it("prioritizes non-zero 5h remaining accounts above zero-percent accounts", () => {
    const zeroA = createAccountSummary({
      accountId: "acc_zero_a",
      email: "zero-a@example.com",
      displayName: "zero-a@example.com",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
    });
    const nonZero = createAccountSummary({
      accountId: "acc_non_zero",
      email: "non-zero@example.com",
      displayName: "non-zero@example.com",
      usage: {
        primaryRemainingPercent: 7,
        secondaryRemainingPercent: 68,
      },
    });
    const zeroB = createAccountSummary({
      accountId: "acc_zero_b",
      email: "zero-b@example.com",
      displayName: "zero-b@example.com",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 38,
      },
    });

    const { container } = render(
      <AccountCards
        accounts={[zeroA, nonZero, zeroB]}
        primaryWindow={null}
        secondaryWindow={null}
      />,
    );

    const cards = Array.from(container.querySelectorAll(".card-hover"));
    const titles = cards.map((card) => card.querySelector("p.truncate.text-sm.font-semibold.leading-tight")?.textContent);
    expect(titles[0]).toBe("non-zero@example.com");
  });

  it("orders depleted 5h accounts by the nearest primary reset time", () => {
    const now = Date.now();
    const resetsSoon = createAccountSummary({
      accountId: "acc_reset_soon",
      email: "reset-soon@example.com",
      displayName: "reset-soon@example.com",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 63,
      },
      resetAtPrimary: new Date(now + 26 * 60 * 1000).toISOString(),
    });
    const resetsLater = createAccountSummary({
      accountId: "acc_reset_later",
      email: "reset-later@example.com",
      displayName: "reset-later@example.com",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      resetAtPrimary: new Date(now + 60 * 60 * 1000).toISOString(),
    });

    const { container } = render(
      <AccountCards
        accounts={[resetsLater, resetsSoon]}
        primaryWindow={null}
        secondaryWindow={null}
      />,
    );

    const cards = Array.from(container.querySelectorAll(".card-hover"));
    const titles = cards.map((card) => card.querySelector("p.truncate.text-sm.font-semibold.leading-tight")?.textContent);
    expect(titles).toEqual(["reset-soon@example.com", "reset-later@example.com"]);
  });

  it("places deactivated accounts in the working-now section when live telemetry is present", () => {
    const nowIso = new Date().toISOString();
    const deactivatedLive = createAccountSummary({
      accountId: "acc_deactivated_live",
      email: "deactivated-live@example.com",
      displayName: "deactivated-live@example.com",
      status: "deactivated",
      codexLiveSessionCount: 2,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "deactivated-live",
        activeSnapshotName: "deactivated-live",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(
      <AccountCards
        accounts={[deactivatedLive]}
        primaryWindow={null}
        secondaryWindow={null}
      />,
    );

    expect(screen.getByRole("heading", { name: "Working now" })).toBeInTheDocument();
    expect(screen.getByText("deactivated-live@example.com")).toBeInTheDocument();
    expect(screen.getByText("2 live sessions")).toBeInTheDocument();
  });

  it("places tracked-session accounts in the working-now section", () => {
    const tracked = createAccountSummary({
      accountId: "acc_tracked",
      email: "tracked@example.com",
      displayName: "tracked@example.com",
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 3,
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "tracked",
        activeSnapshotName: "other",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });
    const idle = createAccountSummary({
      accountId: "acc_idle_2",
      email: "idle-2@example.com",
      displayName: "idle-2@example.com",
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "idle-2",
        activeSnapshotName: "other",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });

    render(<AccountCards accounts={[idle, tracked]} primaryWindow={null} secondaryWindow={null} />);

    expect(screen.getByRole("heading", { name: "Working now" })).toBeInTheDocument();
    expect(screen.getByText("tracked@example.com")).toBeInTheDocument();
    expect(screen.queryByText("live sessions")).not.toBeInTheDocument();
  });

  it("keeps deferred mixed-session debug-only accounts out of working-now", () => {
    const sampled = createAccountSummary({
      accountId: "acc_sampled",
      email: "sampled@example.com",
      displayName: "sampled@example.com",
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "viktor",
        activeSnapshotName: "viktor",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["viktor"],
        overrideApplied: false,
        overrideReason: "deferred_active_snapshot_mixed_default_sessions",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-a.jsonl",
            snapshotName: "viktor",
            recordedAt: new Date().toISOString(),
            stale: false,
            primary: { usedPercent: 56, remainingPercent: 44, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 32, remainingPercent: 68, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });
    const idle = createAccountSummary({
      accountId: "acc_idle_3",
      email: "idle-3@example.com",
      displayName: "idle-3@example.com",
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "idle-3",
        activeSnapshotName: "other",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });

    render(<AccountCards accounts={[idle, sampled]} primaryWindow={null} secondaryWindow={null} />);

    expect(screen.queryByRole("heading", { name: "Working now" })).not.toBeInTheDocument();
    expect(screen.getByText("sampled@example.com")).toBeInTheDocument();
  });

  it("shows deferred mixed-session accounts in working-now when task preview is present", () => {
    const sampled = createAccountSummary({
      accountId: "acc_sampled_preview",
      email: "sampled-preview@example.com",
      displayName: "sampled-preview@example.com",
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: "Investigate runtime session start for edixai account",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "viktor",
        activeSnapshotName: "viktor",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["viktor"],
        overrideApplied: false,
        overrideReason: "deferred_active_snapshot_mixed_default_sessions",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-a.jsonl",
            snapshotName: "viktor",
            recordedAt: new Date().toISOString(),
            stale: false,
            primary: { usedPercent: 56, remainingPercent: 44, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 32, remainingPercent: 68, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });

    render(<AccountCards accounts={[sampled]} primaryWindow={null} secondaryWindow={null} />);

    expect(screen.getByRole("heading", { name: "Working now" })).toBeInTheDocument();
    expect(screen.getByText("sampled-preview@example.com")).toBeInTheDocument();
  });

  it("keeps disconnected accounts with debug-only telemetry out of working-now", () => {
    const disconnected = createAccountSummary({
      accountId: "acc_disconnected_debug",
      email: "disconnected-debug@example.com",
      displayName: "disconnected-debug@example.com",
      status: "deactivated",
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "tokio",
        activeSnapshotName: "webubusiness",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["tokio"],
        overrideApplied: false,
        overrideReason: "deferred_active_snapshot_mixed_default_sessions",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/runtime-rollout.jsonl",
            snapshotName: "tokio",
            recordedAt: new Date().toISOString(),
            stale: false,
            primary: {
              usedPercent: 73,
              remainingPercent: 27,
              resetAt: 1760000100,
              windowMinutes: 300,
            },
            secondary: {
              usedPercent: 51,
              remainingPercent: 49,
              resetAt: 1760600100,
              windowMinutes: 10080,
            },
          },
        ],
      },
    });

    render(
      <AccountCards accounts={[disconnected]} primaryWindow={null} secondaryWindow={null} />,
    );

    expect(screen.queryByRole("heading", { name: "Working now" })).not.toBeInTheDocument();
    expect(
      screen.getByText("disconnected-debug@example.com"),
    ).toBeInTheDocument();
  });

  it("shows unknown token remaining when window row is unknown", () => {
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
    expect(within(card as HTMLElement).getByText("--")).toBeInTheDocument();
  });
});
