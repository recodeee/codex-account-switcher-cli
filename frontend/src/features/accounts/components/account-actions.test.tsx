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
});
