import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountListItem } from "@/features/accounts/components/account-list-item";
import { createAccountSummary } from "@/test/mocks/factories";

describe("AccountListItem", () => {
  it("renders neutral quota track when weekly remaining percent is unknown", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 82,
        secondaryRemainingPercent: null,
      },
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByTestId("mini-quota-weekly-track")).toHaveClass("bg-muted");
    expect(screen.queryByTestId("mini-quota-weekly-fill")).not.toBeInTheDocument();
  });

  it("renders quota fill when weekly remaining percent is available", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 82,
        secondaryRemainingPercent: 73,
      },
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByTestId("mini-quota-weekly-fill")).toHaveStyle({ width: "73%" });
  });

  it("ignores deferred mixed-session merged weekly percent in sidebar row when override was not applied", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 24,
        secondaryRemainingPercent: 0,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["viktor"],
        overrideApplied: false,
        overrideReason: "deferred_active_snapshot_mixed_default_sessions",
        merged: {
          source: "merged",
          snapshotName: "viktor",
          recordedAt: "2026-01-01T00:00:00.000Z",
          stale: false,
          primary: {
            usedPercent: 76,
            remainingPercent: 24,
            resetAt: 1760000000,
            windowMinutes: 300,
          },
          secondary: {
            usedPercent: 34,
            remainingPercent: 66,
            resetAt: 1760600000,
            windowMinutes: 10080,
          },
        },
        rawSamples: [],
      },
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByTestId("mini-quota-weekly-fill")).toHaveStyle({ width: "0%" });
  });

  it("renders 5h quota row above weekly row", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 44,
        secondaryRemainingPercent: 73,
      },
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    const fiveHourLabel = screen.getByText("5h");
    const weeklyLabel = screen.getByText("Weekly");
    expect(fiveHourLabel.compareDocumentPosition(weeklyLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("disables use button when 5h quota is unavailable", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 73,
      },
      resetAtPrimary: "2030-01-01T00:00:00.000Z",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
      },
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Use this" })).toBeDisabled();
  });

  it("keeps reported 5h quota when reset time has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    try {
      const account = createAccountSummary({
        usage: {
          primaryRemainingPercent: 2,
          secondaryRemainingPercent: 73,
        },
        resetAtPrimary: "2025-12-31T23:00:00.000Z",
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "main",
          activeSnapshotName: "main",
          isActiveSnapshot: true,
        },
      });

      render(
        <AccountListItem
          account={account}
          selected={false}
          onSelect={vi.fn()}
          onUseLocal={vi.fn()}
          useLocalBusy={false}
        />,
      );

      expect(screen.getByTestId("mini-quota-5h-fill")).toHaveStyle({ width: "2%" });
      expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("enables use button when quota and snapshot are available", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 44,
        secondaryRemainingPercent: 73,
      },
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
      },
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
  });

  it("enables use button when snapshot is unavailable but account is active with quota", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 44,
        secondaryRemainingPercent: 73,
      },
      codexAuth: {
        hasSnapshot: false,
        snapshotName: null,
        activeSnapshotName: null,
        isActiveSnapshot: false,
      },
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
  });

  it("enables use button for working-now accounts even when 5h quota is depleted", () => {
    const account = createAccountSummary({
      status: "paused",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 73,
      },
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "different",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
  });

  it("shows plan type with snapshot name in subtitle", () => {
    const account = createAccountSummary({
      planType: "team",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "deadpool",
        activeSnapshotName: "deadpool",
        isActiveSnapshot: true,
      },
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByText("Team · deadpool")).toBeInTheDocument();
  });

  it("shows no snapshot in subtitle when missing", () => {
    const account = createAccountSummary({
      planType: "team",
      codexAuth: {
        hasSnapshot: false,
        snapshotName: null,
        activeSnapshotName: null,
        isActiveSnapshot: false,
      },
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByText("Team · No snapshot")).toBeInTheDocument();
    expect(screen.getByTestId("missing-snapshot-badge")).toHaveTextContent("No snapshot");
  });

  it("does not show missing snapshot badge when snapshot is mapped", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "deadpool",
        activeSnapshotName: "deadpool",
        isActiveSnapshot: true,
      },
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.queryByTestId("missing-snapshot-badge")).not.toBeInTheDocument();
  });

  it("keeps deactivated status visible in list rows even with active snapshots", () => {
    const account = createAccountSummary({
      status: "deactivated",
      usage: {
        primaryRemainingPercent: 44,
        secondaryRemainingPercent: 73,
      },
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "deadpool",
        activeSnapshotName: "deadpool",
        isActiveSnapshot: true,
      },
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("keeps deactivated status visible in list rows with live sessions", () => {
    const account = createAccountSummary({
      status: "deactivated",
      usage: {
        primaryRemainingPercent: 44,
        secondaryRemainingPercent: 73,
      },
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("keeps deactivated status visible in list rows with local snapshots", () => {
    const account = createAccountSummary({
      status: "deactivated",
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "webubusiness",
        activeSnapshotName: null,
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: null,
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("keeps deactivated status visible in list rows with fresh CLI debug samples", () => {
    const account = createAccountSummary({
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
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("shows live badge and live background when account is working now", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      codexSessionCount: 0,
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.getByTestId("live-status-badge")).toHaveTextContent("Live");
    expect(screen.getByTestId("account-list-item").className).toContain("bg-cyan");
  });

  it("hides live badge when account is not working now", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      codexSessionCount: 0,
    });

    render(
      <AccountListItem
        account={account}
        selected={false}
        onSelect={vi.fn()}
        onUseLocal={vi.fn()}
        useLocalBusy={false}
      />,
    );

    expect(screen.queryByTestId("live-status-badge")).not.toBeInTheDocument();
  });
});
