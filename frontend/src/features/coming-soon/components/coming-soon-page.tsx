"use client";

import type { FormEvent } from "react";
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
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [agentEmail, setAgentEmail] = useState("");

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();

    if (!email) {
      return;
    }

    setSubmittedEmail(email);
    event.currentTarget.reset();
  };

  const hasValidAgentEmail = isValidEmailAddress(agentEmail);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-4xl rounded-2xl border border-border/70 bg-card p-6 shadow-sm sm:p-10">
        <div className="mb-8 overflow-hidden rounded-xl border border-border/60 bg-black/30 p-2">
          <div className="aspect-[16/7]">
            <img
              src="/commingsoon.jpg"
              alt="Dashboard preview"
              className="h-full w-full object-contain object-center"
              loading="lazy"
            />
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-4 sm:gap-6">
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

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
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
          </div>

          <div className="space-y-4">
            <div>
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
                  <div className="rounded-md border border-cyan-400/25 bg-cyan-500/10 p-2.5">
                    <p className="text-xs font-medium text-cyan-200">
                      Agent waiting for email address
                    </p>
                    <div className="mt-2">
                      <Input
                        type="email"
                        value={agentEmail}
                        onChange={(event) => {
                          setAgentEmail(event.currentTarget.value);
                        }}
                        placeholder="Enter email address"
                        aria-label="Agent email address"
                        className="h-8 border-cyan-500/30 bg-black/30 text-zinc-100 placeholder:text-zinc-500"
                      />
                    </div>
                  </div>
                }
                onAction={() => {}}
              />
            </div>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="mt-8 flex flex-col gap-3 sm:flex-row"
        >
          <Input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="Enter email address"
            aria-label="Email address"
            className="sm:flex-1"
          />
          <Button type="submit" className="sm:min-w-28">
            Submit
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" asChild>
            <a href="/dashboard">Open dashboard</a>
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <a href="/accounts">Open accounts</a>
          </Button>
        </div>

        {submittedEmail ? (
          <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-400">
            Thanks! We will keep{" "}
            <span className="font-medium">{submittedEmail}</span> posted.
          </p>
        ) : null}
      </section>
    </main>
  );
}
