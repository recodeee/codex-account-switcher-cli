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

  it("does not keep accounts in working-now when primary rounds to 0%", () => {
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

    expect(screen.queryByText("Working now")).not.toBeInTheDocument();
    expect(screen.queryByText("5h avg 0%")).not.toBeInTheDocument();
    expect(screen.queryByText("Weekly avg 88%")).not.toBeInTheDocument();
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
    expect(within(card as HTMLElement).getByText("1.5m")).toBeInTheDocument();
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

  it("does not place accounts with only fresh debug samples in the working-now section", () => {
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
