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

type AgentToolItem = {
  name: string;
  description: string;
  logoSrc: string;
  logoAlt: string;
  logoClassName?: string;
  comingSoon?: boolean;
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
    title: "Save money with us",
    body: "Save 50% of your quota monthly by seeing account pressure early and switching before you burn expensive quota windows.",
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

const AGENT_TOOL_ITEMS: AgentToolItem[] = [
  {
    name: "Codex",
    description: "Ship tasks end-to-end with autonomous coding loops.",
    logoSrc: "/agent-logos/codex.svg",
    logoAlt: "Codex logo",
  },
  {
    name: "OpenAI",
    description: "Power API workflows with model routing and tool calls.",
    logoSrc: "/openai.svg",
    logoAlt: "OpenAI logo",
    logoClassName: "brightness-0 invert",
  },
  {
    name: "Claude",
    description: "Run parallel reasoning for architecture and critiques.",
    logoSrc: "/agent-logos/claude.svg",
    logoAlt: "Claude logo",
    comingSoon: true,
  },
  {
    name: "Claude Code",
    description: "Use Claude Code workflows directly in your agent stack.",
    logoSrc: "/agent-logos/claude.svg",
    logoAlt: "Claude Code logo",
    comingSoon: true,
  },
  {
    name: "OpenClaw",
    description: "OpenClaw provider routing for Claude-compatible tasks.",
    logoSrc: "/agent-logos/red-crab.svg",
    logoAlt: "OpenClaw logo",
    comingSoon: true,
  },
  {
    name: "Claw Code",
    description: "Claw Code execution lane for coding automation tasks.",
    logoSrc: "/agent-logos/red-crab.svg",
    logoAlt: "Claw Code logo",
    comingSoon: true,
  },
  {
    name: "Gemini",
    description: "Add fast multimodal checks for docs, code, and UI.",
    logoSrc: "/agent-logos/gemini.svg",
    logoAlt: "Gemini logo",
    comingSoon: true,
  },
  {
    name: "OpenRouter",
    description: "Switch providers without rewriting your task pipeline.",
    logoSrc: "/agent-logos/openrouter.svg",
    logoAlt: "OpenRouter logo",
    logoClassName: "brightness-0 invert",
    comingSoon: true,
  },
];

const RUNTIME_DASHBOARD_PREVIEW_SRC = "/runtimes-dashboard-preview.jpg";

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
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
    <div className={`space-y-3 ${centered ? "text-center" : "text-left"}`}>
      <h2
        className={
          compact
            ? "text-[1.95rem] font-semibold leading-[1.12] tracking-tight text-zinc-50"
            : "text-lg font-semibold tracking-tight text-zinc-100 sm:text-xl"
        }
      >
        {title}
      </h2>
      <p
        className={
          compact
            ? "max-w-4xl text-[1.04rem] leading-8 text-zinc-300/95"
            : "max-w-2xl text-sm leading-7 text-zinc-400"
        }
      >
        {description}
      </p>
      {compact ? (
        <div
          aria-hidden="true"
          className="h-px w-full bg-gradient-to-r from-cyan-300/25 via-white/10 to-transparent"
        />
      ) : null}
    </div>
  );
}

function FeatureTilesSection({
  title,
  description,
  items,
  columnsClassName,
  topContent,
}: {
  title: string;
  description: string;
  items: InfoItem[];
  columnsClassName: string;
  topContent?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <SectionHeading compact title={title} description={description} />
      {topContent ? <div>{topContent}</div> : null}
      <div className={`grid gap-3 ${columnsClassName}`}>
        {items.map((item, index) => (
          <article
            key={item.title}
            className="relative overflow-hidden rounded-[22px] border border-white/12 bg-[linear-gradient(150deg,rgba(15,24,40,0.96)_0%,rgba(9,15,27,0.92)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] transition-colors duration-200 hover:border-cyan-200/32 hover:bg-[linear-gradient(150deg,rgba(17,28,47,0.97)_0%,rgba(11,19,33,0.94)_100%)] sm:p-6"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-70 bg-[radial-gradient(55%_78%_at_10%_4%,rgba(56,189,248,0.12)_0%,rgba(56,189,248,0.01)_62%,transparent_100%)]"
            />
            <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-300/15 bg-[#192434]/90 text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="h-5 w-5"
              >
                <path
                  d="M5 18L11 12L15 15L19 9"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="5" cy="18" r="1.3" fill="currentColor" />
                <circle cx="11" cy="12" r="1.3" fill="currentColor" />
                <circle cx="15" cy="15" r="1.3" fill="currentColor" />
                <circle cx="19" cy="9" r="1.3" fill="currentColor" />
              </svg>
            </span>
            <h3 className="relative text-[2rem] font-semibold leading-[1.15] tracking-tight text-zinc-50">
              {item.title}
            </h3>
            <p className="relative mt-4 text-[1.03rem] leading-8 text-zinc-300/95">
              {item.body}
            </p>
            <div className="relative mt-6 flex items-center gap-3">
              <div
                aria-hidden="true"
                className="h-px flex-1 bg-gradient-to-r from-cyan-300/25 via-white/10 to-transparent"
              />
              <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-500/[0.08] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200/90">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300/90" />
                Insight {index + 1}
              </span>
            </div>
          </article>
        ))}
      </div>
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
    <div className="mx-auto mt-4 w-full max-w-6xl">
      <div className="relative overflow-hidden rounded-[20px] border border-white/12 bg-[#020613] shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 opacity-95 bg-[radial-gradient(56%_95%_at_10%_55%,rgba(96,214,166,0.36)_0%,rgba(96,214,166,0.06)_49%,transparent_74%),radial-gradient(50%_90%_at_43%_72%,rgba(99,102,241,0.34)_0%,rgba(99,102,241,0.06)_53%,transparent_78%),radial-gradient(56%_120%_at_98%_32%,rgba(96,165,250,0.34)_0%,rgba(59,130,246,0.06)_58%,transparent_82%),linear-gradient(114deg,rgba(2,9,24,0.98)_0%,rgba(1,8,23,0.97)_37%,rgba(3,12,35,0.95)_66%,rgba(16,39,74,0.9)_100%)]" />
          <div className="absolute inset-0 opacity-35 bg-[linear-gradient(90deg,transparent_18%,rgba(255,255,255,0.04)_52%,transparent_84%)]" />
        </div>

        <div className="relative z-10 grid gap-6 px-6 py-7 sm:px-8 sm:py-9 lg:grid-cols-[1.4fr_1fr] lg:items-center lg:gap-10">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <CodexLogo size={34} title="recodee.com logo" className="opacity-95" />
              <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200 ring-1 ring-cyan-400/20">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                Fun Fact
              </div>
            </div>

            <p className="text-2xl font-semibold tracking-tight text-zinc-100 sm:text-[2.45rem] sm:leading-[1.15]">
              We built recodee with recodee. We call that confidence.
            </p>
            <p className="mt-2 text-base font-semibold text-zinc-100/95 sm:text-lg">
              Very on-brand. Also genuinely useful.
            </p>

            <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.08] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200/80">
                  Codex Throughput
                </p>
                <p className="mt-1.5 text-lg font-semibold tracking-[0.04em] text-cyan-50 sm:text-xl">
                  codex tokens used: 3B
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.08] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-200/80">
                  Efficiency Gain
                </p>
                <p className="mt-1.5 text-lg font-semibold tracking-[0.04em] text-emerald-50 sm:text-xl">
                  money saved: $10k+
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4 lg:border-l lg:border-white/10 lg:pl-8">
            <p className="text-base font-semibold leading-8 text-zinc-100 sm:text-[1.05rem]">
              No trial. No credit card required. Just your GitHub account.
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-[18px] border-white/20 bg-[linear-gradient(180deg,rgba(17,29,54,0.94)_0%,rgba(9,16,34,0.94)_100%)] px-7 text-lg font-semibold text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_14px_30px_rgba(4,8,20,0.45)] transition-colors hover:border-cyan-300/35 hover:bg-[linear-gradient(180deg,rgba(21,35,62,0.96)_0%,rgba(12,20,41,0.96)_100%)]"
              >
                Try free
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-xl border-cyan-400/30 bg-cyan-500/[0.08] px-6 text-lg font-semibold text-cyan-100 hover:bg-cyan-500/[0.16]"
                asChild
              >
                <a href="/billing">Pricing</a>
              </Button>
            </div>
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
      className="pointer-events-none absolute inset-0 hidden lg:block"
    >
      <div className="absolute left-[-132px] top-[102px] xl:left-[-210px] xl:top-[98px]">
        <p className="font-[cursive] text-sm italic text-cyan-200/90 xl:text-lg">
          Your tokens left
        </p>
        <p className="-mt-0.5 font-[cursive] text-sm italic text-cyan-200/90 xl:-mt-1 xl:text-lg">
          on the other site
        </p>
        <svg
          viewBox="0 0 170 70"
          className="ml-[74px] mt-1 h-[52px] w-[126px] xl:ml-[112px] xl:h-[70px] xl:w-[170px]"
          fill="none"
        >
          <path
            d="M4 10 C 42 14, 64 14, 86 16"
            stroke="rgb(103 232 249 / 0.75)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="4 5"
          />
          <path
            d="M78 9 L 89 17 L 74 19"
            stroke="rgb(103 232 249 / 0.75)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="absolute right-[-88px] top-[102px] text-right xl:right-[-132px] xl:top-[98px]">
        <p className="font-[cursive] text-sm italic text-emerald-200/90 xl:text-lg">
          Your active Codex
        </p>
        <p className="-mt-0.5 font-[cursive] text-sm italic text-emerald-200/90 xl:-mt-1 xl:text-lg">
          CLI sessions
        </p>
        <svg
          viewBox="0 0 180 70"
          className="mt-1 ml-auto h-[52px] w-[132px] xl:h-[70px] xl:w-[180px]"
          fill="none"
        >
          <path
            d="M128 10 C 92 15, 64 14, 26 16"
            stroke="rgb(167 243 208 / 0.75)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="4 5"
          />
          <path
            d="M34 9 L 22 17 L 37 19"
            stroke="rgb(167 243 208 / 0.75)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="absolute right-[-112px] top-[324px] text-right xl:right-[-190px]">
        <p className="font-[cursive] text-sm italic text-sky-200/90 xl:text-lg">
          Drop your email here
        </p>
        <svg viewBox="0 0 190 64" className="mt-1 ml-auto h-12 w-[132px] xl:h-16 xl:w-[190px]" fill="none">
          <path
            d="M128 10 C 98 18, 70 16, 10 16"
            stroke="rgb(125 211 252 / 0.75)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="4 5"
          />
          <path
            d="M18 9 L 6 17 L 21 19"
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

function AgentToolsPanel() {
  return (
    <div
      className="mx-auto w-full max-w-7xl px-1 py-3 sm:py-4"
      data-testid="agent-tools-panel"
    >
      <div className="grid gap-8 lg:grid-cols-[1fr_2.15fr] lg:gap-10">
        <div className="self-center space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80">
            Agent Stack
          </p>
          <h3 className="text-4xl font-bold tracking-tight text-zinc-50 sm:text-[3.2rem] sm:leading-[1.05]">
            Code with multiple agents at the same time
          </h3>
          <p className="max-w-[34rem] text-[1.04rem] leading-9 text-zinc-300">
            Run multiple agents in parallel, coordinate their outputs, and keep
            one shared workflow without context switching.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
          {AGENT_TOOL_ITEMS.map((item) => (
            <div
              key={item.name}
              aria-disabled={item.comingSoon ? "true" : undefined}
              className={`group rounded-2xl border border-white/10 bg-[#0a0f1b]/86 p-4 transition-colors duration-200 ${
                item.comingSoon
                  ? "cursor-not-allowed opacity-65 saturate-50"
                  : "hover:border-cyan-200/28 hover:bg-[#0d1627]"
              }`}
            >
              <div className="flex items-start gap-4">
                <span className="mt-0.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#101b2e]/90 ring-1 ring-white/10">
                  <img
                    src={item.logoSrc}
                    alt={item.logoAlt}
                    className={`h-7 w-7 object-contain ${item.logoClassName ?? ""}`}
                    loading="lazy"
                  />
                </span>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <p className="text-lg font-semibold leading-6 text-zinc-100">
                      {item.name}
                    </p>
                    {item.comingSoon ? (
                      <span className="inline-flex items-center whitespace-nowrap rounded-full border border-cyan-200/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-cyan-100">
                        Coming soon
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm leading-6 text-zinc-400">
                    {item.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
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
                  aria-label="Open runtimes dashboard screenshot fullscreen"
                >
                  <div className="relative overflow-hidden rounded-[30px]">
                    <img
                      src={RUNTIME_DASHBOARD_PREVIEW_SRC}
                      alt="Runtimes dashboard screenshot"
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
                Runtimes dashboard screenshot preview
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
                  src={RUNTIME_DASHBOARD_PREVIEW_SRC}
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-0 h-full w-full scale-110 rounded-2xl object-cover opacity-28 blur-2xl"
                />
                <img
                  src={RUNTIME_DASHBOARD_PREVIEW_SRC}
                  alt="Runtimes dashboard screenshot fullscreen"
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
                      forcePrimaryActionLabel
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

          <AgentToolsPanel />

          <div className="mx-auto w-full max-w-6xl space-y-6 px-1 py-4 sm:py-6">
            <FeatureTilesSection
              title="What the dashboard currently does"
              description="Built around official Codex account and session signals so you can decide faster and rotate accounts with less friction."
              items={WHAT_IT_DOES}
              columnsClassName="md:grid-cols-2 xl:grid-cols-4"
            />
            <FeatureTilesSection
              title="Why this improves daily work"
              description="This is about protecting focused work blocks, not just making a prettier dashboard."
              items={WHY_IT_HELPS}
              columnsClassName="md:grid-cols-2 xl:grid-cols-3"
              topContent={
                <article className="overflow-hidden rounded-[24px] border border-white/15 bg-[linear-gradient(145deg,rgba(13,20,36,0.97)_0%,rgba(8,14,28,0.95)_100%)] shadow-[0_22px_58px_rgba(0,0,0,0.44)]">
                  <img
                    src="/vscode-subbranches-showcase.svg"
                    alt="VS Code subbranch workflow with visible file changes and commit status"
                    className="block h-auto w-full"
                    loading="lazy"
                  />
                  <div className="space-y-3 p-5 sm:p-6">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/85">
                      VS Code branch workflow
                    </p>
                    <h3 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
                      Subbranch changes, clearly visible
                    </h3>
                    <p className="max-w-4xl text-[1.03rem] leading-8 text-zinc-300/95">
                      Show edits, modified files, and commit status per subbranch in one clean view so parallel branch work stays easy to track.
                    </p>
                  </div>
                </article>
              }
            />
          </div>
        </div>

        <FunFactCard />
      </section>
    </main>
  );
}
