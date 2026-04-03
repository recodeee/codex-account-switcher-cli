import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AccountListItem } from "@/features/accounts/components/account-list-item";
import { createAccountSummary } from "@/test/mocks/factories";

describe("AccountListItem", () => {
  it("renders neutral quota track when secondary remaining percent is unknown", () => {
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

    expect(screen.getByTestId("mini-quota-track")).toHaveClass("bg-muted");
    expect(screen.queryByTestId("mini-quota-fill")).not.toBeInTheDocument();
  });

  it("renders quota fill when secondary remaining percent is available", () => {
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

    expect(screen.getByTestId("mini-quota-fill")).toHaveStyle({ width: "73%" });
  });

  it("disables use button when 5h quota is unavailable", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 0,
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

    expect(screen.getByRole("button", { name: "Use this" })).toBeDisabled();
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

  it("treats deactivated accounts with active snapshots as active in list rows", () => {
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
    expect(screen.queryByText("Deactivated")).not.toBeInTheDocument();
  });
});
