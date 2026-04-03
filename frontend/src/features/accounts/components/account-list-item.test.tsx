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

  it("treats deactivated accounts with live sessions as active in list rows", () => {
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
    expect(screen.queryByText("Deactivated")).not.toBeInTheDocument();
  });

  it("shows live badge and live background when account is working now", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
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
