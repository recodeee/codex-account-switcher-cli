import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountCard } from "@/features/dashboard/components/account-card";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { createAccountSummary } from "@/test/mocks/factories";
import { resetWorkingNowLimitHitStateForTests } from "@/utils/account-working";
import { resetQuotaDisplayFloorCacheForTests } from "@/utils/quota-display";

afterEach(() => {
  act(() => {
    usePrivacyStore.setState({ blurred: false });
  });
  resetQuotaDisplayFloorCacheForTests();
  resetWorkingNowLimitHitStateForTests();
});

describe("AccountCard", () => {
  it("renders both 5h and weekly quota bars for regular accounts", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      requestUsage: {
        requestCount: 12,
        totalTokens: 98_765,
        cachedInputTokens: 0,
        totalCostUsd: 1.23,
      },
      codexLiveSessionCount: 3,
      codexSessionCount: 3,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
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

  it("renders quota bars inside the OpenAI token card container", () => {
    const account = createAccountSummary({
      codexLiveSessionCount: 2,
      codexSessionCount: 2,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
    });

    render(<AccountCard account={account} />);

    const tokenCardHeader = screen.getByText("OpenAI");
    const tokenCardBody = tokenCardHeader.closest("div.relative");

    expect(tokenCardBody).not.toBeNull();
    expect(within(tokenCardBody as HTMLElement).getByText("5h")).toBeInTheDocument();
    expect(within(tokenCardBody as HTMLElement).getByText("Weekly")).toBeInTheDocument();
  });

  it("does not render the cardholder row", () => {
    const account = createAccountSummary({
      displayName: "admin@recodee.com",
      email: "admin@recodee.com",
    });

    render(<AccountCard account={account} />);

    expect(screen.queryByText("Cardholder name")).not.toBeInTheDocument();
    expect(screen.queryByText(/^admin$/i)).not.toBeInTheDocument();
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

  it("shows one decimal place for non-integer quota percentages", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 43.24,
        secondaryRemainingPercent: 77.76,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("43.2%")).toBeInTheDocument();
    expect(screen.getByText("77.8%")).toBeInTheDocument();
  });

  it("renders zero token usage without a k suffix", () => {
    const account = createAccountSummary({
      requestUsage: {
        requestCount: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        totalCostUsd: 0,
      },
    });

    render(<AccountCard account={account} />);

    const tokensLabel = screen.getByText("Tokens used");
    const tokensValue = tokensLabel.parentElement?.querySelector("p.mt-0\\.5 > span");
    expect(tokensValue).not.toBeNull();
    expect(tokensValue).toHaveTextContent(/^0$/);
    expect(tokensValue).not.toHaveTextContent(/k$/i);
  });

  it("shows remaining token label/value when configured by parent", () => {
    const account = createAccountSummary();

    render(
      <AccountCard
        account={account}
        showTokensRemaining
        tokensRemaining={225}
      />,
    );

    expect(screen.getByText("Tokens remaining")).toBeInTheDocument();
    expect(screen.getByText("225k")).toBeInTheDocument();
    expect(screen.queryByText("Tokens used")).not.toBeInTheDocument();
  });

  it("uses the configured primary window label when it is not 5h", () => {
    const account = createAccountSummary({
      windowMinutesPrimary: 480,
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("8h")).toBeInTheDocument();
    expect(screen.queryByText("5h")).not.toBeInTheDocument();
  });

  it("blurs snapshot name when snapshot name is an email in privacy mode", () => {
    act(() => {
      usePrivacyStore.setState({ blurred: true });
    });
    const account = createAccountSummary({
      displayName: "AWS Account MSP",
      email: "aws-account@example.com",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "snapshot-email@example.com",
        activeSnapshotName: "snapshot-email@example.com",
        isActiveSnapshot: true,
      },
    });

    render(<AccountCard account={account} />);

    const snapshot = screen.getByText("snapshot-email@example.com");
    expect(snapshot.closest(".privacy-blur")).not.toBeNull();
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
    const lockedAccountHeading = screen.getByText("Locked account");
    const lockedAccountOverlay = lockedAccountHeading.closest("div.relative");

    expect(lockedAccountOverlay).not.toBeNull();
    expect(
      within(lockedAccountOverlay as HTMLElement).getByText("primary@example.com"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
  });

  it("calls reauth action when unlock is clicked for a missing snapshot", async () => {
    const user = userEvent.setup({ delay: null });
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: false,
        snapshotName: null,
        activeSnapshotName: null,
        isActiveSnapshot: false,
      },
    });
    const onAction = vi.fn();

    render(<AccountCard account={account} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(onAction).toHaveBeenCalledWith(account, "reauth");
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

  it("disables use this account button when weekly quota is unavailable", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 44,
        secondaryRemainingPercent: 0,
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

  it("disables use this account button when weekly quota rounds down to 0% for display", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 44,
        secondaryRemainingPercent: 4,
      },
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
      },
    });

    render(<AccountCard account={account} />);

    const useButton = screen.getByRole("button", { name: "Use this account" });
    expect(useButton).toBeDisabled();
    expect(useButton).toHaveAttribute("title", "Weekly quota shown as 0%.");
  });

  it("keeps use-local gating aligned with the displayed 5h value after floor-cache carryover", () => {
    const sharedAccountId = "acc_floor_cache_alignment";
    const sharedResetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { rerender } = render(
      <AccountCard
        account={createAccountSummary({
          accountId: sharedAccountId,
          resetAtPrimary: sharedResetAt,
          usage: {
            primaryRemainingPercent: 0,
            secondaryRemainingPercent: 73,
          },
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Use this account" })).toBeDisabled();

    rerender(
      <AccountCard
        account={createAccountSummary({
          accountId: sharedAccountId,
          resetAtPrimary: sharedResetAt,
          usage: {
            primaryRemainingPercent: 80,
            secondaryRemainingPercent: 73,
          },
        })}
      />,
    );

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

  it("enables use this account button for working-now accounts even with depleted 5h quota", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      status: "paused",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 40,
      },
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "different",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      codexSessionCount: 0,
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(<AccountCard account={account} />);

    expect(screen.getByRole("button", { name: "Use this account" })).toBeEnabled();
  });

  it("disables use this account button for working-now accounts when weekly quota is depleted", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      status: "paused",
      usage: {
        primaryRemainingPercent: 40,
        secondaryRemainingPercent: 0,
      },
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "different",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      codexSessionCount: 0,
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(<AccountCard account={account} />);

    expect(screen.getByRole("button", { name: "Use this account" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use this account" })).toHaveAttribute(
      "title",
      "Weekly quota shown as 0%.",
    );
  });

  it("keeps deactivated status visible even when active snapshot is present", () => {
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

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-auth" })).toBeInTheDocument();
  });

  it("shows expired refresh token badge and re-auth action when refresh token re-login is required", () => {
    const account = createAccountSummary({
      status: "deactivated",
      deactivationReason: "Refresh token expired - re-login required",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "odin",
        activeSnapshotName: "odin",
        isActiveSnapshot: true,
      },
      auth: {
        access: { expiresAt: null, state: null },
        refresh: { state: "expired" },
        idToken: { state: "parsed" },
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByText("Expired refresh token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-auth" })).toBeInTheDocument();
  });

  it("keeps deactivated status visible for local snapshots in dashboard cards", () => {
    const account = createAccountSummary({
      status: "deactivated",
      usage: {
        primaryRemainingPercent: 44,
        secondaryRemainingPercent: 73,
      },
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "webubusiness",
        activeSnapshotName: null,
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: null,
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-auth" })).toBeInTheDocument();
  });

  it("keeps deactivated status visible with fresh CLI debug samples", () => {
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

    render(<AccountCard account={account} />);

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-auth" })).toBeInTheDocument();
  });

  it("keeps deactivated snapshot accounts disconnected even with recent usage", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
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
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-auth" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this account" })).toBeEnabled();
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
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      codexSessionCount: 6,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });
    const onAction = vi.fn();

    render(<AccountCard account={account} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Sessions" }));

    expect(onAction).toHaveBeenCalledWith(account, "sessions");
  });

  it("calls delete action when delete button is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    const account = createAccountSummary();
    const onAction = vi.fn();

    render(<AccountCard account={account} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onAction).toHaveBeenCalledWith(account, "delete");
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

  it("does not show working indicator when account snapshot is active without live sessions", () => {
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

    render(<AccountCard account={account} />);

    expect(screen.queryByText("Working now")).not.toBeInTheDocument();
  });

  it("shows live token and 5h status affordances for working accounts", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      codexLiveSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(<AccountCard account={account} />);

    expect(screen.getAllByText("Live token status").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/^live$/i).length).toBeGreaterThanOrEqual(1);
  });

  it("shows usage-limit state when a live account reaches 0% in the 5h window", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      status: "active",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 66,
      },
      codexLiveSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Rate limited")).toBeInTheDocument();
    expect(screen.getAllByText("Usage limit hit").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Working now")).not.toBeInTheDocument();
  });

  it("shows usage-limit badge when remaining tokens are depleted", () => {
    const account = createAccountSummary({
      status: "active",
      codexLiveSessionCount: 0,
      codexSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
    });

    const { container } = render(
      <AccountCard account={account} showTokensRemaining tokensRemaining={0} />,
    );

    expect(screen.getAllByText("Usage limit hit").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/leaves in/i)).not.toBeInTheDocument();
    const card = container.querySelector(".card-hover");
    expect(card).not.toBeNull();
    expect(card?.className).toContain("border-red-500/40");
  });

  it("shows usage-limit badge when remaining tokens fallback to zero", () => {
    const account = createAccountSummary({
      status: "active",
      codexLiveSessionCount: 0,
      codexSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
    });

    render(<AccountCard account={account} showTokensRemaining />);

    expect(screen.getAllByText("Usage limit hit").length).toBeGreaterThanOrEqual(1);
    const tokensSection = screen.getByText("Tokens remaining").parentElement;
    expect(tokensSection).not.toBeNull();
    expect(within(tokensSection as HTMLElement).getByText("0")).toBeInTheDocument();
  });

  it("shows usage-limit badge when 5h is depleted even without a live session", () => {
    const account = createAccountSummary({
      status: "active",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 50,
      },
      codexLiveSessionCount: 0,
      codexSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
    });

    const { container } = render(<AccountCard account={account} />);

    expect(screen.getAllByText("Usage limit hit").length).toBeGreaterThanOrEqual(1);
    const card = container.querySelector(".card-hover");
    expect(card).not.toBeNull();
    expect(card?.className).toContain("border-red-500/40");
  });

  it("shows only the weekly usage-limit badge when 5h is available but weekly is 0%", () => {
    const account = createAccountSummary({
      status: "active",
      usage: {
        primaryRemainingPercent: 62,
        secondaryRemainingPercent: 0,
      },
      codexLiveSessionCount: 0,
      codexSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.queryByText(/^Usage limit hit$/)).not.toBeInTheDocument();
    expect(screen.getByText("Weekly usage limit hit")).toBeInTheDocument();
  });

  it("treats sub-5% 5h quota as depleted for live usage-limit state", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      status: "active",
      usage: {
        primaryRemainingPercent: 2,
        secondaryRemainingPercent: 66,
      },
      codexLiveSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Rate limited")).toBeInTheDocument();
    expect(screen.getAllByText("Usage limit hit").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("0%").length).toBeGreaterThanOrEqual(1);
  });

  it("shows usage-limit countdown and red card tint while grace window is active", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-04-05T00:00:00.000Z");
      vi.setSystemTime(now);
      const nowIso = now.toISOString();
      const account = createAccountSummary({
        status: "active",
        usage: {
          primaryRemainingPercent: 0,
          secondaryRemainingPercent: 66,
        },
        codexLiveSessionCount: 1,
        codexSessionCount: 1,
        codexTrackedSessionCount: 1,
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "main",
          activeSnapshotName: "main",
          isActiveSnapshot: true,
          hasLiveSession: true,
        },
        lastUsageRecordedAtPrimary: nowIso,
        lastUsageRecordedAtSecondary: nowIso,
      });

      const { container } = render(<AccountCard account={account} />);

      expect(screen.getByText(/leaves in/i)).toBeInTheDocument();
      expect(screen.getByText(/Leaving working now in/i)).toBeInTheDocument();
      expect(screen.getAllByText(/1:00/).length).toBeGreaterThanOrEqual(1);
      const card = container.querySelector(".card-hover");
      expect(card).not.toBeNull();
      expect(card?.className).toContain("border-red-500/40");
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-terminates CLI sessions once the usage-limit grace window expires", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-04-05T00:00:00.000Z");
      vi.setSystemTime(now);
      const nowIso = now.toISOString();
      const account = createAccountSummary({
        status: "active",
        usage: {
          primaryRemainingPercent: 0,
          secondaryRemainingPercent: 66,
        },
        codexLiveSessionCount: 1,
        codexTrackedSessionCount: 1,
        codexSessionCount: 1,
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "main",
          activeSnapshotName: "main",
          isActiveSnapshot: true,
          hasLiveSession: true,
        },
        lastUsageRecordedAtPrimary: nowIso,
        lastUsageRecordedAtSecondary: nowIso,
      });
      const onAction = vi.fn();

      render(<AccountCard account={account} onAction={onAction} />);
      expect(onAction).not.toHaveBeenCalledWith(account, "terminateCliSessions");

      act(() => {
        vi.advanceTimersByTime(61_000);
      });
      expect(onAction).toHaveBeenCalledWith(account, "terminateCliSessions");

      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      const terminateCalls = onAction.mock.calls.filter(
        ([calledAccount, action]) =>
          calledAccount === account && action === "terminateCliSessions",
      );
      expect(terminateCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not repeatedly auto-terminate when telemetry timestamps keep rotating", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-04-05T00:00:00.000Z");
      vi.setSystemTime(now);
      const nowIso = now.toISOString();
      const account = createAccountSummary({
        status: "active",
        usage: {
          primaryRemainingPercent: 0,
          secondaryRemainingPercent: 66,
        },
        codexLiveSessionCount: 1,
        codexTrackedSessionCount: 1,
        codexSessionCount: 1,
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "main",
          activeSnapshotName: "main",
          isActiveSnapshot: true,
          hasLiveSession: true,
        },
        lastUsageRecordedAtPrimary: nowIso,
        lastUsageRecordedAtSecondary: nowIso,
      });
      const onAction = vi.fn();

      const { rerender } = render(<AccountCard account={account} onAction={onAction} />);

      act(() => {
        vi.advanceTimersByTime(61_000);
      });
      expect(onAction).toHaveBeenCalledWith(account, "terminateCliSessions");

      const refreshedAccount = {
        ...account,
        lastUsageRecordedAtPrimary: new Date("2026-04-05T00:01:10.000Z").toISOString(),
        lastUsageRecordedAtSecondary: new Date("2026-04-05T00:01:10.000Z").toISOString(),
      };
      rerender(<AccountCard account={refreshedAccount} onAction={onAction} />);

      const terminateCalls = onAction.mock.calls.filter(
        ([, action]) => action === "terminateCliSessions",
      );
      expect(terminateCalls).toHaveLength(1);
      expect(screen.queryByText(/Leaving working now in/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows live-session fallback label when runtime sessions have no telemetry timestamps yet", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: null,
        secondaryRemainingPercent: null,
      },
      codexLiveSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });

    render(<AccountCard account={account} />);

    expect(screen.getAllByText("Live session detected").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Telemetry pending")).not.toBeInTheDocument();
    expect(screen.queryByText("Syncing live telemetry")).not.toBeInTheDocument();
  });

  it("shows live-session fallback label when quota percentages are missing", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: null,
        secondaryRemainingPercent: null,
      },
      codexLiveSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(<AccountCard account={account} />);

    expect(screen.getAllByText("Live session detected").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Telemetry pending")).not.toBeInTheDocument();
    expect(screen.queryByText("Syncing live telemetry")).not.toBeInTheDocument();
  });

  it("uses raw live quota samples when merged windows are unavailable", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: null,
        secondaryRemainingPercent: null,
      },
      resetAtPrimary: null,
      resetAtSecondary: null,
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      codexLiveSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "odin",
        activeSnapshotName: "odin",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["odin"],
        overrideApplied: false,
        overrideReason: "live_session_without_windows",
        merged: {
          source: "merged",
          snapshotName: "odin",
          recordedAt: nowIso,
          stale: false,
          primary: null,
          secondary: null,
        },
        rawSamples: [
          {
            source: "/tmp/rollout-odin.jsonl",
            snapshotName: "odin",
            recordedAt: nowIso,
            stale: false,
            primary: {
              usedPercent: 83,
              remainingPercent: 17,
              resetAt: 1760000000,
              windowMinutes: 300,
            },
            secondary: {
              usedPercent: 23,
              remainingPercent: 77,
              resetAt: 1760600000,
              windowMinutes: 10080,
            },
          },
        ],
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getAllByText("17%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("77%").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Telemetry pending")).not.toBeInTheDocument();
    expect(screen.getAllByText("Live token status").length).toBeGreaterThanOrEqual(1);
  });

  it("does not use deferred mixed-session samples for live quota fallback when baseline usage is missing", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: null,
        secondaryRemainingPercent: null,
      },
      resetAtPrimary: null,
      resetAtSecondary: null,
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      codexLiveSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "odin",
        activeSnapshotName: "odin",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["odin"],
        overrideApplied: false,
        overrideReason: "deferred_active_snapshot_mixed_default_sessions",
        merged: {
          source: "merged",
          snapshotName: "odin",
          recordedAt: nowIso,
          stale: false,
          primary: {
            usedPercent: 91,
            remainingPercent: 9,
            resetAt: 1760000000,
            windowMinutes: 300,
          },
          secondary: {
            usedPercent: 74,
            remainingPercent: 26,
            resetAt: 1760600000,
            windowMinutes: 10080,
          },
        },
        rawSamples: [
          {
            source: "/tmp/rollout-odin.jsonl",
            snapshotName: "odin",
            recordedAt: nowIso,
            stale: false,
            primary: {
              usedPercent: 91,
              remainingPercent: 9,
              resetAt: 1760000000,
              windowMinutes: 300,
            },
            secondary: {
              usedPercent: 74,
              remainingPercent: 26,
              resetAt: 1760600000,
              windowMinutes: 10080,
            },
          },
        ],
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.queryByText("9%")).not.toBeInTheDocument();
    expect(screen.queryByText("26%")).not.toBeInTheDocument();
    expect(screen.getAllByText("--").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Telemetry pending").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps baseline usage when deferred mixed-session fallback is not trusted", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 50,
        secondaryRemainingPercent: 56,
      },
      resetAtPrimary: "2026-04-04T11:00:00.000Z",
      resetAtSecondary: "2026-04-09T11:00:00.000Z",
      lastUsageRecordedAtPrimary: "2026-04-04T11:00:00.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T11:00:00.000Z",
      codexLiveSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "bia",
        activeSnapshotName: "bia",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["bia"],
        overrideApplied: false,
        overrideReason: "deferred_active_snapshot_mixed_default_sessions",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-bia.jsonl",
            snapshotName: "bia",
            recordedAt: nowIso,
            stale: false,
            primary: {
              usedPercent: 84,
              remainingPercent: 16,
              resetAt: null,
              windowMinutes: 300,
            },
            secondary: {
              usedPercent: 60,
              remainingPercent: 40,
              resetAt: null,
              windowMinutes: 10080,
            },
          },
        ],
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getAllByText("--").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/\b16%\b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\b40%\b/)).not.toBeInTheDocument();
  });

  it("renders current task preview when provided", () => {
    const account = createAccountSummary({
      codexLiveSessionCount: 2,
      codexSessionCount: 2,
      codexCurrentTaskPreview: "Trace session-affinity fallback for codex websocket flow",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.queryByText("Current task")).not.toBeInTheDocument();
    expect(
      screen.getByText("Trace session-affinity fallback for codex websocket flow"),
    ).toBeInTheDocument();
    expect(screen.getByText("Codex thinking")).toBeInTheDocument();
  });

  it("shows a Next.js badge when task previews mention next.js or turbopack", () => {
    const account = createAccountSummary({
      codexCurrentTaskPreview: "Change the Next.js dev server to Turbopack",
      codexLastTaskPreview: "Verify turbopack startup and debug state",
      codexLiveSessionCount: 1,
      codexSessionCount: 1,
      codexTrackedSessionCount: 1,
      codexSessionTaskPreviews: [
        {
          sessionKey: "sess-next",
          taskPreview: "Boot next js with turbopack and validate dashboard",
          taskUpdatedAt: "2026-04-05T10:00:00.000Z",
        },
      ],
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getAllByLabelText("Next.js task").length).toBeGreaterThanOrEqual(2);
  });

  it("renders current task preview for non-working accounts when provided", () => {
    const account = createAccountSummary({
      codexLiveSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: "Review sticky session cleanup edge-cases",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.queryByText("Current task")).not.toBeInTheDocument();
    expect(
      screen.getByText("Review sticky session cleanup edge-cases"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Codex thinking")).not.toBeInTheDocument();
  });

  it("shows a current task placeholder when no task preview is available", () => {
    const account = createAccountSummary({
      codexCurrentTaskPreview: null,
    });

    render(<AccountCard account={account} />);

    expect(screen.queryByText("Current task")).not.toBeInTheDocument();
    expect(screen.getByText("No active task reported")).toBeInTheDocument();
  });

  it("shows waiting for new task without the thinking indicator when a live session has no task preview", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      codexCurrentTaskPreview: null,
      codexLiveSessionCount: 2,
      codexSessionCount: 2,
      codexTrackedSessionCount: 2,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(<AccountCard account={account} />);

    expect(screen.queryByText("Current task")).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for new task")).toBeInTheDocument();
    expect(screen.queryByText("Codex thinking")).not.toBeInTheDocument();
  });

  it("renders per-session task previews with waiting fallback", () => {
    const account = createAccountSummary({
      codexCurrentTaskPreview: "Investigate websocket sticky routing",
      codexSessionTaskPreviews: [
        {
          sessionKey: "sess-alpha-123456",
          taskPreview: "Investigate websocket sticky routing",
          taskUpdatedAt: "2026-04-05T10:00:00.000Z",
        },
        {
          sessionKey: "sess-beta-abcdef",
          taskPreview: null,
          taskUpdatedAt: "2026-04-05T10:01:00.000Z",
        },
      ],
      codexLiveSessionCount: 2,
      codexSessionCount: 2,
      codexTrackedSessionCount: 2,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("CLI session tasks")).toBeInTheDocument();
    expect(screen.getByText("sess-alpha-123456")).toBeInTheDocument();
    expect(screen.getByText("sess-beta-abcdef")).toBeInTheDocument();
    expect(screen.getAllByText("Waiting for new task").length).toBeGreaterThanOrEqual(1);
  });

  it("shows last task context when a waiting live session exposes a fallback preview", () => {
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      codexCurrentTaskPreview: "Waiting for new task",
      codexLastTaskPreview: "Investigate Zeus quota overlay mapping",
      codexLiveSessionCount: 1,
      codexSessionCount: 1,
      codexTrackedSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Waiting for new task")).toBeInTheDocument();
    expect(screen.getByText("Last task:")).toBeInTheDocument();
    expect(
      screen.getByText("Investigate Zeus quota overlay mapping"),
    ).toBeInTheDocument();
  });

  it("hides stale current task preview after usage-limit grace expires", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-04-05T00:00:00.000Z");
      vi.setSystemTime(now);
      const nowIso = now.toISOString();
      const account = createAccountSummary({
        status: "active",
        codexCurrentTaskPreview: "Investigate codexina rollout session mapping",
        usage: {
          primaryRemainingPercent: 0,
          secondaryRemainingPercent: 66,
        },
        codexLiveSessionCount: 1,
        codexSessionCount: 1,
        codexTrackedSessionCount: 1,
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "codexina",
          activeSnapshotName: "codexina",
          isActiveSnapshot: true,
          hasLiveSession: true,
        },
        lastUsageRecordedAtPrimary: nowIso,
        lastUsageRecordedAtSecondary: nowIso,
      });

      render(<AccountCard account={account} />);
      expect(screen.getByText("Investigate codexina rollout session mapping")).toBeInTheDocument();
      expect(screen.getByText(/leaves in/i)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(61_000);
      });

      expect(screen.queryByText("Current task")).not.toBeInTheDocument();
      expect(screen.queryByText("Investigate codexina rollout session mapping")).not.toBeInTheDocument();
      expect(screen.getByText("Waiting for new task")).toBeInTheDocument();
      expect(screen.queryByText(/leaves in/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Working now")).toBeInTheDocument();
  });

  it("does not show working indicator when only diagnostic debug raw samples exist", () => {
    const account = createAccountSummary({
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

    render(<AccountCard account={account} />);

    expect(screen.queryByText("Working now")).not.toBeInTheDocument();
  });

  it("does not infer codex session count from debug raw samples when counters are zero", () => {
    const account = createAccountSummary({
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
            source: "/tmp/rollout-1.jsonl",
            snapshotName: "viktor",
            recordedAt: new Date().toISOString(),
            stale: false,
            primary: { usedPercent: 56, remainingPercent: 44, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 32, remainingPercent: 68, resetAt: 1760600000, windowMinutes: 10080 },
          },
          {
            source: "/tmp/rollout-2.jsonl",
            snapshotName: "viktor",
            recordedAt: new Date().toISOString(),
            stale: false,
            primary: { usedPercent: 55, remainingPercent: 45, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 32, remainingPercent: 68, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });

    const { container } = render(<AccountCard account={account} />);

    const card = container.querySelector(".card-hover");
    expect(card).not.toBeNull();
    const sessionsLabel = within(card as HTMLElement).getByText("Codex CLI sessions");
    const sessionsValue = sessionsLabel.parentElement?.querySelector("p.mt-0\\.5.text-xs.font-semibold.tabular-nums");
    expect(sessionsValue).not.toBeNull();
    expect(sessionsValue).toHaveTextContent(/^0$/);
  });

  it("shows working indicator when tracked codex sessions exist without live telemetry", () => {
    const account = createAccountSummary({
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 2,
      codexSessionCount: 0,
      usage: {
        primaryRemainingPercent: 100,
        secondaryRemainingPercent: 63,
      },
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
    expect(screen.queryByText("Live token status")).not.toBeInTheDocument();
    expect(screen.getByText("63%")).toBeInTheDocument();
  });

  it("keeps sessions action enabled for tracked-only accounts", () => {
    const account = createAccountSummary({
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 2,
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getByText("Tracked: 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sessions" })).toBeEnabled();
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

    const { container } = render(<AccountCard account={account} />);

    const card = container.querySelector(".card-hover");
    expect(card).not.toBeNull();
    const sessionsLabel = within(card as HTMLElement).getByText("Codex CLI sessions");
    const sessionsValue = sessionsLabel.parentElement?.querySelector("p.mt-0\\.5.text-xs.font-semibold.tabular-nums");
    expect(sessionsValue).not.toBeNull();
    expect(sessionsValue).toHaveTextContent(/^0$/);
  });

  it("shows at least one codex session when runtime reports a live session", () => {
    const nowIso = new Date().toISOString();
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
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
    });

    const { container } = render(<AccountCard account={account} />);

    const card = container.querySelector(".card-hover");
    expect(card).not.toBeNull();
    const sessionsLabel = within(card as HTMLElement).getByText("Codex CLI sessions");
    const sessionsValue = sessionsLabel.parentElement?.querySelector("p.mt-0\\.5.text-xs.font-semibold.tabular-nums");
    expect(sessionsValue).not.toBeNull();
    expect(sessionsValue).toHaveTextContent(/^1$/);
  });

  it("renders sub-5% quotas as 0% when reset time already passed", () => {
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

    expect(screen.getByText("0%")).toBeInTheDocument();
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

  it("ignores deferred mixed-session merged percentages when override was not applied", () => {
    const account = createAccountSummary({
      accountId: "acc_debug_merged_values",
      usage: {
        primaryRemainingPercent: 93,
        secondaryRemainingPercent: 0,
      },
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "viktor",
        activeSnapshotName: "viktor",
        isActiveSnapshot: true,
        hasLiveSession: false,
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
            usedPercent: 49,
            remainingPercent: 51,
            resetAt: 1760000000,
            windowMinutes: 300,
          },
          secondary: {
            usedPercent: 31,
            remainingPercent: 69,
            resetAt: 1760600000,
            windowMinutes: 10080,
          },
        },
        rawSamples: [],
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.queryByText("51%")).not.toBeInTheDocument();
    expect(screen.queryByText("69%")).not.toBeInTheDocument();
    expect(screen.getAllByText("93%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("0%").length).toBeGreaterThanOrEqual(1);
  });

  it("does not keep a stale 0% floor when trusted merged quota debug values are available", () => {
    const accountId = "acc_debug_floor_recovery";
    const base = createAccountSummary({
      accountId,
      usage: {
        primaryRemainingPercent: 93,
        secondaryRemainingPercent: 0,
      },
      liveQuotaDebug: null,
    });
    const withMerged = createAccountSummary({
      accountId,
      usage: {
        primaryRemainingPercent: 93,
        secondaryRemainingPercent: 0,
      },
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "viktor",
        activeSnapshotName: "viktor",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["viktor"],
        overrideApplied: true,
        overrideReason: "applied_live_usage_windows",
        merged: {
          source: "merged",
          snapshotName: "viktor",
          recordedAt: "2026-01-01T00:00:00.000Z",
          stale: false,
          primary: {
            usedPercent: 49,
            remainingPercent: 51,
            resetAt: 1760000000,
            windowMinutes: 300,
          },
          secondary: {
            usedPercent: 31,
            remainingPercent: 69,
            resetAt: 1760600000,
            windowMinutes: 10080,
          },
        },
        rawSamples: [],
      },
    });

    const { rerender } = render(<AccountCard account={base} />);
    expect(screen.getAllByText("0%").length).toBeGreaterThanOrEqual(1);

    rerender(<AccountCard account={withMerged} />);
    expect(screen.getAllByText("69%").length).toBeGreaterThanOrEqual(1);
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

    const { container } = render(<AccountCard account={account} />);

    const card = container.querySelector(".card-hover");
    expect(card).not.toBeNull();
    const sessionsLabel = within(card as HTMLElement).getByText("Codex CLI sessions");
    const sessionsValue = sessionsLabel.parentElement?.querySelector("p.mt-0\\.5.text-xs.font-semibold.tabular-nums");
    expect(sessionsValue).not.toBeNull();
    expect(sessionsValue).toHaveTextContent(/^0$/);
    expect(within(card as HTMLElement).getByRole("button", { name: "Sessions" })).toBeDisabled();
  });

  it("keeps live quota debug collapsed by default and expands on demand", async () => {
    const user = userEvent.setup();
    const account = createAccountSummary({
      codexLiveSessionCount: 2,
      codexTrackedSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "snap-a",
        activeSnapshotName: "snap-a",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["snap-a"],
        overrideApplied: true,
        overrideReason: "applied_live_usage_windows",
        merged: {
          source: "merged",
          snapshotName: "snap-a",
          recordedAt: "2026-01-01T00:00:00.000Z",
          stale: false,
          primary: {
            usedPercent: 83,
            remainingPercent: 17,
            resetAt: 1760000000,
            windowMinutes: 300,
          },
          secondary: {
            usedPercent: 23,
            remainingPercent: 77,
            resetAt: 1760600000,
            windowMinutes: 10080,
          },
        },
        rawSamples: [
          {
            source: "/tmp/rollout-a.jsonl",
            snapshotName: "snap-a",
            recordedAt: "2026-01-01T00:00:00.000Z",
            stale: false,
            primary: {
              usedPercent: 2,
              remainingPercent: 98,
              resetAt: 1760000000,
              windowMinutes: 300,
            },
            secondary: {
              usedPercent: 40,
              remainingPercent: 60,
              resetAt: 1760600000,
              windowMinutes: 10080,
            },
          },
        ],
      },
    });

    render(<AccountCard account={account} />);

    expect(screen.getByRole("button", { name: /debug/i })).toBeInTheDocument();
    expect(screen.queryByText(/cli session logs/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$ merged 5h=17% weekly=77%/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /debug/i }));
    expect(screen.getByText(/cli session logs/i)).toBeInTheDocument();
    expect(screen.getByText(/\$ merged 5h=17% weekly=77%/)).toBeInTheDocument();
    expect(screen.getByText(/\$ override=applied_live_usage_windows/)).toBeInTheDocument();
    expect(
      screen.getByText(/\$ cli_mapping selected_snapshot=snap-a active_snapshot=snap-a match=yes/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/\$ cli_session_counts mapped=2 tracked=1 displayed=2 live_signal=yes/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/\$ attribution=account-attributed override applied/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save log file/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy logs/i })).toBeInTheDocument();
    expect(screen.queryByText(/\$ no cli sessions sampled/i)).not.toBeInTheDocument();
  });

  it("surfaces mapped live sessions without quota rows in CLI session logs", async () => {
    const user = userEvent.setup();
    const nowIso = new Date().toISOString();
    const account = createAccountSummary({
      codexLiveSessionCount: 2,
      codexTrackedSessionCount: 1,
      codexSessionCount: 2,
      codexCurrentTaskPreview: null,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "snap-a",
        activeSnapshotName: "snap-a",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: nowIso,
      lastUsageRecordedAtSecondary: nowIso,
      liveQuotaDebug: {
        snapshotsConsidered: ["snap-a"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [],
      },
    });

    render(<AccountCard account={account} />);
    await user.click(screen.getByRole("button", { name: /debug/i }));

    expect(
      screen.getByText(/\$ cli_session_counts mapped=2 tracked=1 displayed=2 live_signal=yes/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/\$ mapped_cli_sessions=2 quota_sampled_rows=0/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/\$ live_sessions_without_quota_rows=2/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/\$ task_preview_state=waiting_for_new_task/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/\$ no quota-bearing cli samples/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$ no cli sessions sampled/i)).not.toBeInTheDocument();
  });

  it("scopes CLI session logs to the current account snapshot", async () => {
    const user = userEvent.setup();
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "csoves.com",
        activeSnapshotName: "csoves.com",
        isActiveSnapshot: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["csoves.com", "viktor"],
        overrideApplied: false,
        overrideReason: "deferred_active_snapshot_mixed_default_sessions",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-viktor.jsonl",
            snapshotName: "viktor",
            recordedAt: "2026-01-01T00:00:00.000Z",
            stale: false,
            primary: {
              usedPercent: 80,
              remainingPercent: 20,
              resetAt: 1760000000,
              windowMinutes: 300,
            },
            secondary: {
              usedPercent: 10,
              remainingPercent: 90,
              resetAt: 1760600000,
              windowMinutes: 10080,
            },
          },
          {
            source: "/tmp/rollout-csoves.jsonl",
            snapshotName: "csoves.com",
            recordedAt: "2026-01-01T00:01:00.000Z",
            stale: false,
            primary: {
              usedPercent: 53,
              remainingPercent: 47,
              resetAt: 1760000000,
              windowMinutes: 300,
            },
            secondary: {
              usedPercent: 30,
              remainingPercent: 70,
              resetAt: 1760600000,
              windowMinutes: 10080,
            },
          },
        ],
      },
    });

    render(<AccountCard account={account} />);
    await user.click(screen.getByRole("button", { name: /debug/i }));

    expect(
      screen.getByText(/\$ cli_mapping selected_snapshot=csoves\.com active_snapshot=csoves\.com match=yes/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/\$ cli_session_counts mapped=0 tracked=0 displayed=0 live_signal=no/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/\$ attribution=diagnostic sample only \(not attributed\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/rollout-csoves\.jsonl/i)).toBeInTheDocument();
    expect(screen.queryByText(/rollout-viktor\.jsonl/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/snapshot=viktor/i)).not.toBeInTheDocument();
  });
});
