"use client";

import React, { useMemo, useState } from "react";
import { XIcon } from "lucide-react";

import { CodexLogo } from "@/components/brand/codex-logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AccountCard } from "@/features/dashboard/components/account-card";
import { TechStackStrip } from "@/features/coming-soon/components/tech-stack-strip";
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
    totalTokens: 216,
    cachedInputTokens: 0,
    totalCostUsd: 0,
  },
  codexLiveSessionCount: 1,
  codexTrackedSessionCount: 1,
  codexSessionCount: 1,
  codexCurrentTaskPreview: "Waiting for email address",
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

type InfoItem = {
  title: string;
  body: string;
};

const WHAT_IT_DOES: InfoItem[] = [
  {
    title: "See live account state in one glance",
    body: "Track official Codex CLI login and session signals in one place so the dashboard reflects what is happening right now.",
  },
  {
    title: "Stop polling /status all day",
    body: "Always-on visibility cuts the constant terminal detours and keeps your attention on the task you are already in.",
  },
  {
    title: "Switch accounts before work stalls",
    body: "When a 5-hour limit gets tight, rotate early and keep moving instead of waiting for a hard stop.",
  },
  {
    title: "Plan reset windows with confidence",
    body: "Clear usage windows make multi-account planning predictable, even when the day turns chaotic.",
  },
];

const WHY_IT_HELPS: InfoItem[] = [
  {
    title: "Protect deep work blocks",
    body: "This is not about prettier stats. It is about preserving long, useful stretches of uninterrupted work.",
  },
  {
    title: "Less dashboard-terminal ping-pong",
    body: "You should not need ten micro-checks to decide what to do next. recodee gives you the next useful view quickly.",
  },
  {
    title: "Clear timing decisions under pressure",
    body: "When to wait, when to switch, and when to push should feel obvious instead of approximate.",
  },
];

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function BulletList({
  items,
  compact = false,
  centered = false,
  carded = false,
}: {
  items: InfoItem[];
  compact?: boolean;
  centered?: boolean;
  carded?: boolean;
}) {
  return (
    <div className={compact ? "space-y-2.5" : "space-y-3"}>
      {items.map((item) => (
        <div
          key={item.title}
          className={
            centered
              ? "mx-auto flex w-full max-w-3xl items-start gap-3 text-left"
              : carded
                ? "flex gap-3 border-b border-white/10 pb-3 last:border-b-0 last:pb-0"
                : "flex gap-3"
          }
        >
          <div className="pt-2.5">
            <span className="block h-1 w-1 rounded-full bg-cyan-300/80" />
          </div>
          <div>
            <p
              className={
                compact
                  ? "text-sm font-semibold text-zinc-100"
                  : "text-sm font-medium text-zinc-100 sm:text-[15px]"
              }
            >
              {item.title}
            </p>
            <p
              className={
                compact
                  ? "mt-1 text-sm leading-6 text-zinc-300"
                  : "mt-1 text-sm leading-7 text-zinc-400"
              }
            >
              {item.body}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionHeading({
  title,
  description,
  compact = false,
  centered = false,
}: {
  title: string;
  description: string;
  compact?: boolean;
  centered?: boolean;
}) {
  return (
    <div className={`space-y-2 ${centered ? "text-center" : ""}`}>
      <h2
        className={
          compact
            ? "text-base font-semibold tracking-tight text-zinc-100 sm:text-lg"
            : "text-lg font-semibold tracking-tight text-zinc-100 sm:text-xl"
        }
      >
        {title}
      </h2>
      <p
        className={
          compact
            ? "mx-auto max-w-3xl text-sm leading-7 text-zinc-300"
            : "max-w-2xl text-sm leading-7 text-zinc-400"
        }
      >
        {description}
      </p>
    </div>
  );
}

function AmbientLights() {
  return (
    <>
      <div className="pointer-events-none absolute left-[-12%] top-[-6%] h-[280px] w-[280px] rounded-full bg-cyan-500/8 blur-3xl" />
      <div className="pointer-events-none absolute right-[-10%] top-[8%] h-[320px] w-[320px] rounded-full bg-blue-500/7 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[10%] right-[8%] h-[220px] w-[220px] rounded-full bg-emerald-500/6 blur-3xl" />
    </>
  );
}

function FunFactCard() {
  return (
    <div className="mx-auto mt-4 w-full max-w-4xl">
      <div className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(180deg,rgba(10,14,24,0.96)_0%,rgba(4,8,16,0.98)_100%)] p-[1px] shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
        <div className="relative rounded-[27px] px-6 py-7 text-center sm:px-10 sm:py-9">
          <div className="mb-4 flex justify-center">
            <CodexLogo
              size={42}
              title="recodee.com logo"
              className="opacity-95"
            />
          </div>

          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200 ring-1 ring-cyan-400/20">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
            Fun Fact
          </div>

          <p className="mt-4 text-2xl font-semibold tracking-tight text-zinc-100 sm:text-[2rem]">
            We built recodee with recodee. We call that confidence.
          </p>
          <p className="mt-2 text-sm text-zinc-400 sm:text-base">
            Very on-brand. Also genuinely useful.
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <span className="inline-flex items-center rounded-full px-4 py-1.5 text-xs font-medium tracking-[0.12em] text-cyan-100 ring-1 ring-cyan-400/20 sm:text-sm">
              codex tokens used: 3B
            </span>
            <span className="inline-flex items-center rounded-full px-4 py-1.5 text-xs font-medium tracking-[0.12em] text-emerald-100 ring-1 ring-emerald-400/20 sm:text-sm">
              money saved: $10k+
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoCardAnnotations() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 hidden xl:block"
    >
      <div className="absolute left-[-210px] top-[98px]">
        <p className="font-[cursive] text-lg italic text-cyan-200/90">
          Your tokens left
        </p>
        <p className="-mt-1 font-[cursive] text-lg italic text-cyan-200/90">
          on the other site
        </p>
        <svg
          viewBox="0 0 170 70"
          className="ml-[112px] mt-1 h-[70px] w-[170px]"
          fill="none"
        >
          <path
            d="M4 10 C 48 14, 78 14, 104 16"
            stroke="rgb(103 232 249 / 0.75)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="4 5"
          />
          <path
            d="M96 9 L 107 17 L 92 19"
            stroke="rgb(103 232 249 / 0.75)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="absolute right-[-132px] top-[98px] text-right">
        <p className="font-[cursive] text-lg italic text-emerald-200/90">
          Your active Codex
        </p>
        <p className="-mt-1 font-[cursive] text-lg italic text-emerald-200/90">
          CLI sessions
        </p>
        <svg
          viewBox="0 0 180 70"
          className="mt-1 h-[70px] w-[180px]"
          fill="none"
        >
          <path
            d="M176 10 C 126 15, 88 14, 34 16"
            stroke="rgb(167 243 208 / 0.75)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="4 5"
          />
          <path
            d="M42 9 L 30 17 L 45 19"
            stroke="rgb(167 243 208 / 0.75)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="absolute right-[-190px] top-[324px] text-right">
        <p className="font-[cursive] text-lg italic text-sky-200/90">
          Drop your email here
        </p>
        <svg viewBox="0 0 190 64" className="mt-1 h-16 w-[190px]" fill="none">
          <path
            d="M186 10 C 144 18, 102 16, 14 16"
            stroke="rgb(125 211 252 / 0.75)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="4 5"
          />
          <path
            d="M22 9 L 10 17 L 25 19"
            stroke="rgb(125 211 252 / 0.75)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

export function ComingSoonPage() {
  const [agentEmail, setAgentEmail] = useState("");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const hasValidAgentEmail = isValidEmailAddress(agentEmail);

  const demoAccount = useMemo<AccountSummary>(() => {
    return {
      ...DEMO_ACCOUNT_CARD,
      codexCurrentTaskPreview: hasValidAgentEmail
        ? "Waiting for user to press Submit."
        : "Waiting for email address",
      codexSessionTaskPreviews: [
        {
          sessionKey: "demo-session-1",
          taskPreview: hasValidAgentEmail
            ? "Waiting for user to press Submit"
            : "Waiting for email address",
          taskUpdatedAt: new Date().toISOString(),
        },
      ],
    };
  }, [hasValidAgentEmail]);

  return (
    <main className="flex min-h-screen flex-col bg-background p-2 sm:p-3">
      <section className="relative flex-1 overflow-hidden rounded-3xl border border-border/50 bg-card/95 px-3 py-3 shadow-[0_12px_36px_rgba(0,0,0,0.28)] sm:px-4 sm:py-4">
        <AmbientLights />

        <div className="space-y-4">
          <div className="mx-auto mt-2 max-w-4xl text-center">
            <h1 className="text-2xl font-extrabold tracking-tight text-zinc-100 sm:text-3xl">
              Coming Soon
            </h1>
          </div>

          <div className="mx-auto w-full max-w-6xl">
            <div className="space-y-4">
              <div className="mb-4 flex flex-col items-center justify-center gap-3 text-center sm:flex-row sm:gap-4">
                <CodexLogo size={64} title="recodee.com logo" />
                <h2 className="text-2xl font-extrabold tracking-tight text-zinc-100 sm:text-3xl">
                  recodee.com
                </h2>
              </div>

              <p className="mx-auto max-w-5xl text-center text-base leading-8 text-cyan-100 sm:text-xl sm:leading-9">
                <strong className="font-extrabold text-cyan-50">
                  recodee.com
                </strong>{" "}
                keeps{" "}
                <strong className="font-extrabold text-cyan-50">Codex</strong>{" "}
                account and session signals in one place, so you can move faster
                when quotas get weird and sessions get noisy.
              </p>
              <p className="mt-4 text-center text-lg font-semibold text-zinc-100 sm:text-3xl">
                Stay in flow instead of babysitting status checks.
              </p>

              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsPreviewOpen(true);
                  }}
                  className="block w-full max-w-[820px]"
                  aria-label="Open Codex app screenshot fullscreen"
                >
                  <div className="relative overflow-hidden rounded-[30px]">
                    <img
                      src="/app.png"
                      alt="Codex app screenshot"
                      className="block h-auto w-full rounded-[30px] shadow-[0_24px_72px_rgba(6,10,25,0.55)]"
                      loading="lazy"
                    />
                  </div>
                </button>
              </div>

              <TechStackStrip className="mt-4 space-y-2 [&>div:first-child]:text-[10px] [&>div:first-child]:tracking-[0.18em] [&>div:first-child]:text-zinc-300/80 [&>div:nth-child(2)]:gap-2 [&_a]:border-transparent" />
            </div>
          </div>

          <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
            <DialogContent
              showCloseButton={false}
              className="inset-0 h-screen w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-none bg-black/96 p-0 shadow-none sm:max-w-none"
            >
              <DialogTitle className="sr-only">
                Codex app screenshot preview
              </DialogTitle>
              <DialogDescription className="sr-only">
                Fullscreen screenshot preview dialog.
              </DialogDescription>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-4 top-4 z-50 h-10 w-10 rounded-full border border-white/15 bg-black/65 text-zinc-100 hover:bg-black/80"
                  aria-label="Close fullscreen preview"
                >
                  <XIcon className="size-5" />
                </Button>
              </DialogClose>

              <div className="relative z-0 flex h-full w-full items-center justify-center overflow-hidden rounded-2xl">
                <img
                  src="/app.png"
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-0 h-full w-full scale-110 rounded-2xl object-cover opacity-28 blur-2xl"
                />
                <img
                  src="/app.png"
                  alt="Codex app screenshot fullscreen"
                  className="relative z-10 h-full w-full rounded-2xl border border-white/15 object-contain shadow-[0_30px_120px_rgba(0,0,0,0.65)]"
                />
              </div>
            </DialogContent>
          </Dialog>

          <div className="relative">
            <div className="relative z-10">
              <div className="relative z-10 mt-3 flex flex-col items-center space-y-4 sm:mt-4">
                <div className="space-y-3">
                  <div className="relative w-full max-w-[560px]">
                    <AccountCard
                      account={demoAccount}
                      useLocalBusy={!hasValidAgentEmail}
                      deleteBusy
                      initialSessionTasksCollapsed
                      disableSecondaryActions
                      hideCurrentTaskPreview
                      primaryActionLabel="Submit"
                      primaryActionAriaLabel="Submit account tutorial"
                      taskPanelAddon={
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-100">
                              Please enter your email address
                            </p>
                            <span className="inline-flex items-center rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
                              required
                            </span>
                          </div>
                          <Input
                            type="email"
                            value={agentEmail}
                            onChange={(event) => {
                              setAgentEmail(event.currentTarget.value);
                            }}
                            placeholder="name@company.com"
                            aria-label="Agent email address"
                            className="h-10 border-white/10 bg-black/30 text-zinc-100 placeholder:text-zinc-500 focus-visible:border-white/25 focus-visible:ring-white/10"
                          />
                        </div>
                      }
                      onAction={() => {}}
                    />
                    <DemoCardAnnotations />
                  </div>
                </div>

                <div className="flex flex-wrap justify-center gap-2">
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

          <div className="mx-auto w-full max-w-5xl px-1 py-4 sm:py-6">
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-5 sm:p-6">
                <SectionHeading
                  compact
                  title="What the dashboard currently does"
                  description="Built around official Codex account and session signals so you can decide faster and rotate accounts with less friction."
                />
                <div className="mt-3">
                  <BulletList compact items={WHAT_IT_DOES} carded />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-5 sm:p-6">
                <SectionHeading
                  compact
                  title="Why this improves daily work"
                  description="This is about protecting focused work blocks, not just making a prettier dashboard."
                />
                <div className="mt-3">
                  <BulletList compact items={WHY_IT_HELPS} carded />
                </div>
              </div>
            </div>
          </div>
        </div>

        <FunFactCard />
      </section>
    </main>
  );
}
