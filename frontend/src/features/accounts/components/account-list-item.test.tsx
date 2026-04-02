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
});
