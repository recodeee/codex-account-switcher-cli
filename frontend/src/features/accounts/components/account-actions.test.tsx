import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AccountActions } from "@/features/accounts/components/account-actions";
import { createAccountSummary } from "@/test/mocks/factories";

function renderAccountActions(accountOverrides: Parameters<typeof createAccountSummary>[0] = {}) {
  const account = createAccountSummary(accountOverrides);
  render(
    <AccountActions
      account={account}
      busy={false}
      useLocalBusy={false}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onDelete={vi.fn()}
      onUseLocal={vi.fn()}
      onRepairSnapshot={vi.fn()}
      onReauth={vi.fn()}
    />,
  );
}

describe("AccountActions", () => {
  it("enables Use this when account is active with 5h quota even without snapshot", () => {
    renderAccountActions({
      status: "active",
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

    expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
  });

  it("treats deactivated accounts with active snapshots as active", () => {
    renderAccountActions({
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

    expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Re-authenticate" })).not.toBeInTheDocument();
  });

  it("treats deactivated accounts with live sessions as active", () => {
    renderAccountActions({
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

    expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Re-authenticate" })).not.toBeInTheDocument();
  });

  it("treats deactivated accounts with fresh CLI debug samples as active", () => {
    renderAccountActions({
      status: "deactivated",
      usage: {
        primaryRemainingPercent: 44,
        secondaryRemainingPercent: 73,
      },
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

    expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Re-authenticate" })).not.toBeInTheDocument();
  });

  it("disables Use this when 5h quota is unavailable", () => {
    renderAccountActions({
      status: "active",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 73,
      },
    });

    expect(screen.getByRole("button", { name: "Use this" })).toBeDisabled();
  });

  it("enables Use this for working-now accounts even when 5h quota is unavailable", () => {
    renderAccountActions({
      status: "paused",
      usage: {
        primaryRemainingPercent: 0,
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

    expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
  });

  it("shows snapshot repair actions when snapshot name differs from expected email snapshot", async () => {
    const user = userEvent.setup({ delay: null });
    const onRepairSnapshot = vi.fn();
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "work",
        activeSnapshotName: "work",
        isActiveSnapshot: true,
        expectedSnapshotName: "nagyviktordp-edixai-com",
        snapshotNameMatchesEmail: false,
      },
    });

    render(
      <AccountActions
        account={account}
        busy={false}
        useLocalBusy={false}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onDelete={vi.fn()}
        onUseLocal={vi.fn()}
        onRepairSnapshot={onRepairSnapshot}
        onReauth={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Re-add snapshot" }));
    await user.click(screen.getByRole("button", { name: "Rename snapshot" }));

    expect(onRepairSnapshot).toHaveBeenNthCalledWith(1, account.accountId, "readd");
    expect(onRepairSnapshot).toHaveBeenNthCalledWith(2, account.accountId, "rename");
  });

  it("tries re-auth against the selected account id", async () => {
    const user = userEvent.setup({ delay: null });
    const onReauth = vi.fn();
    const account = createAccountSummary({
      accountId: "acc_reauth_action",
      status: "deactivated",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "acc_reauth_action",
        activeSnapshotName: "different-snapshot",
        isActiveSnapshot: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });

    render(
      <AccountActions
        account={account}
        busy={false}
        useLocalBusy={false}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onDelete={vi.fn()}
        onUseLocal={vi.fn()}
        onRepairSnapshot={vi.fn()}
        onReauth={onReauth}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Re-authenticate" }));

    expect(onReauth).toHaveBeenCalledWith("acc_reauth_action");
  });

  it("does not show re-auth for deactivated snapshot accounts with recent usage", () => {
    renderAccountActions({
      status: "deactivated",
      usage: {
        primaryRemainingPercent: 44,
        secondaryRemainingPercent: 73,
      },
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "webubusiness",
        activeSnapshotName: "different",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: new Date().toISOString(),
      lastUsageRecordedAtSecondary: new Date().toISOString(),
    });

    expect(screen.getByRole("button", { name: "Use this" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Re-authenticate" })).not.toBeInTheDocument();
  });
});
