"use client";

import { useState } from "react";

import { CodexLogo } from "@/components/brand/codex-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccountCard } from "@/features/dashboard/components/account-card";
import type { AccountSummary } from "@/features/dashboard/schemas";

const DEMO_ACCOUNT_CARD: AccountSummary = {
  accountId: "coming-soon-demo-account",
  email: "demo@demo.com",
  displayName: "demo@demo.com",
  planType: "team",
  status: "active",
  usage: {
    primaryRemainingPercent: 73,
    secondaryRemainingPercent: 38,
  },
  resetAtPrimary: new Date(
    Date.now() + (4 * 60 + 37) * 60 * 1000,
  ).toISOString(),
  resetAtSecondary: new Date(
    Date.now() + (6 * 24 * 60 + 23 * 60) * 60 * 1000,
  ).toISOString(),
  lastUsageRecordedAtPrimary: new Date().toISOString(),
  lastUsageRecordedAtSecondary: new Date().toISOString(),
  windowMinutesPrimary: 300,
  windowMinutesSecondary: 10080,
  requestUsage: {
    requestCount: 0,
    totalTokens: 216000,
    cachedInputTokens: 0,
    totalCostUsd: 0,
  },
  codexLiveSessionCount: 1,
  codexTrackedSessionCount: 1,
  codexSessionCount: 1,
  codexCurrentTaskPreview: "Agent waiting for email address",
  codexLastTaskPreview: null,
  codexSessionTaskPreviews: [
    {
      sessionKey: "demo-session-1",
      taskPreview: "Waiting for email address",
      taskUpdatedAt: new Date().toISOString(),
    },
  ],
  codexAuth: {
    hasSnapshot: true,
    snapshotName: "demo@demo.com",
    activeSnapshotName: "demo@demo.com",
    isActiveSnapshot: true,
    hasLiveSession: true,
    liveUsageConfidence: "high",
    expectedSnapshotName: "demo@demo.com",
    snapshotNameMatchesEmail: true,
  },
  additionalQuotas: [],
};

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function ComingSoonPage() {
  const [agentEmail, setAgentEmail] = useState("");

  const hasValidAgentEmail = isValidEmailAddress(agentEmail);

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <section className="flex min-h-[calc(100vh-2rem)] w-full flex-col rounded-2xl border border-border/70 bg-card p-4 shadow-sm sm:min-h-[calc(100vh-3rem)] sm:p-6">
        <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr] xl:items-stretch">
          <div className="overflow-hidden rounded-xl border border-border/60 bg-black/30 xl:min-h-[760px]">
            <img
              src="/commingsoon.jpg"
              alt="Dashboard preview"
              className="h-full w-full object-cover object-top"
              loading="lazy"
            />
          </div>

          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-4 sm:gap-6">
              <div className="inline-flex items-center gap-3">
                <CodexLogo size={62} title="recodee.com logo" />
                <p className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  recodee.com
                </p>
              </div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                Coming Soon
              </h1>
            </div>

            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              We’re building something dangerously useful. Drop your email and we’ll
              let you know when it’s ready.
            </p>

            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-foreground sm:text-lg">
                  What the dashboard currently does
                </h2>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                  <li>
                    Detects official Codex CLI login/session signals so you can
                    see account state in one place.
                  </li>
                  <li>
                    Live account status instead of manual <code>/status</code>{" "}
                    checks.
                  </li>
                  <li>
                    Fast account switching for 5-hour limits when one account hits
                    quota.
                  </li>
                  <li>
                    Reset-window planning for multi-account setups with visible
                    usage windows.
                  </li>
                </ul>
              </div>

              <div>
                <h2 className="text-base font-semibold text-foreground sm:text-lg">
                  Why this improves daily work
                </h2>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                  <li>More uninterrupted work time across multiple accounts.</li>
                  <li>Less context-switching between terminals and dashboard.</li>
                  <li>Clearer view of when to rotate accounts.</li>
                </ul>
              </div>

              <div className="w-full max-w-[520px]">
                <AccountCard
                  account={DEMO_ACCOUNT_CARD}
                  useLocalBusy={!hasValidAgentEmail}
                  deleteBusy
                  initialSessionTasksCollapsed
                  disableSecondaryActions
                  forceWorkingIndicator
                  primaryActionLabel="Submit"
                  primaryActionAriaLabel="Submit account tutorial"
                  taskPanelAddon={
                    <div className="mt-2">
                      <Input
                        type="email"
                        value={agentEmail}
                        onChange={(event) => {
                          setAgentEmail(event.currentTarget.value);
                        }}
                        placeholder="Enter email address"
                        aria-label="Agent email address"
                        className="h-8 border-white/14 bg-black/55 text-zinc-100 placeholder:text-zinc-500 focus-visible:border-cyan-400/35 focus-visible:ring-cyan-500/20"
                      />
                    </div>
                  }
                  onAction={() => {}}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" asChild>
                  <a href="/dashboard">Open dashboard</a>
                </Button>
                <Button type="button" variant="outline" size="sm" asChild>
                  <a href="/accounts">Open accounts</a>
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-auto pt-10">
          <div className="mx-auto w-full max-w-4xl rounded-2xl border border-cyan-400/25 bg-[linear-gradient(180deg,rgba(8,16,30,0.92)_0%,rgba(5,10,20,0.98)_100%)] p-1 shadow-[0_14px_34px_rgba(0,0,0,0.4)]">
            <div className="rounded-[14px] border border-white/8 bg-[radial-gradient(circle_at_20%_-30%,rgba(34,211,238,0.14),transparent_55%),linear-gradient(180deg,rgba(9,18,34,0.9)_0%,rgba(6,12,24,0.98)_100%)] px-6 py-5 text-center">
              <div className="mb-3 flex justify-center">
                <CodexLogo size={42} title="recodee.com logo" className="opacity-95" />
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/12 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-200">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-200" aria-hidden />
                Fun Fact
              </div>

              <p className="mt-3 text-xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">
                recodee.com was built with recodee.com too.
              </p>

              <div className="mt-4 flex justify-center">
                <p className="inline-flex items-center rounded-full border border-white/10 bg-black/25 px-4 py-1.5 text-xs tracking-[0.16em] text-zinc-300 sm:text-sm">
                  tokens spent: 3000M
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
