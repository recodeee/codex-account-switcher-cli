import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountCard } from "@/features/dashboard/components/account-card";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { createAccountSummary } from "@/test/mocks/factories";

afterEach(() => {
  act(() => {
    usePrivacyStore.setState({ blurred: false });
  });
});

describe("AccountCard", () => {
  it("renders both 5h and weekly quota bars for regular accounts", () => {
    const account = createAccountSummary({
      requestUsage: {
        requestCount: 12,
        totalTokens: 98_765,
        cachedInputTokens: 0,
        totalCostUsd: 1.23,
      },
      codexSessionCount: 3,
    });
    render(<AccountCard account={account} />);

    expect(screen.getByText("Plus")).toBeInTheDocument();
    expect(screen.getByText("5h")).toBeInTheDocument();
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("Tokens used")).toBeInTheDocument();
    expect(screen.getByText("Codex sessions")).toBeInTheDocument();
    expect(screen.getByText("98,765k")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sessions" })).toBeInTheDocument();
  });

  it("hides 5h quota bar for weekly-only accounts", () => {
    const account = createAccountSummary({
      planType: "free",
      usage: {
        primaryRemainingPercent: null,
        secondaryRemainingPercent: 76,
      },
      windowMinutesPrimary: null,
      windowMinutesSecondary: 10_080,
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.queryByText("5h")).not.toBeInTheDocument();
    expect(screen.getByText("Weekly")).toBeInTheDocument();
  });

  it("blurs the dashboard card title when privacy mode is enabled", () => {
    act(() => {
      usePrivacyStore.setState({ blurred: true });
    });
    const account = createAccountSummary({
      displayName: "AWS Account MSP",
      email: "aws-account@example.com",
    });

    const { container } = render(<AccountCard account={account} />);

    expect(screen.getByText("AWS Account MSP")).toBeInTheDocument();
    expect(container.querySelector(".privacy-blur")).not.toBeNull();
  });

  it("enables use this account button when snapshot exists and 5h quota is available", () => {
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

    render(<AccountCard account={account} />);

    expect(screen.getByRole("button", { name: "Use this account" })).toBeEnabled();
  });

  it("disables use this account button when 5h quota is unavailable", () => {
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

    render(<AccountCard account={account} />);

    expect(screen.getByRole("button", { name: "Use this account" })).toBeDisabled();
  });

  it("enables use this account button when codex-auth snapshot is unavailable but account is active with quota", () => {
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

    render(<AccountCard account={account} />);

    expect(screen.getByRole("button", { name: "Use this account" })).toBeEnabled();
  });

  it("treats deactivated accounts with active snapshots as active in card actions", () => {
    const account = createAccountSummary({
      status: "deactivated",
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

    render(<AccountCard account={account} />);

    expect(screen.getByRole("button", { name: "Use this account" })).toBeEnabled();
    expect(screen.queryByText("Deactivated")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-auth" })).not.toBeInTheDocument();
  });

  it("calls useLocal action when use this account button is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    const account = createAccountSummary();
    const onAction = vi.fn();

    render(<AccountCard account={account} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Use this account" }));

    expect(onAction).toHaveBeenCalledWith(account, "useLocal");
  });

  it("calls terminal action when terminal button is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    const account = createAccountSummary();
    const onAction = vi.fn();

    render(<AccountCard account={account} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Terminal" }));

    expect(onAction).toHaveBeenCalledWith(account, "terminal");
  });

  it("calls sessions action when sessions button is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    const account = createAccountSummary({ codexSessionCount: 6 });
    const onAction = vi.fn();

    render(<AccountCard account={account} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Sessions" }));

    expect(onAction).toHaveBeenCalledWith(account, "sessions");
  });

  it("shows working indicator when account snapshot is active", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Working now")).toBeInTheDocument();
  });

  it("hides working indicator when account snapshot is not active", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.queryByText("Working now")).not.toBeInTheDocument();
  });

  it("shows at least one codex session when account is working now", () => {
    const account = createAccountSummary({
      email: "working@example.com",
      displayName: "working@example.com",
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "working",
        activeSnapshotName: "working",
        isActiveSnapshot: true,
      },
    });

    render(<AccountCard account={account} />);

    const card = screen.getByText("working@example.com").closest(".card-hover");
    expect(card).not.toBeNull();
    const sessionsLabel = within(card as HTMLElement).getByText("Codex sessions");
    const sessionsValue = sessionsLabel.parentElement?.querySelector("p.mt-0\\.5.text-xs.font-semibold.tabular-nums");
    expect(sessionsValue).not.toBeNull();
    expect(sessionsValue).toHaveTextContent(/^1$/);
  });

  it("shows last-seen usage labels for deactivated accounts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const account = createAccountSummary({
      status: "deactivated",
      codexAuth: {
        hasSnapshot: false,
        snapshotName: null,
        activeSnapshotName: null,
        isActiveSnapshot: false,
      },
      lastUsageRecordedAtPrimary: "2025-12-31T23:30:00.000Z",
      lastUsageRecordedAtSecondary: "2025-12-31T23:00:00.000Z",
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("last seen 30m ago")).toBeInTheDocument();
    expect(screen.getByText("last seen 1h ago")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("keeps codex sessions at zero when account is not the active snapshot", () => {
    const account = createAccountSummary({
      email: "idle@example.com",
      displayName: "idle@example.com",
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "idle",
        activeSnapshotName: "working",
        isActiveSnapshot: false,
      },
    });

    render(<AccountCard account={account} />);

    const card = screen.getByText("idle@example.com").closest(".card-hover");
    expect(card).not.toBeNull();
    const sessionsLabel = within(card as HTMLElement).getByText("Codex sessions");
    const sessionsValue = sessionsLabel.parentElement?.querySelector("p.mt-0\\.5.text-xs.font-semibold.tabular-nums");
    expect(sessionsValue).not.toBeNull();
    expect(sessionsValue).toHaveTextContent(/^0$/);
    expect(within(card as HTMLElement).queryByRole("button", { name: "Sessions" })).not.toBeInTheDocument();
  });
});
