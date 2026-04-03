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
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
    });
    render(<AccountCard account={account} />);

    expect(screen.getByText("Plus · main")).toBeInTheDocument();
    expect(screen.getByText("5h")).toBeInTheDocument();
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("Tokens used")).toBeInTheDocument();
    expect(screen.getByText("Codex CLI sessions")).toBeInTheDocument();
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

    expect(screen.getByText("Free · main")).toBeInTheDocument();
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

  it("shows plan subtitle with mapped snapshot name", () => {
    const account = createAccountSummary({
      planType: "team",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "zeus",
        activeSnapshotName: "zeus",
        isActiveSnapshot: true,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Team · zeus")).toBeInTheDocument();
  });

  it("shows no-snapshot subtitle when mapping is missing", () => {
    const account = createAccountSummary({
      planType: "team",
      codexAuth: {
        hasSnapshot: false,
        snapshotName: null,
        activeSnapshotName: null,
        isActiveSnapshot: false,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Team · No snapshot")).toBeInTheDocument();
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
    const account = createAccountSummary({
      codexSessionCount: 6,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
    });
    const onAction = vi.fn();

    render(<AccountCard account={account} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Sessions" }));

    expect(onAction).toHaveBeenCalledWith(account, "sessions");
  });

  it("shows snapshot repair actions for mismatched snapshot names", async () => {
    const user = userEvent.setup({ delay: null });
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
    const onAction = vi.fn();

    render(<AccountCard account={account} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Re-add snapshot" }));
    await user.click(screen.getByRole("button", { name: "Rename snapshot" }));

    expect(onAction).toHaveBeenNthCalledWith(1, account, "repairSnapshotReadd");
    expect(onAction).toHaveBeenNthCalledWith(2, account, "repairSnapshotRename");
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

  it("shows live token and 5h status affordances for working accounts", () => {
    const account = createAccountSummary({
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getAllByText("Live token status").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/^live$/i).length).toBeGreaterThanOrEqual(1);
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

  it("shows working indicator when runtime session is live even if snapshot is not globally active", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Working now")).toBeInTheDocument();
  });

  it("shows working indicator when tracked codex sessions exist", () => {
    const account = createAccountSummary({
      codexSessionCount: 2,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Working now")).toBeInTheDocument();
  });

  it("keeps card codex sessions at zero when only active snapshot is present without live telemetry", () => {
    const account = createAccountSummary({
      email: "working@example.com",
      displayName: "working@example.com",
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "working",
        activeSnapshotName: "working",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
    });

    render(<AccountCard account={account} />);

    const card = screen.getByText("working@example.com").closest(".card-hover");
    expect(card).not.toBeNull();
    const sessionsLabel = within(card as HTMLElement).getByText("Codex CLI sessions");
    const sessionsValue = sessionsLabel.parentElement?.querySelector("p.mt-0\\.5.text-xs.font-semibold.tabular-nums");
    expect(sessionsValue).not.toBeNull();
    expect(sessionsValue).toHaveTextContent(/^0$/);
  });

  it("shows at least one codex session when runtime reports a live session", () => {
    const account = createAccountSummary({
      email: "runtime@example.com",
      displayName: "runtime@example.com",
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "runtime",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
    });

    render(<AccountCard account={account} />);

    const card = screen.getByText("runtime@example.com").closest(".card-hover");
    expect(card).not.toBeNull();
    const sessionsLabel = within(card as HTMLElement).getByText("Codex CLI sessions");
    const sessionsValue = sessionsLabel.parentElement?.querySelector("p.mt-0\\.5.text-xs.font-semibold.tabular-nums");
    expect(sessionsValue).not.toBeNull();
    expect(sessionsValue).toHaveTextContent(/^1$/);
  });

  it("shows 100% for 5h when reset time already passed, including deactivated accounts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:10:00.000Z"));

    const account = createAccountSummary({
      status: "deactivated",
      usage: {
        primaryRemainingPercent: 2,
        secondaryRemainingPercent: 67,
      },
      resetAtPrimary: "2026-01-01T00:00:00.000Z",
      resetAtSecondary: "2026-01-07T00:00:00.000Z",
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("100%")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows per-window last-seen labels when telemetry is not currently live", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: "2025-12-31T23:30:00.000Z",
      lastUsageRecordedAtSecondary: "2025-12-31T23:00:00.000Z",
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("last seen 30m ago")).toBeInTheDocument();
    expect(screen.getByText("last seen 1h ago")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("renders up-to-date in green when the last-seen timestamp is within the current minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: "2026-01-01T00:00:00.000Z",
      lastUsageRecordedAtSecondary: "2025-12-31T23:55:00.000Z",
    });

    const { container } = render(<AccountCard account={account} />);

    const upToDate = screen.getByText("Up to date");
    expect(upToDate).toBeInTheDocument();
    expect(upToDate).toHaveClass("text-emerald-600");
    expect(container.textContent).not.toContain("last seen 0m ago");
    vi.useRealTimers();
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

    expect(screen.getAllByText("last seen 30m ago").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("last seen 1h ago").length).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
  });

  it("uses a green up-to-date badge for deactivated accounts when usage was seen this minute", () => {
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
      lastUsageRecordedAtPrimary: "2026-01-01T00:00:00.000Z",
      lastUsageRecordedAtSecondary: "2025-12-31T23:00:00.000Z",
    });

    render(<AccountCard account={account} />);

    const upToDateBadges = screen.getAllByText("Up to date");
    expect(upToDateBadges.length).toBeGreaterThanOrEqual(1);
    expect(upToDateBadges[0]).toHaveClass("text-emerald-600");
    vi.useRealTimers();
  });

  it("renders gray 5h quota visuals for deactivated accounts", () => {
    const account = createAccountSummary({
      status: "deactivated",
      codexAuth: {
        hasSnapshot: false,
        snapshotName: null,
        activeSnapshotName: null,
        isActiveSnapshot: false,
      },
    });

    render(<AccountCard account={account} />);

    const fiveHourCard = screen.getByText("5h").closest("div.space-y-2");
    expect(fiveHourCard).not.toBeNull();
    const progressTrack = (fiveHourCard as HTMLElement).querySelector(".relative.h-2.w-full");
    expect(progressTrack).not.toBeNull();
    expect(progressTrack).toHaveClass("bg-zinc-500/10");
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
    const sessionsLabel = within(card as HTMLElement).getByText("Codex CLI sessions");
    const sessionsValue = sessionsLabel.parentElement?.querySelector("p.mt-0\\.5.text-xs.font-semibold.tabular-nums");
    expect(sessionsValue).not.toBeNull();
    expect(sessionsValue).toHaveTextContent(/^0$/);
    expect(within(card as HTMLElement).queryByRole("button", { name: "Sessions" })).not.toBeInTheDocument();
  });
});
