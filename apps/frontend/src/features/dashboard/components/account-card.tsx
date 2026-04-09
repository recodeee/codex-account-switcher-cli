import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  ExternalLink,
  Lock,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { isLikelyEmailValue } from "@/components/blur-email";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "@/lib/router-compat";
import { cn } from "@/lib/utils";
import type { AccountSummary } from "@/features/dashboard/schemas";
import {
  buildQuotaDisplayAccountKey,
  formatCompactAccountId,
} from "@/utils/account-identifiers";
import {
  quotaBarTrack,
  resolveEffectiveAccountStatus,
} from "@/utils/account-status";
import { STATUS_LABELS } from "@/utils/constants";
import {
  formatLastUsageLabel,
  formatQuotaResetLabel,
  formatTokenUsageCompact,
  formatTokenUsagePrecise,
  formatWindowLabel,
  formatSlug,
} from "@/utils/formatters";
import {
  getFreshDebugRawSampleCount,
  getMergedQuotaRemainingPercent,
  getRawQuotaWindowFallback,
  hasActiveCliSessionSignal,
  hasRecentUsageSignal,
  hasFreshLiveTelemetry,
  getWorkingNowUsageLimitHitCountdownMs,
  isAccountWorkingNow,
  isFreshQuotaTelemetryTimestamp,
  selectStableRemainingPercent,
} from "@/utils/account-working";
import { normalizeRemainingPercentForDisplay } from "@/utils/quota-display";
import {
  canUseLocalAccount,
  getUseLocalAccountDisabledReason,
} from "@/utils/use-local-account";

type AccountAction =
  | "details"
  | "resume"
  | "reauth"
  | "terminal"
  | "useLocal"
  | "sessions"
  | "delete"
  | "terminateCliSessions"
  | "repairSnapshotReadd"
  | "repairSnapshotRename";

export type AccountActionContext = {
  focusSessionKey?: string;
  source?: "session-panel" | "watch-logs";
};

export type AccountCardProps = {
  account: AccountSummary;
  tokensUsed?: number | null;
  tokensRemaining?: number | null;
  showTokensRemaining?: boolean;
  showAccountId?: boolean;
  showIdleCodexStatusPanel?: boolean;
  useLocalBusy?: boolean;
  deleteBusy?: boolean;
  initialSessionTasksCollapsed?: boolean;
  disableSecondaryActions?: boolean;
  forceWorkingIndicator?: boolean;
  hideCurrentTaskPreview?: boolean;
  taskPanelAddon?: ReactNode;
  primaryActionLabel?: string;
  primaryActionAriaLabel?: string;
  onAction?: (
    account: AccountSummary,
    action: AccountAction,
    context?: AccountActionContext,
  ) => void;
};

function formatPlanWithSnapshot(
  planType: string,
  snapshotName?: string | null,
): string {
  const planLabel = formatSlug(planType);
  const normalizedSnapshotName = snapshotName?.trim();
  if (!normalizedSnapshotName) {
    return `${planLabel} · No snapshot`;
  }
  return `${planLabel} · ${normalizedSnapshotName}`;
}

function getPlanSnapshotDetails(
  planType: string,
  snapshotName?: string | null,
): {
  planLabel: string;
  snapshotLabel: string;
  snapshotIsEmail: boolean;
} {
  const planLabel = formatSlug(planType);
  const normalizedSnapshotName = snapshotName?.trim();
  if (!normalizedSnapshotName) {
    return {
      planLabel,
      snapshotLabel: "No snapshot",
      snapshotIsEmail: false,
    };
  }
  return {
    planLabel,
    snapshotLabel: normalizedSnapshotName,
    snapshotIsEmail: isLikelyEmailValue(normalizedSnapshotName),
  };
}

function isCodexOnlyPlanType(planType: string): boolean {
  const normalized = planType
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return normalized === "self_serve_business_usage_based";
}

const NEAR_ZERO_QUOTA_PERCENT = 5;
const WAITING_FOR_NEW_TASK_LABEL = "Waiting for new task";
const TASK_FINISHED_LABEL = "Task finished";
const TASK_PREVIEW_TRUNCATION_LENGTH = 100;
const TASK_FINISHED_PREVIEW_RE =
  /^(?:task\s+)?(?:is\s+)?(?:already\s+)?(?:done|complete(?:d)?|finished)(?:\s+already)?[.!]?$/i;
const TASK_TERMINAL_ERROR_PREVIEW_RE =
  /^(?:task\s+)?(?:error|errored|failed|failure|stopped|terminated|aborted|cancelled|canceled|exited)\b/i;
const UNKNOWN_TOKENS_SYNC_LABEL = "syncing…";
const NEXT_TASK_PREVIEW_PATTERN = /\bnext(?:\.?js)?\b|\bturbopack\b/i;
const USAGE_LIMIT_TASK_PREVIEW_PATTERN =
  /\byou(?:'|’)ve hit your usage limit\b|\busage limit\b|\btry again at\b/i;
const USAGE_LIMIT_TASK_PREVIEW_HIGHLIGHT_PATTERN =
  /\byou(?:'|’)ve hit your usage limit\b/i;
const RALPLAN_TASK_MARKER_PATTERN = /\$?ralplan\b/i;
const OMX_PLANNING_NODES = [
  { key: "planner", label: "Planner", x: 50, y: 11 },
  { key: "critic", label: "Critic", x: 84, y: 26 },
  { key: "engineer", label: "Engineer", x: 84, y: 74 },
  { key: "verifier", label: "Verifier", x: 50, y: 89 },
  { key: "writer", label: "Writer", x: 16, y: 74 },
  { key: "architect", label: "Architect", x: 16, y: 26 },
] as const;
const LAST_TASK_PREVIEW_EXPANSION_KEY = "__last_task_preview__";
const STALE_SESSION_TASK_MS = 90_000;
type OmxPlanningNodeKey = (typeof OMX_PLANNING_NODES)[number]["key"];
type OmxCliRuntimeState = "finished" | "waiting" | "thinking";
const OMX_PLANNING_NODE_LOG_LABELS: Record<OmxPlanningNodeKey, string> = {
  planner: "Planner logs",
  critic: "Critic logs",
  engineer: "Engineer logs",
  verifier: "Verifier logs",
  writer: "Writer logs",
  architect: "Architect logs",
};

function CpuArchitectureBackdrop({
  className,
  dataTestId,
  variant = "default",
}: {
  className?: string;
  dataTestId?: string;
  variant?: "default" | "ralplan";
}) {
  const showRalplanSubLabel = variant === "ralplan";
  return (
    <svg
      data-testid={dataTestId}
      className={cn("h-full w-full text-cyan-200/45", className)}
      viewBox="0 0 200 100"
      fill="none"
      aria-hidden
    >
      <g
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M 0 50 H 56" />
        <path d="M 200 50 H 144" />
        <path d="M 88 0 V 28" />
        <path d="M 112 0 V 28" />
        <path d="M 88 72 V 100" />
        <path d="M 112 72 V 100" />
        <path d="M 0 26 H 34 Q 42 26 42 34 V 38 H 56" />
        <path d="M 200 26 H 166 Q 158 26 158 34 V 38 H 144" />
        <path d="M 0 74 H 34 Q 42 74 42 66 V 62 H 56" />
        <path d="M 200 74 H 166 Q 158 74 158 66 V 62 H 144" />
      </g>

      <g fill="url(#cpu-pin-grad)">
        <rect x="72" y="24" width="8" height="6" rx="1.5" />
        <rect x="94" y="24" width="8" height="6" rx="1.5" />
        <rect x="120" y="24" width="8" height="6" rx="1.5" />
        <rect x="72" y="70" width="8" height="6" rx="1.5" />
        <rect x="94" y="70" width="8" height="6" rx="1.5" />
        <rect x="120" y="70" width="8" height="6" rx="1.5" />
        <rect x="56" y="39" width="6" height="8" rx="1.5" />
        <rect x="56" y="53" width="6" height="8" rx="1.5" />
        <rect x="138" y="39" width="6" height="8" rx="1.5" />
        <rect x="138" y="53" width="6" height="8" rx="1.5" />
      </g>

      <rect
        x="60"
        y="30"
        width="80"
        height="40"
        rx="6"
        fill="#111318"
        stroke="#202631"
        strokeWidth="0.8"
      />
      <text
        x="100"
        y={showRalplanSubLabel ? "50" : "54"}
        textAnchor="middle"
        fontSize={showRalplanSubLabel ? "12" : "14"}
        fontWeight="700"
        letterSpacing="0.12em"
        fill="#d6dae2"
      >
        OMX
      </text>
      {showRalplanSubLabel ? (
        <text
          x="100"
          y="60"
          textAnchor="middle"
          fontSize="5"
          fontWeight="600"
          letterSpacing="0.2em"
          fill="#8bbdd0"
        >
          RALPLAN
        </text>
      ) : null}

      <defs>
        <linearGradient id="cpu-pin-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b5f69" />
          <stop offset="100%" stopColor="#2b2f39" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const OMX_CLI_STATE_STYLES: Record<
  OmxCliRuntimeState,
  {
    label: string;
    badgeClassName: string;
    inlineTextClassName: string;
    glowClassName: string;
    pulseClassName: string;
  }
> = {
  thinking: {
    label: "Thinking",
    badgeClassName: "border-indigo-300/60 bg-indigo-500/26 text-indigo-50",
    inlineTextClassName:
      "text-indigo-100/95 drop-shadow-[0_0_10px_rgba(99,102,241,0.34)]",
    glowClassName: "from-indigo-500/12 via-cyan-500/14 to-sky-500/12",
    pulseClassName: "bg-cyan-200 motion-safe:animate-pulse",
  },
  waiting: {
    label: "Waiting",
    badgeClassName: "border-cyan-300/55 bg-cyan-500/24 text-cyan-50",
    inlineTextClassName:
      "text-cyan-100/95 drop-shadow-[0_0_10px_rgba(34,211,238,0.32)]",
    glowClassName: "from-cyan-500/10 via-sky-500/12 to-cyan-500/10",
    pulseClassName:
      "bg-cyan-200 motion-safe:animate-ping motion-safe:[animation-duration:1.4s]",
  },
  finished: {
    label: "Finished",
    badgeClassName: "border-emerald-300/55 bg-emerald-500/24 text-emerald-50",
    inlineTextClassName:
      "text-emerald-100/95 drop-shadow-[0_0_10px_rgba(16,185,129,0.3)]",
    glowClassName: "from-emerald-500/12 via-teal-500/12 to-emerald-500/12",
    pulseClassName: "bg-emerald-200",
  },
};

function hasNextTaskHint(taskPreview: string | null | undefined): boolean {
  const normalized = taskPreview?.trim();
  if (!normalized) {
    return false;
  }
  return NEXT_TASK_PREVIEW_PATTERN.test(normalized);
}

function hasRalplanTaskMarker(taskPreview: string | null | undefined): boolean {
  const normalized = taskPreview?.trim();
  if (!normalized || isWaitingTaskPreview(normalized)) {
    return false;
  }
  return RALPLAN_TASK_MARKER_PATTERN.test(normalized);
}

function isUsageLimitTaskPreview(
  taskPreview: string | null | undefined,
): boolean {
  const normalized = taskPreview?.trim();
  if (!normalized) {
    return false;
  }
  return USAGE_LIMIT_TASK_PREVIEW_PATTERN.test(normalized);
}

function UsageLimitTaskPreviewText({ text }: { text: string }) {
  const match = USAGE_LIMIT_TASK_PREVIEW_HIGHLIGHT_PATTERN.exec(text);
  if (!match) {
    return <span className="text-red-300/90">{text}</span>;
  }

  const start = match.index;
  const end = start + match[0].length;
  const leading = text.slice(0, start);
  const highlighted = text.slice(start, end);
  const trailing = text.slice(end);

  return (
    <span>
      {leading ? <span className="text-red-300/90">{leading}</span> : null}
      <span className="font-semibold text-red-200">{highlighted}</span>
      {trailing ? <span className="text-red-300/90">{trailing}</span> : null}
    </span>
  );
}

function resolveOmxPlanningActiveNodeKey(
  taskPreview: string,
): OmxPlanningNodeKey {
  const normalized = taskPreview.trim().toLowerCase();
  if (!normalized) {
    return "planner";
  }
  if (
    /\barchitect\b|\barchitecture\b|\bsystem\s+design\b|\bboundar(?:y|ies)\b|\btrade-?off\b/.test(
      normalized,
    )
  ) {
    return "architect";
  }
  if (
    /\bcritic\b|\bchallenge\b|\brisk\b|\bcounter\b|\breview\b/.test(normalized)
  ) {
    return "critic";
  }
  if (
    /\bengineer\b|\bexecutor\b|\bimplement\b|\bcoding?\b|\bfix\b|\brefactor\b|\bbuild\b|\bsub-?agent\b/.test(
      normalized,
    )
  ) {
    return "engineer";
  }
  if (
    /\bwriter\b|\bdocs?\b|\bdocument(?:ation)?\b|\bnotes?\b|\bcopy\b/.test(
      normalized,
    )
  ) {
    return "writer";
  }
  if (
    /\bverifier\b|\bverify\b|\bvalidation\b|\bqa\b|\btests?\b|\bassert\b/.test(
      normalized,
    )
  ) {
    return "verifier";
  }
  return "planner";
}

function OmxPlanningPromptGraph({
  activeNodeKey,
  cliRuntimeState,
}: {
  activeNodeKey: OmxPlanningNodeKey;
  cliRuntimeState: OmxCliRuntimeState;
}) {
  const activeConnectorNode =
    OMX_PLANNING_NODES.find((node) => node.key === activeNodeKey) ??
    OMX_PLANNING_NODES[0];
  const cliStateStyle =
    OMX_CLI_STATE_STYLES[cliRuntimeState] ?? OMX_CLI_STATE_STYLES.finished;
  const activeNodeClasses =
    cliRuntimeState === "thinking"
      ? "border-indigo-200/80 bg-indigo-400/22 text-indigo-50 shadow-[0_0_0_1px_rgba(129,140,248,0.24),0_0_18px_rgba(129,140,248,0.35)]"
      : cliRuntimeState === "waiting"
        ? "border-cyan-200/80 bg-cyan-400/22 text-cyan-50 shadow-[0_0_0_1px_rgba(34,211,238,0.2),0_0_18px_rgba(34,211,238,0.32)]"
        : "border-emerald-200/80 bg-emerald-400/20 text-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.2),0_0_18px_rgba(16,185,129,0.32)]";
  const connectorStrokeClass =
    cliRuntimeState === "thinking"
      ? "stroke-indigo-200/45"
      : cliRuntimeState === "waiting"
        ? "stroke-cyan-200/45"
        : "stroke-emerald-200/45";
  const promptRuleClass =
    cliRuntimeState === "thinking"
      ? "bg-indigo-200/45"
      : cliRuntimeState === "waiting"
        ? "bg-cyan-200/45"
        : "bg-emerald-200/45";

  return (
    <div
      data-testid="omx-planning-prompt-graph"
      className={cn(
        "group relative mx-auto aspect-square w-full max-w-[34rem] overflow-hidden rounded-xl border border-white/10 bg-[#060A13]",
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-cyan-500/[0.04] to-transparent"
        aria-hidden
      />

      <div
        className={cn(
          "pointer-events-none absolute left-1/2 top-[48%] h-[64%] w-[64%] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-gradient-to-br opacity-55 blur-2xl",
          cliStateStyle.glowClassName,
        )}
        aria-hidden
      />

      <div className="pointer-events-none absolute inset-0">
        <CpuArchitectureBackdrop
          dataTestId="cpu-architecture-backdrop-planning"
          variant="ralplan"
        />
      </div>

      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        aria-hidden
      >
        <line
          data-testid="omx-planning-active-connector"
          x1="50"
          y1="50"
          x2={String(activeConnectorNode.x)}
          y2={String(activeConnectorNode.y)}
          className={connectorStrokeClass}
          strokeWidth="0.55"
          strokeDasharray="3 2"
          strokeLinecap="round"
        />
      </svg>

      {OMX_PLANNING_NODES.map((node) => {
        const nodeActive = node.key === activeNodeKey;
        return (
          <div
            key={node.key}
            className={cn(
              "absolute inline-flex min-w-[5.2rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.08em] backdrop-blur-sm transition-all duration-300",
              nodeActive
                ? cn("scale-[1.05]", activeNodeClasses)
                : "border-white/14 bg-[#060A13] text-zinc-100/95",
            )}
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
          >
            {nodeActive ? (
              <span
                className="pointer-events-none absolute -inset-1 rounded-lg border border-white/25"
                aria-hidden
              />
            ) : null}
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                nodeActive ? "bg-cyan-100" : "bg-zinc-300/65",
              )}
              aria-hidden
            />
            <span>{node.label}</span>
            {nodeActive ? (
              <span
                className="ml-1 inline-flex h-1.5 w-1.5 rounded-full bg-cyan-200 motion-safe:animate-ping"
                aria-hidden
              />
            ) : null}
          </div>
        );
      })}

      <div
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 z-10 h-px w-20 -translate-x-1/2 -translate-y-1/2",
          promptRuleClass,
        )}
        aria-hidden
      />

      <div className="absolute bottom-3 right-3 z-20">
        <span
          data-testid="omx-planning-cli-state"
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-full border bg-[#060A13] px-2.5 text-[9px] font-semibold uppercase tracking-[0.11em] shadow-[0_6px_16px_rgba(2,6,23,0.35)] backdrop-blur-sm",
            cliStateStyle.badgeClassName,
          )}
        >
          <span className="relative inline-flex h-1.5 w-1.5">
            <span
              className={cn(
                "absolute inset-0 rounded-full",
                cliStateStyle.pulseClassName,
              )}
              aria-hidden
            />
            <span className="absolute inset-0 rounded-full bg-current/80" />
          </span>
          {cliStateStyle.label}
        </span>
      </div>
    </div>
  );
}

function CodexActiveAgentCard({
  cliRuntimeState,
}: {
  cliRuntimeState: OmxCliRuntimeState;
}) {
  const cliStateStyle =
    OMX_CLI_STATE_STYLES[cliRuntimeState] ?? OMX_CLI_STATE_STYLES.finished;
  const showThinkingActivity = cliRuntimeState === "thinking";
  return (
    <div
      data-testid="codex-active-agent-card"
      className="relative mx-auto w-full overflow-hidden rounded-xl border border-cyan-300/35 bg-[#040b18]/90 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_26px_rgba(2,6,23,0.42)]"
    >
      <div
        className="pointer-events-none absolute inset-x-3 inset-y-0.5 opacity-90"
        aria-hidden
      >
        <CpuArchitectureBackdrop
          className="text-cyan-100/55"
          dataTestId="cpu-architecture-backdrop-codex-active"
        />
      </div>
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,211,238,0.22),rgba(6,10,19,0)_60%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#040b18]/92 via-transparent to-[#040b18]/92"
        aria-hidden
      />
      <div className="relative flex items-center gap-3">
        <div className="inline-flex items-start gap-2">
          <span className="relative mt-1 inline-flex h-2 w-2">
            <span
              className={cn(
                "absolute inset-0 rounded-full",
                cliStateStyle.pulseClassName,
              )}
              aria-hidden
            />
            <span className="absolute inset-0 rounded-full bg-current/80 text-cyan-100" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/95">
              Codex
            </span>
            <span
              data-testid="codex-inline-status"
              className={cn(
                "inline-flex w-fit items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                cliStateStyle.inlineTextClassName,
              )}
            >
              <span
                className={cn(
                  cliRuntimeState === "waiting" &&
                    "motion-safe:animate-pulse [animation-duration:1.4s]",
                )}
              >
                {cliStateStyle.label}
              </span>
              {showThinkingActivity ? (
                <span
                  data-testid="codex-inline-status-activity"
                  className="ml-0.5 flex items-end gap-0.5"
                  aria-hidden
                >
                  <span className="h-1.5 w-0.5 rounded-full bg-current animate-pulse [animation-duration:900ms]" />
                  <span className="h-2.5 w-0.5 rounded-full bg-current animate-pulse [animation-delay:120ms] [animation-duration:900ms]" />
                  <span className="h-3 w-0.5 rounded-full bg-current animate-pulse [animation-delay:240ms] [animation-duration:900ms]" />
                  <span className="h-2 w-0.5 rounded-full bg-current animate-pulse [animation-delay:360ms] [animation-duration:900ms]" />
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function NextTaskBadge() {
  return (
    <span
      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-cyan-500/35 bg-cyan-500/12 px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-cyan-200"
      title="Next.js task"
      aria-label="Next.js task"
    >
      N
    </span>
  );
}

function TaskFinishedPill({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-full border border-emerald-400/35 bg-gradient-to-r from-emerald-500/18 to-teal-500/12 px-2.5 text-emerald-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]",
        className,
      )}
    >
      <span className="sr-only">Task finished</span>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-100/95">
        task finished
      </span>
    </div>
  );
}

function resolveWaitingTaskPillLabel(
  taskPreview: string | null | undefined,
): string {
  const normalized = taskPreview?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return "waiting";
  }
  if (normalized.includes("email")) {
    return "waiting for email";
  }
  if (normalized.includes("submit")) {
    return "waiting for submit";
  }
  if (
    normalized.includes("input") ||
    normalized.includes("confirm") ||
    normalized.includes("interrupt")
  ) {
    return "waiting for input";
  }
  if (normalized.startsWith("waiting") || normalized.startsWith("awaiting")) {
    return normalized;
  }
  return "waiting";
}

function getTaskPreviewExcerpt(taskPreview: string): {
  text: string;
  truncated: boolean;
} {
  if (taskPreview.length <= TASK_PREVIEW_TRUNCATION_LENGTH) {
    return {
      text: taskPreview,
      truncated: false,
    };
  }

  return {
    text: `${taskPreview.slice(0, TASK_PREVIEW_TRUNCATION_LENGTH).trimEnd()}…`,
    truncated: true,
  };
}

function WaitingForTaskPill({
  className,
  label = "waiting",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-full border border-cyan-400/35 bg-gradient-to-r from-cyan-500/14 to-sky-500/10 px-2.5 text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        className,
      )}
    >
      <span className="sr-only">Waiting for new task</span>
      <span className="relative inline-flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-300/55 animate-ping [animation-duration:1.4s]" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-200" />
      </span>
      <span className="max-w-[156px] truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-100/95">
        {label}
      </span>
    </div>
  );
}

function ThinkingTaskPill({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-full border border-indigo-300/35 bg-gradient-to-r from-indigo-500/14 to-violet-500/12 px-2.5 text-indigo-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        className,
      )}
    >
      <span className="sr-only">Thinking</span>
      <span className="flex items-end gap-0.5" aria-hidden>
        <span className="h-1.5 w-1 rounded-full bg-zinc-100/95 animate-pulse [animation-duration:900ms]" />
        <span className="h-2.5 w-1 rounded-full bg-indigo-100/95 animate-pulse [animation-delay:140ms] [animation-duration:900ms]" />
        <span className="h-3 w-1 rounded-full bg-cyan-200/95 animate-pulse [animation-delay:280ms] [animation-duration:900ms]" />
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-100/95">
        thinking
      </span>
    </div>
  );
}

function WorkingNowPill({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-full border border-cyan-500/35 bg-gradient-to-r from-cyan-500/16 to-sky-500/12 px-2.5 text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        className,
      )}
    >
      <span className="sr-only">Codex working</span>
      <span className="flex items-end gap-1" aria-hidden>
        <span className="h-2 w-1 rounded-full bg-zinc-100/95 shadow-[0_0_8px_rgba(255,255,255,0.25)] animate-bounce [animation-duration:900ms]" />
        <span className="h-3 w-1 rounded-full bg-zinc-100/95 shadow-[0_0_8px_rgba(255,255,255,0.25)] animate-bounce [animation-delay:140ms] [animation-duration:900ms]" />
        <span className="h-4 w-1 rounded-full bg-cyan-200/95 shadow-[0_0_10px_rgba(103,232,249,0.35)] animate-bounce [animation-delay:280ms] [animation-duration:900ms]" />
        <span className="h-3 w-1 rounded-full bg-zinc-100/95 shadow-[0_0_8px_rgba(255,255,255,0.25)] animate-bounce [animation-delay:420ms] [animation-duration:900ms]" />
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-100/95">
        working...
      </span>
    </div>
  );
}

type SessionTaskState = "finished" | "waiting" | "thinking";
type SessionTaskRow = {
  sessionKey: string;
  taskPreview: string;
  taskUpdatedAt: string | null;
  ordinal: number;
  synthetic: boolean;
};

function isWaitingTaskPreview(taskPreview: string): boolean {
  const normalized = taskPreview.trim().toLowerCase();
  if (normalized === WAITING_FOR_NEW_TASK_LABEL.toLowerCase()) {
    return true;
  }
  return (
    normalized.startsWith("waiting") ||
    normalized.startsWith("awaiting") ||
    normalized.includes("waiting for") ||
    normalized.includes("wait for user") ||
    normalized.includes("waiting for user") ||
    normalized.includes("awaiting user")
  );
}

function resolveWaitingTaskHelperText(taskPreview: string): string | null {
  const normalized = taskPreview.trim().toLowerCase();
  if (normalized.includes("submit")) {
    return "Waiting for user to press submit.";
  }
  if (normalized.includes("email")) {
    return "Waiting for user email input.";
  }
  if (
    normalized.includes("input") ||
    normalized.includes("interrupt") ||
    normalized.includes("confirm")
  ) {
    return "Waiting for user input.";
  }
  return null;
}

function resolveSessionTaskState(taskPreview: string): SessionTaskState {
  const normalized = taskPreview.trim().toLowerCase();
  if (
    normalized === TASK_FINISHED_LABEL.toLowerCase() ||
    TASK_FINISHED_PREVIEW_RE.test(taskPreview.trim()) ||
    TASK_TERMINAL_ERROR_PREVIEW_RE.test(taskPreview.trim())
  ) {
    return "finished";
  }
  if (isWaitingTaskPreview(taskPreview)) {
    return "waiting";
  }
  return "thinking";
}

function resolveSessionTaskStateForRow(
  row: SessionTaskRow,
  {
    hasLiveCliSessions,
    latestThinkingTaskTimestampMs,
  }: {
    hasLiveCliSessions: boolean;
    latestThinkingTaskTimestampMs: number | null;
  },
): SessionTaskState {
  const baseState = resolveSessionTaskState(row.taskPreview);
  const rowTaskTimestampMs =
    row.taskUpdatedAt != null && Number.isFinite(Date.parse(row.taskUpdatedAt))
      ? Date.parse(row.taskUpdatedAt)
      : null;
  const hasFreshTaskTimestamp =
    rowTaskTimestampMs != null &&
    Date.now() - rowTaskTimestampMs <= STALE_SESSION_TASK_MS;
  if (baseState !== "thinking") {
    if (
      !hasLiveCliSessions &&
      !row.synthetic &&
      baseState === "waiting" &&
      !hasFreshTaskTimestamp
    ) {
      return "finished";
    }
    return baseState;
  }
  if (row.synthetic && isWaitingTaskPreview(row.taskPreview)) {
    return "waiting";
  }
  if (hasLiveCliSessions) {
    if (
      latestThinkingTaskTimestampMs != null &&
      rowTaskTimestampMs != null &&
      rowTaskTimestampMs < latestThinkingTaskTimestampMs
    ) {
      return "finished";
    }
    return "thinking";
  }
  return "finished";
}

function SessionTaskStatePill({
  taskPreview,
  className,
  stateOverride,
}: {
  taskPreview: string;
  className?: string;
  stateOverride?: SessionTaskState;
}) {
  const state = stateOverride ?? resolveSessionTaskState(taskPreview);
  if (state === "finished") {
    return <TaskFinishedPill className={className} />;
  }
  if (state === "waiting") {
    return <WaitingForTaskPill className={className} />;
  }
  return <ThinkingTaskPill className={className} />;
}

function formatSessionKeyLabel(sessionKey: string): string {
  const normalized = sessionKey.trim();
  if (normalized.length <= 18) {
    return normalized;
  }
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

const SESSION_TASK_ACCENT_CLASSES = [
  "from-cyan-300/90 to-cyan-500/85",
  "from-violet-300/90 to-violet-500/85",
  "from-emerald-300/90 to-emerald-500/85",
  "from-amber-300/90 to-amber-500/85",
  "from-pink-300/90 to-pink-500/85",
  "from-sky-300/90 to-sky-500/85",
] as const;

function resolveSessionTaskAccentClass(index: number): string {
  const paletteSize = SESSION_TASK_ACCENT_CLASSES.length;
  const normalizedIndex = Math.abs(index) % paletteSize;
  return SESSION_TASK_ACCENT_CLASSES[normalizedIndex];
}

function resolveSessionTaskPreview(
  taskPreview: string | null | undefined,
): string {
  const normalized = taskPreview?.trim();
  return normalized && normalized.length > 0
    ? normalized
    : WAITING_FOR_NEW_TASK_LABEL;
}

function normalizeNearZeroQuotaPercent(value: number): number {
  const clamped = Math.max(0, Math.min(100, value));
  if (clamped > 0 && clamped < NEAR_ZERO_QUOTA_PERCENT) {
    return 0;
  }
  return clamped;
}

function QuotaBar({
  label,
  percent,
  resetLabel,
  lastSeenLabel,
  lastSeenUpToDate = false,
  deactivated = false,
  isLive = false,
  telemetryPending = false,
  usageLimitHit = false,
  inTokenCard = false,
}: {
  label: string;
  percent: number | null;
  resetLabel: string;
  lastSeenLabel?: string | null;
  lastSeenUpToDate?: boolean;
  deactivated?: boolean;
  isLive?: boolean;
  telemetryPending?: boolean;
  usageLimitHit?: boolean;
  inTokenCard?: boolean;
}) {
  const clamped = percent === null ? 0 : normalizeNearZeroQuotaPercent(percent);
  const hasPercent = percent !== null;
  const tone = deactivated
    ? "deactivated"
    : !hasPercent
      ? "unknown"
      : clamped >= 70
        ? "healthy"
        : clamped >= 30
          ? "warning"
          : "critical";

  const percentPillClass = cn(
    "rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
    isLive &&
      !deactivated &&
      "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    tone === "healthy" &&
      "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    tone === "warning" &&
      "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300",
    tone === "critical" &&
      "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-300",
    tone === "deactivated" &&
      "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
    tone === "unknown" && "border-border/70 bg-muted/35 text-muted-foreground",
  );

  const fillClass = cn(
    "h-full rounded-full transition-[width,opacity] duration-500 ease-out",
    isLive && "duration-300",
    tone === "healthy" &&
      "bg-gradient-to-r from-emerald-500 via-emerald-400 to-cyan-400",
    tone === "warning" &&
      "bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-300",
    tone === "critical" &&
      "bg-gradient-to-r from-rose-600 via-red-500 to-orange-400",
    tone === "deactivated" &&
      "bg-gradient-to-r from-zinc-500/80 via-zinc-400/70 to-zinc-300/65 shadow-none",
    tone === "unknown" && "bg-muted-foreground/45",
  );

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border border-border/55 bg-background/20 px-2.5 py-2.5",
        inTokenCard && "border-white/10 bg-black/25",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          {isLive && !deactivated ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              Live
            </span>
          ) : null}
          <span className={percentPillClass}>
            {formatQuotaPercent(percent)}
          </span>
        </div>
      </div>
      <div
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full ring-1 ring-white/5",
          tone === "deactivated"
            ? "bg-zinc-500/10"
            : tone === "unknown"
              ? "bg-muted/40"
              : quotaBarTrack(clamped),
        )}
      >
        <div className={fillClass} style={{ width: `${clamped}%` }} />
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3 shrink-0" />
        <span>{resetLabel}</span>
      </div>
      <div className="min-h-[16px]">
        {isLive && !deactivated ? (
          usageLimitHit || telemetryPending ? (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-700 dark:text-cyan-300">
              <Activity className="h-3 w-3" />
              <span>
                {usageLimitHit ? "Usage limit hit" : "Telemetry pending"}
              </span>
            </div>
          ) : null
        ) : lastSeenLabel ? (
          <div
            className={cn(
              "text-[11px]",
              lastSeenUpToDate
                ? "font-medium text-emerald-600 dark:text-emerald-300"
                : "text-muted-foreground",
            )}
          >
            {lastSeenLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatQuotaPercent(value: number | null): string {
  if (value == null || Number.isNaN(value)) {
    return "--";
  }

  const clamped = normalizeNearZeroQuotaPercent(value);
  const rounded = Math.round(clamped);
  if (Math.abs(clamped - rounded) < 0.05) {
    return `${rounded}%`;
  }
  return `${clamped.toFixed(1)}%`;
}

function resolveLastSeenDisplay(label: string | null | undefined): {
  label: string | null;
  upToDate: boolean;
} {
  if (!label) {
    return { label: null, upToDate: false };
  }
  const normalized = label.trim().toLowerCase();
  const upToDate =
    normalized === "last seen now" || /\b0m ago$/.test(normalized);
  if (upToDate) {
    return { label: "Up to date", upToDate: true };
  }
  return { label, upToDate: false };
}

function hasExpiredRefreshTokenReason(
  reason: string | null | undefined,
): boolean {
  const normalized = reason?.trim().toLowerCase();
  if (!normalized || !normalized.includes("refresh token")) {
    return false;
  }
  return (
    normalized.includes("expired") ||
    normalized.includes("re-login required") ||
    normalized.includes("re-authentication") ||
    normalized.includes("reused") ||
    normalized.includes("revoked") ||
    normalized.includes("invalidated")
  );
}

function formatDebugPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return `${Math.round(value)}%`;
}

function formatDebugSource(source: string): string {
  const normalized = source.trim();
  if (!normalized) {
    return "unknown";
  }
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function normalizeDebugSnapshotName(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function scopeQuotaDebugSamplesToAccount(
  liveQuotaDebug: NonNullable<AccountSummary["liveQuotaDebug"]>,
  accountSnapshotName: string | null | undefined,
) {
  const targetSnapshot = normalizeDebugSnapshotName(accountSnapshotName);
  const rawSamples = liveQuotaDebug.rawSamples;
  if (!targetSnapshot) {
    return rawSamples;
  }

  const exactSnapshotMatch = rawSamples.filter(
    (sample) =>
      normalizeDebugSnapshotName(sample.snapshotName) === targetSnapshot,
  );
  if (exactSnapshotMatch.length > 0) {
    return exactSnapshotMatch;
  }

  const unnamedSamples = rawSamples.filter(
    (sample) => normalizeDebugSnapshotName(sample.snapshotName) == null,
  );
  if (unnamedSamples.length === 0) {
    return [];
  }

  const consideredSnapshots = (liveQuotaDebug.snapshotsConsidered ?? [])
    .map((value) => normalizeDebugSnapshotName(value))
    .filter((value): value is string => value != null);
  const consideredOnlyTarget =
    consideredSnapshots.length === 0 ||
    consideredSnapshots.every((snapshot) => snapshot === targetSnapshot);
  return consideredOnlyTarget ? unnamedSamples : [];
}

function buildQuotaDebugLogLines(
  liveQuotaDebug: NonNullable<AccountSummary["liveQuotaDebug"]>,
  accountSnapshotName: string | null | undefined,
  activeSnapshotName: string | null | undefined,
  accountId: string,
  mappedCliSessions: number,
  trackedCliSessions: number,
  displayedCliSessions: number,
  hasLiveSessionSignal: boolean,
  currentTaskPreview: string | null,
): string[] {
  const merged = liveQuotaDebug.merged;
  const scopedSamples = scopeQuotaDebugSamplesToAccount(
    liveQuotaDebug,
    accountSnapshotName,
  );
  const normalizedSnapshotName = accountSnapshotName?.trim() || "none";
  const normalizedActiveSnapshotName = activeSnapshotName?.trim() || "none";
  const normalizedCurrentTaskPreview = currentTaskPreview?.trim() || null;
  const selectedMatchesActive =
    normalizeDebugSnapshotName(normalizedSnapshotName) != null &&
    normalizeDebugSnapshotName(normalizedSnapshotName) ===
      normalizeDebugSnapshotName(normalizedActiveSnapshotName);
  const diagnosticOnly = liveQuotaDebug.overrideApplied !== true;
  const quotaSampledRows = scopedSamples.length;
  const liveSessionsWithoutQuotaRows = Math.max(
    mappedCliSessions - quotaSampledRows,
    0,
  );
  const lines: string[] = [
    `$ account=${accountId} snapshot=${normalizedSnapshotName}`,
    `$ cli_mapping selected_snapshot=${normalizedSnapshotName} active_snapshot=${normalizedActiveSnapshotName} match=${selectedMatchesActive ? "yes" : "no"}`,
    `$ cli_session_counts mapped=${mappedCliSessions} tracked=${trackedCliSessions} displayed=${displayedCliSessions} live_signal=${hasLiveSessionSignal ? "yes" : "no"}`,
    `$ merged 5h=${formatDebugPercent(merged?.primary?.remainingPercent)} weekly=${formatDebugPercent(merged?.secondary?.remainingPercent)}`,
    `$ override=${liveQuotaDebug.overrideReason ?? (liveQuotaDebug.overrideApplied ? "applied" : "none")}`,
    `$ attribution=${diagnosticOnly ? "diagnostic sample only (not attributed)" : "account-attributed override applied"}`,
    `$ flow=collect_cli_samples -> merge -> ${liveQuotaDebug.overrideApplied ? "apply_override" : "no_override"}`,
    `$ mapped_cli_sessions=${mappedCliSessions} quota_sampled_rows=${quotaSampledRows}`,
  ];

  if (liveSessionsWithoutQuotaRows > 0) {
    lines.push(
      `$ live_sessions_without_quota_rows=${liveSessionsWithoutQuotaRows}`,
    );
    if (
      hasLiveSessionSignal &&
      (normalizedCurrentTaskPreview == null ||
        normalizedCurrentTaskPreview === WAITING_FOR_NEW_TASK_LABEL)
    ) {
      lines.push("$ task_preview_state=waiting_for_new_task");
    }
  }

  if (liveQuotaDebug.snapshotsConsidered.length > 0) {
    lines.push(`$ snapshots=${liveQuotaDebug.snapshotsConsidered.join(", ")}`);
  }

  if (quotaSampledRows === 0) {
    lines.push(
      mappedCliSessions > 0
        ? "$ no quota-bearing cli samples"
        : "$ no cli sessions sampled",
    );
    return lines;
  }

  scopedSamples.slice(0, 24).forEach((sample, index) => {
    const staleSuffix = sample.stale ? " stale=true" : "";
    const snapshotSuffix = sample.snapshotName
      ? ` snapshot=${sample.snapshotName}`
      : "";
    const mappingSuffix = diagnosticOnly
      ? " mapping=diagnostic-only"
      : " mapping=snapshot-scoped-sample";
    lines.push(
      `$ cli-sample#${index + 1} src=${formatDebugSource(sample.source)} 5h=${formatDebugPercent(sample.primary?.remainingPercent)} weekly=${formatDebugPercent(sample.secondary?.remainingPercent)}${snapshotSuffix}${mappingSuffix}${staleSuffix}`,
    );
  });
  return lines;
}

function buildSessionTaskLogLines({
  accountId,
  row,
  state,
  quotaDebugLogText,
}: {
  accountId: string;
  row: SessionTaskRow;
  state: SessionTaskState;
  quotaDebugLogText: string | null;
}): string[] {
  const lines: string[] = [
    `$ account=${accountId}`,
    `$ session=${row.sessionKey}`,
    `$ state=${state}`,
    `$ task_updated_at=${row.taskUpdatedAt ?? "unknown"}`,
    `$ task_preview=${row.taskPreview}`,
  ];
  if (!quotaDebugLogText) {
    lines.push("$ debug=unavailable");
    return lines;
  }
  const debugLines = quotaDebugLogText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const scopedLines = debugLines.filter((line) =>
    line.includes(row.sessionKey),
  );
  if (scopedLines.length > 0) {
    lines.push(...scopedLines.slice(0, 16));
    return lines;
  }
  lines.push("$ scoped_logs=not_found_for_session");
  lines.push(
    ...debugLines
      .filter(
        (line) =>
          line.startsWith("$ cli_session_counts") ||
          line.startsWith("$ mapped_cli_sessions") ||
          line.startsWith("$ live_sessions_without_quota_rows"),
      )
      .slice(0, 4),
  );
  return lines;
}

function isLiveUsageLimitHit(input: {
  status: string;
  hasLiveSession: boolean;
  primaryRemainingPercent: number | null;
}): boolean {
  if (input.status === "rate_limited" || input.status === "quota_exceeded") {
    return true;
  }
  if (!input.hasLiveSession || input.primaryRemainingPercent == null) {
    return false;
  }
  return normalizeNearZeroQuotaPercent(input.primaryRemainingPercent) <= 0;
}

function formatLimitHitCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function AccountCard(props: AccountCardProps) {
  const {
    account,
    tokensUsed = null,
    showTokensRemaining = false,
    showAccountId = false,
    showIdleCodexStatusPanel = true,
    useLocalBusy = false,
    deleteBusy = false,
    initialSessionTasksCollapsed = false,
    disableSecondaryActions = false,
    forceWorkingIndicator = false,
    hideCurrentTaskPreview = false,
    taskPanelAddon,
    primaryActionLabel = "Use this account",
    primaryActionAriaLabel,
    onAction,
  } = props;
  const tokensRemaining = props.tokensRemaining ?? null;
  const hasExplicitUnknownTokensRemaining =
    showTokensRemaining &&
    Object.prototype.hasOwnProperty.call(props, "tokensRemaining") &&
    props.tokensRemaining == null;
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const [sessionTasksCollapsed, setSessionTasksCollapsed] = useState(
    initialSessionTasksCollapsed,
  );
  const [expandedSessionLogRowKey, setExpandedSessionLogRowKey] = useState<
    string | null
  >(null);
  const [expandedTaskPreviewKeys, setExpandedTaskPreviewKeys] = useState<
    string[]
  >([]);
  const isTaskPreviewExpanded = (key: string) =>
    expandedTaskPreviewKeys.includes(key);
  const toggleTaskPreviewExpanded = (key: string) => {
    setExpandedTaskPreviewKeys((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key],
    );
  };
  const navigate = useNavigate();
  const liveQuotaDebug = account.liveQuotaDebug ?? null;
  const quotaDisplayAccountKey = buildQuotaDisplayAccountKey(account);
  const mergedPrimaryRemainingPercent = getMergedQuotaRemainingPercent(
    account,
    "primary",
  );
  const mergedSecondaryRemainingPercent = getMergedQuotaRemainingPercent(
    account,
    "secondary",
  );
  const deferredPrimaryQuotaFallback = getRawQuotaWindowFallback(
    account,
    "primary",
  );
  const deferredSecondaryQuotaFallback = getRawQuotaWindowFallback(
    account,
    "secondary",
  );
  const hasLivePrimaryQuotaTelemetrySource =
    mergedPrimaryRemainingPercent != null ||
    deferredPrimaryQuotaFallback != null;
  const hasLiveSecondaryQuotaTelemetrySource =
    mergedSecondaryRemainingPercent != null ||
    deferredSecondaryQuotaFallback != null;
  const freshDebugRawSampleCount = getFreshDebugRawSampleCount(account, nowMs);
  const blurred = usePrivacyStore((s) => s.blurred);
  const isActiveSnapshot = account.codexAuth?.isActiveSnapshot ?? false;
  const hasLiveSession = hasFreshLiveTelemetry(account, nowMs);
  const hasActiveCliSession = hasActiveCliSessionSignal(account, nowMs);
  const recentUsageSignal =
    (account.codexAuth?.hasSnapshot ?? false) &&
    hasRecentUsageSignal(account, nowMs);
  const isWorkingNow = isAccountWorkingNow(account, nowMs);
  const usageLimitHitCountdownMs = getWorkingNowUsageLimitHitCountdownMs(
    account,
    nowMs,
  );
  const usageLimitHitCountdownLabel =
    usageLimitHitCountdownMs != null && usageLimitHitCountdownMs > 0
      ? formatLimitHitCountdown(usageLimitHitCountdownMs)
      : null;
  const effectiveStatus = resolveEffectiveAccountStatus({
    status: account.status,
    hasSnapshot: account.codexAuth?.hasSnapshot,
    isActiveSnapshot,
    hasLiveSession: hasActiveCliSession,
    hasRecentUsageSignal: recentUsageSignal,
    allowDeactivatedOverride: isWorkingNow,
  });
  const primaryRemainingRaw =
    mergedPrimaryRemainingPercent ??
    selectStableRemainingPercent({
      fallbackRemainingPercent: deferredPrimaryQuotaFallback?.remainingPercent,
      fallbackResetAt: deferredPrimaryQuotaFallback?.resetAt,
      baselineRemainingPercent: account.usage?.primaryRemainingPercent,
      baselineResetAt: account.resetAtPrimary,
    });
  const secondaryRemainingRaw =
    mergedSecondaryRemainingPercent ??
    selectStableRemainingPercent({
      fallbackRemainingPercent:
        deferredSecondaryQuotaFallback?.remainingPercent,
      fallbackResetAt: deferredSecondaryQuotaFallback?.resetAt,
      baselineRemainingPercent: account.usage?.secondaryRemainingPercent,
      baselineResetAt: account.resetAtSecondary,
    });
  const primaryLastRecordedAt =
    deferredPrimaryQuotaFallback?.recordedAt ??
    account.lastUsageRecordedAtPrimary ??
    null;
  const secondaryLastRecordedAt =
    deferredSecondaryQuotaFallback?.recordedAt ??
    account.lastUsageRecordedAtSecondary ??
    null;
  const primaryResetAt =
    deferredPrimaryQuotaFallback?.resetAt ?? account.resetAtPrimary ?? null;
  const secondaryResetAt =
    deferredSecondaryQuotaFallback?.resetAt ?? account.resetAtSecondary ?? null;
  const primaryWindowMinutes =
    deferredPrimaryQuotaFallback?.windowMinutes ??
    account.windowMinutesPrimary ??
    null;
  const primaryTelemetryFresh = isFreshQuotaTelemetryTimestamp(
    primaryLastRecordedAt,
  );
  const secondaryTelemetryFresh = isFreshQuotaTelemetryTimestamp(
    secondaryLastRecordedAt,
  );
  const hasTelemetrySignal =
    freshDebugRawSampleCount > 0 ||
    primaryLastRecordedAt !== null ||
    secondaryLastRecordedAt !== null;
  const primaryTelemetryPending =
    hasLiveSession &&
    hasTelemetrySignal &&
    !primaryTelemetryFresh &&
    primaryRemainingRaw == null;
  const secondaryTelemetryPending =
    hasLiveSession &&
    hasTelemetrySignal &&
    !secondaryTelemetryFresh &&
    secondaryRemainingRaw == null;
  const primaryRemaining = normalizeRemainingPercentForDisplay({
    accountKey: quotaDisplayAccountKey,
    windowKey: "primary",
    remainingPercent: primaryRemainingRaw,
    resetAt: primaryResetAt,
    hasLiveSession: hasLiveSession && hasLivePrimaryQuotaTelemetrySource,
    lastRecordedAt: primaryLastRecordedAt,
    applyCycleFloor: mergedPrimaryRemainingPercent == null,
  });
  const secondaryRemaining = normalizeRemainingPercentForDisplay({
    accountKey: quotaDisplayAccountKey,
    windowKey: "secondary",
    remainingPercent: secondaryRemainingRaw,
    resetAt: secondaryResetAt,
    hasLiveSession: hasLiveSession && hasLiveSecondaryQuotaTelemetrySource,
    lastRecordedAt: secondaryLastRecordedAt,
    applyCycleFloor: mergedSecondaryRemainingPercent == null,
  });
  const weeklyOnly =
    account.windowMinutesPrimary == null &&
    account.windowMinutesSecondary != null;
  const codexOnlyQuotaStatusUnknown =
    isCodexOnlyPlanType(account.planType) &&
    !hasLiveSession &&
    primaryRemainingRaw == null &&
    secondaryRemainingRaw == null;
  const usageLimitHit = isLiveUsageLimitHit({
    status: account.status,
    hasLiveSession,
    primaryRemainingPercent: primaryRemaining,
  });
  const remainingTokensValue = tokensRemaining ?? 0;
  const hasRemainingTokensExhausted =
    showTokensRemaining &&
    !hasExplicitUnknownTokensRemaining &&
    remainingTokensValue <= 0;
  const useLocalBlockedByWeeklyQuota =
    typeof secondaryRemaining === "number" &&
    normalizeNearZeroQuotaPercent(secondaryRemaining) < 1;
  const useLocalBlockedByPrimaryQuota =
    !weeklyOnly &&
    typeof primaryRemaining === "number" &&
    normalizeNearZeroQuotaPercent(primaryRemaining) < 1;
  const showUsageLimitHitBadge =
    usageLimitHit ||
    hasRemainingTokensExhausted ||
    useLocalBlockedByPrimaryQuota;
  const showWeeklyUsageLimitDetailBadge = useLocalBlockedByWeeklyQuota;
  const showLimitTint =
    showUsageLimitHitBadge || showWeeklyUsageLimitDetailBadge;
  const showUsageLimitGraceOverlay = Boolean(
    usageLimitHit &&
    usageLimitHitCountdownMs != null &&
    usageLimitHitCountdownMs > 0,
  );
  const hasExpiredRefreshToken =
    account.auth?.refresh?.state === "expired" ||
    hasExpiredRefreshTokenReason(account.deactivationReason);
  const status =
    usageLimitHit && effectiveStatus === "active" ? "limited" : effectiveStatus;
  const canUseLocally = canUseLocalAccount({
    status: account.status,
    primaryRemainingPercent: primaryRemaining,
    secondaryRemainingPercent: secondaryRemaining,
    hasSnapshot: account.codexAuth?.hasSnapshot,
    isActiveSnapshot,
    hasLiveSession: hasActiveCliSession,
    hasRecentUsageSignal: recentUsageSignal,
    codexSessionCount: account.codexSessionCount,
  });
  const useLocalDisabledReason = getUseLocalAccountDisabledReason({
    status: account.status,
    primaryRemainingPercent: primaryRemaining,
    secondaryRemainingPercent: secondaryRemaining,
    hasSnapshot: account.codexAuth?.hasSnapshot,
    isActiveSnapshot,
    hasLiveSession: hasActiveCliSession,
    hasRecentUsageSignal: recentUsageSignal,
    codexSessionCount: account.codexSessionCount,
  });
  const useLocalButtonDisabled =
    !canUseLocally || useLocalBusy || useLocalBlockedByWeeklyQuota;
  const useLocalButtonShowsSuccess = isActiveSnapshot || useLocalBusy;
  const shouldShowCurrentUseLabel = isActiveSnapshot;
  const resolvedPrimaryActionLabel = shouldShowCurrentUseLabel
    ? "Currently used"
    : primaryActionLabel;
  const useLocalButtonDisabledReason = useLocalBlockedByWeeklyQuota
    ? "Weekly quota shown as 0%."
    : useLocalDisabledReason;
  const handleUnlock = () => {
    if (onAction) {
      onAction(account, "reauth");
      return;
    }

    const selectedAccountId = encodeURIComponent(account.accountId);
    const unlockTarget = `/accounts?selected=${selectedAccountId}&oauth=prompt`;
    if (typeof window !== "undefined") {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      if (currentPath === unlockTarget) {
        return;
      }
    }
    navigate(unlockTarget);
  };

  const primaryReset = formatQuotaResetLabel(primaryResetAt);
  const secondaryReset = formatQuotaResetLabel(secondaryResetAt);
  const primaryWindowLabel = formatWindowLabel("primary", primaryWindowMinutes);
  const isDeactivated = status === "deactivated";
  const primaryLastSeen = formatLastUsageLabel(primaryLastRecordedAt);
  const secondaryLastSeen = formatLastUsageLabel(secondaryLastRecordedAt);
  const primaryLastSeenDisplay = resolveLastSeenDisplay(primaryLastSeen);
  const secondaryLastSeenDisplay = resolveLastSeenDisplay(secondaryLastSeen);
  const stalePrimaryLastSeen = !hasLiveSession
    ? primaryLastSeenDisplay
    : { label: null, upToDate: false };
  const staleSecondaryLastSeen = !hasLiveSession
    ? secondaryLastSeenDisplay
    : { label: null, upToDate: false };
  const weeklyFallbackStateLabel =
    codexOnlyQuotaStatusUnknown && !staleSecondaryLastSeen.label
      ? `Last known: ${STATUS_LABELS[status] ?? status}`
      : null;
  const showPrimaryQuotaBar = !weeklyOnly && !codexOnlyQuotaStatusUnknown;
  const title = account.displayName || account.email;
  const compactId = formatCompactAccountId(account.accountId);
  const planWithSnapshot = formatPlanWithSnapshot(
    account.planType,
    account.codexAuth?.snapshotName,
  );
  const { planLabel, snapshotLabel, snapshotIsEmail } = getPlanSnapshotDetails(
    account.planType,
    account.codexAuth?.snapshotName,
  );
  const showCodexOnlyAccountSubtitle = isCodexOnlyPlanType(account.planType);
  const codexOnlyEmailLabel = snapshotIsEmail
    ? snapshotLabel
    : (account.email?.trim() ?? null);
  const codexOnlyEmailIsSensitive = isLikelyEmailValue(codexOnlyEmailLabel);
  const accountIdentityLabel = title.trim();
  const accountIdentityIsSensitive = isLikelyEmailValue(accountIdentityLabel);
  const snapshotName = account.codexAuth?.snapshotName?.trim() ?? null;
  const hasResolvedSnapshot = Boolean(snapshotName);
  const showMissingSnapshotLockOverlay = !hasResolvedSnapshot;
  const expectedSnapshotName =
    account.codexAuth?.expectedSnapshotName?.trim() ?? null;
  const hasSnapshotMismatch = Boolean(
    snapshotName &&
    expectedSnapshotName &&
    snapshotName !== expectedSnapshotName,
  );
  const tokenMetricLabel = showTokensRemaining
    ? "Tokens remaining"
    : "Tokens used";
  const tokenMetricValueRaw = showTokensRemaining
    ? remainingTokensValue
    : (tokensUsed ?? account.requestUsage?.totalTokens ?? 0);
  const hasFreshQuotaTelemetryHint =
    freshDebugRawSampleCount > 0 ||
    primaryTelemetryFresh ||
    secondaryTelemetryFresh;
  const tokenMetricValue = hasExplicitUnknownTokensRemaining
    ? hasLiveSession && hasFreshQuotaTelemetryHint
      ? UNKNOWN_TOKENS_SYNC_LABEL
      : "--"
    : isWorkingNow
      ? formatTokenUsagePrecise(tokenMetricValueRaw)
      : formatTokenUsageCompact(tokenMetricValueRaw);
  const hasRuntimeLiveSessionSignal =
    hasLiveSession ||
    (account.codexAuth?.hasLiveSession ?? false) ||
    Math.max(account.codexLiveSessionCount ?? 0, 0) > 0;
  const codexLiveSessionCountRaw = Math.max(
    account.codexLiveSessionCount ?? 0,
    0,
  );
  const codexLiveSessionCount = hasActiveCliSession
    ? hasRuntimeLiveSessionSignal
      ? Math.max(codexLiveSessionCountRaw, 1)
      : codexLiveSessionCountRaw
    : 0;
  const codexTrackedSessionCount = Math.max(
    account.codexTrackedSessionCount ?? 0,
    0,
  );
  const hasSessionInventory =
    codexLiveSessionCount > 0 || codexTrackedSessionCount > 0;
  const usageLimitHitGraceExpired = Boolean(
    usageLimitHit &&
    usageLimitHitCountdownMs != null &&
    usageLimitHitCountdownMs <= 0,
  );
  const rawCodexCurrentTaskPreview = usageLimitHitGraceExpired
    ? isWorkingNow
      ? account.codexCurrentTaskPreview?.trim() || null
      : null
    : account.codexCurrentTaskPreview?.trim() || null;
  const codexLastTaskPreview = account.codexLastTaskPreview?.trim() || null;
  const sessionTaskPreviews = useMemo(() => {
    const resolveTimestamp = (
      value: string | null | undefined,
    ): number | null => {
      if (!value) {
        return null;
      }
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) ? timestamp : null;
    };

    const dedupedBySessionKey = new Map<
      string,
      {
        sessionKey: string;
        taskPreview: string;
        taskUpdatedAt: string | null;
        sourceIndex: number;
      }
    >();

    for (const [index, preview] of (
      account.codexSessionTaskPreviews ?? []
    ).entries()) {
      const sessionKey = preview.sessionKey?.trim();
      if (!sessionKey) {
        continue;
      }
      const candidate = {
        sessionKey,
        taskPreview: resolveSessionTaskPreview(preview.taskPreview),
        taskUpdatedAt: preview.taskUpdatedAt ?? null,
        sourceIndex: index,
      };
      const existing = dedupedBySessionKey.get(sessionKey);
      if (!existing) {
        dedupedBySessionKey.set(sessionKey, candidate);
        continue;
      }

      const existingTimestamp = resolveTimestamp(existing.taskUpdatedAt);
      const candidateTimestamp = resolveTimestamp(candidate.taskUpdatedAt);
      const shouldReplace =
        candidateTimestamp != null
          ? existingTimestamp == null ||
            candidateTimestamp > existingTimestamp ||
            (candidateTimestamp === existingTimestamp &&
              candidate.sourceIndex > existing.sourceIndex)
          : existingTimestamp == null &&
            candidate.sourceIndex > existing.sourceIndex;
      if (shouldReplace) {
        dedupedBySessionKey.set(sessionKey, candidate);
      }
    }

    const normalized = Array.from(dedupedBySessionKey.values()).map(
      ({ sessionKey, taskPreview, taskUpdatedAt }) => ({
        sessionKey,
        taskPreview,
        taskUpdatedAt,
      }),
    );
    if (
      codexLiveSessionCount <= 0 ||
      normalized.length <= codexLiveSessionCount
    ) {
      return normalized;
    }

    const toTimestamp = (value: string | null): number => {
      if (!value) {
        return Number.NEGATIVE_INFINITY;
      }
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
    };

    return [...normalized]
      .sort((left, right) => {
        const leftWaiting = isWaitingTaskPreview(left.taskPreview);
        const rightWaiting = isWaitingTaskPreview(right.taskPreview);
        if (leftWaiting !== rightWaiting) {
          return leftWaiting ? -1 : 1;
        }

        const timestampDelta =
          toTimestamp(right.taskUpdatedAt) - toTimestamp(left.taskUpdatedAt);
        if (timestampDelta !== 0) {
          return timestampDelta;
        }
        return left.sessionKey.localeCompare(right.sessionKey);
      })
      .slice(0, codexLiveSessionCount);
  }, [account.codexSessionTaskPreviews, codexLiveSessionCount]);
  const codexCurrentTaskPreview = useMemo(() => {
    if (
      rawCodexCurrentTaskPreview == null ||
      isWaitingTaskPreview(rawCodexCurrentTaskPreview) ||
      codexLiveSessionCount <= 0 ||
      sessionTaskPreviews.length === 0
    ) {
      return rawCodexCurrentTaskPreview;
    }

    const waitingPreviewCount = sessionTaskPreviews.filter((preview) =>
      isWaitingTaskPreview(preview.taskPreview),
    ).length;
    if (waitingPreviewCount >= codexLiveSessionCount) {
      return hasRalplanTaskMarker(rawCodexCurrentTaskPreview)
        ? rawCodexCurrentTaskPreview
        : null;
    }

    return rawCodexCurrentTaskPreview;
  }, [codexLiveSessionCount, rawCodexCurrentTaskPreview, sessionTaskPreviews]);
  const effectiveCurrentTaskPreview =
    codexCurrentTaskPreview ??
    (hasActiveCliSession && codexLiveSessionCount > 0
      ? WAITING_FOR_NEW_TASK_LABEL
      : null);
  const showLastTaskPreview =
    codexLastTaskPreview != null &&
    codexLastTaskPreview !== WAITING_FOR_NEW_TASK_LABEL &&
    codexLastTaskPreview !== effectiveCurrentTaskPreview;
  const displayCurrentTaskPreview = effectiveCurrentTaskPreview;
  const lastTaskPreviewExcerpt = codexLastTaskPreview
    ? getTaskPreviewExcerpt(codexLastTaskPreview)
    : null;
  const lastTaskPreviewExpanded = isTaskPreviewExpanded(
    LAST_TASK_PREVIEW_EXPANSION_KEY,
  );
  const displayLastTaskPreviewText =
    lastTaskPreviewExcerpt?.truncated && !lastTaskPreviewExpanded
      ? lastTaskPreviewExcerpt.text
      : codexLastTaskPreview;
  const isCurrentTaskWaiting = displayCurrentTaskPreview
    ? isWaitingTaskPreview(displayCurrentTaskPreview)
    : false;
  const currentNonWaitingTaskPreview =
    codexCurrentTaskPreview && !isWaitingTaskPreview(codexCurrentTaskPreview)
      ? codexCurrentTaskPreview
      : null;
  const waitingTaskPillLabel = resolveWaitingTaskPillLabel(
    displayCurrentTaskPreview,
  );
  const newestNonWaitingSessionTaskPreview = useMemo(() => {
    let fallbackPreview: string | null = null;
    let newestPreview: string | null = null;
    let newestTimestamp = Number.NEGATIVE_INFINITY;

    for (const preview of sessionTaskPreviews) {
      const normalizedPreview = preview.taskPreview.trim();
      if (!normalizedPreview || isWaitingTaskPreview(normalizedPreview)) {
        continue;
      }
      fallbackPreview ??= normalizedPreview;
      const timestamp = preview.taskUpdatedAt
        ? Date.parse(preview.taskUpdatedAt)
        : Number.NaN;
      if (Number.isFinite(timestamp) && timestamp >= newestTimestamp) {
        newestTimestamp = timestamp;
        newestPreview = normalizedPreview;
      }
    }

    return newestPreview ?? fallbackPreview;
  }, [sessionTaskPreviews]);
  const selectedTaskContextPreview =
    currentNonWaitingTaskPreview ??
    newestNonWaitingSessionTaskPreview ??
    (codexLastTaskPreview && !isWaitingTaskPreview(codexLastTaskPreview)
      ? codexLastTaskPreview
      : null);
  const hasRalplanSessionTaskContext = hasRalplanTaskMarker(
    newestNonWaitingSessionTaskPreview,
  );
  const isRalplanTaskContext = currentNonWaitingTaskPreview
    ? hasRalplanTaskMarker(currentNonWaitingTaskPreview)
    : hasRalplanSessionTaskContext ||
      hasRalplanTaskMarker(codexLastTaskPreview);
  const newestPromptForAgentPanel =
    selectedTaskContextPreview ??
    codexCurrentTaskPreview ??
    codexLastTaskPreview ??
    (codexLiveSessionCount > 0
      ? WAITING_FOR_NEW_TASK_LABEL
      : "No prompt reported yet");
  const showRalplanPlanningGraph =
    !hideCurrentTaskPreview &&
    isWorkingNow &&
    codexLiveSessionCount > 0 &&
    isRalplanTaskContext;
  const canShowIdleCodexStatus = status !== "deactivated";
  const showCodexActiveAgentCard =
    !hideCurrentTaskPreview &&
    (isWorkingNow || (canShowIdleCodexStatus && showIdleCodexStatusPanel)) &&
    !showRalplanPlanningGraph;
  const promptDrivenOmxPlanningActiveNodeKey = resolveOmxPlanningActiveNodeKey(
    newestPromptForAgentPanel,
  );
  const hideTaskContainerChrome =
    hideCurrentTaskPreview && Boolean(taskPanelAddon);
  const sessionTaskRows = useMemo(() => {
    const rows: SessionTaskRow[] = sessionTaskPreviews.map(
      (preview, index) => ({
        ...preview,
        ordinal: index + 1,
        synthetic: false,
      }),
    );
    const targetCount = Math.max(codexLiveSessionCount, rows.length);
    const fallbackCurrentTaskPreview = codexCurrentTaskPreview?.trim() || null;
    const fallbackLastTaskPreview = codexLastTaskPreview?.trim() || null;
    const fallbackSessionTaskPreview =
      fallbackCurrentTaskPreview &&
      !isWaitingTaskPreview(fallbackCurrentTaskPreview)
        ? fallbackCurrentTaskPreview
        : fallbackLastTaskPreview &&
            !isWaitingTaskPreview(fallbackLastTaskPreview)
          ? fallbackLastTaskPreview
          : null;
    if (rows.length === 0 && targetCount > 0 && fallbackSessionTaskPreview) {
      rows.push({
        sessionKey: "live-session-1",
        taskPreview: fallbackSessionTaskPreview,
        taskUpdatedAt:
          account.lastUsageRecordedAtPrimary ??
          account.lastUsageRecordedAtSecondary ??
          null,
        ordinal: 1,
        synthetic: true,
      });
    }
    for (let index = rows.length; index < targetCount; index += 1) {
      rows.push({
        sessionKey: `live-session-${index + 1}`,
        taskPreview: WAITING_FOR_NEW_TASK_LABEL,
        taskUpdatedAt: null,
        ordinal: index + 1,
        synthetic: true,
      });
    }
    return rows;
  }, [
    account.lastUsageRecordedAtPrimary,
    account.lastUsageRecordedAtSecondary,
    codexCurrentTaskPreview,
    codexLastTaskPreview,
    codexLiveSessionCount,
    sessionTaskPreviews,
  ]);
  const hasSessionTaskRows = sessionTaskRows.length > 0;
  const shouldRenderTaskPanel =
    showRalplanPlanningGraph ||
    showCodexActiveAgentCard ||
    Boolean(taskPanelAddon) ||
    showLastTaskPreview ||
    hasSessionTaskRows;
  const hasTaskPanelTopContent =
    showRalplanPlanningGraph ||
    showCodexActiveAgentCard ||
    Boolean(taskPanelAddon);
  const hasLiveCliSessions = codexLiveSessionCount > 0;
  const latestThinkingTaskTimestampMs = useMemo(() => {
    let latest: number | null = null;
    for (const row of sessionTaskRows) {
      if (resolveSessionTaskState(row.taskPreview) !== "thinking") {
        continue;
      }
      if (
        row.taskUpdatedAt == null ||
        !Number.isFinite(Date.parse(row.taskUpdatedAt))
      ) {
        continue;
      }
      const taskTimestamp = Date.parse(row.taskUpdatedAt);
      if (latest == null || taskTimestamp > latest) {
        latest = taskTimestamp;
      }
    }
    return latest;
  }, [sessionTaskRows]);
  const sessionTaskStates = useMemo(
    () =>
      sessionTaskRows.map((row) =>
        resolveSessionTaskStateForRow(row, {
          hasLiveCliSessions,
          latestThinkingTaskTimestampMs,
        }),
      ),
    [hasLiveCliSessions, latestThinkingTaskTimestampMs, sessionTaskRows],
  );
  const hasThinkingSessionTaskPreview = sessionTaskStates.some(
    (state) => state === "thinking",
  );
  const showWorkingIndicator =
    forceWorkingIndicator ||
    hasThinkingSessionTaskPreview ||
    (isWorkingNow && !isCurrentTaskWaiting);
  const showWaitingForTaskIndicator =
    !showWorkingIndicator && isWorkingNow && isCurrentTaskWaiting;
  const sessionTaskSummary = useMemo(() => {
    const waitingCount = sessionTaskStates.filter(
      (state) => state === "waiting",
    ).length;
    const finishedCount = sessionTaskStates.filter(
      (state) => state === "finished",
    ).length;
    const thinkingCount = sessionTaskStates.filter(
      (state) => state === "thinking",
    ).length;
    const assignedCount = Math.max(sessionTaskStates.length - waitingCount, 0);
    return {
      waitingCount,
      finishedCount,
      thinkingCount,
      assignedCount,
    };
  }, [sessionTaskStates]);
  const omxPlanningCliRuntimeState: OmxCliRuntimeState = useMemo(() => {
    if (sessionTaskSummary.thinkingCount > 0) {
      return "thinking";
    }
    if (sessionTaskSummary.waitingCount > 0) {
      return "waiting";
    }
    if (sessionTaskSummary.finishedCount > 0) {
      return "finished";
    }
    if (showWorkingIndicator) {
      return "thinking";
    }
    if (isCurrentTaskWaiting) {
      return "waiting";
    }
    return "finished";
  }, [
    isCurrentTaskWaiting,
    sessionTaskSummary.finishedCount,
    sessionTaskSummary.thinkingCount,
    sessionTaskSummary.waitingCount,
    showWorkingIndicator,
  ]);
  const codexActiveCardCliRuntimeState: OmxCliRuntimeState = isWorkingNow
    ? omxPlanningCliRuntimeState
    : "waiting";
  const omxPlanningActiveNodeKey: OmxPlanningNodeKey = useMemo(() => {
    if (omxPlanningCliRuntimeState === "waiting") {
      return "planner";
    }
    return promptDrivenOmxPlanningActiveNodeKey;
  }, [omxPlanningCliRuntimeState, promptDrivenOmxPlanningActiveNodeKey]);
  const activeOmxPlanningLogLabel = showRalplanPlanningGraph
    ? OMX_PLANNING_NODE_LOG_LABELS[omxPlanningActiveNodeKey]
    : null;
  const quotaDebugLogText = liveQuotaDebug
    ? buildQuotaDebugLogLines(
        liveQuotaDebug,
        account.codexAuth?.snapshotName ?? null,
        account.codexAuth?.activeSnapshotName ?? null,
        account.accountId,
        codexLiveSessionCountRaw,
        codexTrackedSessionCount,
        codexLiveSessionCount,
        Boolean(account.codexAuth?.hasLiveSession),
        effectiveCurrentTaskPreview,
      ).join("\n")
    : "";
  const lockedAccountIdentity =
    account.email?.trim() || account.displayName?.trim() || title.trim();
  const lockedAccountIdentityBlurred =
    blurred && isLikelyEmailValue(lockedAccountIdentity);
  const tokenCardPrimaryLine = tokenMetricValue;
  const tokenCardSecondaryLine = String(codexLiveSessionCount);
  const tokenMetricLooksNumeric = /^[\d,.]+(?:[kmbt])?$/i.test(
    tokenMetricValue,
  );
  const accessibleTokenMetricValue =
    tokenMetricValue === "--"
      ? "unknown"
      : tokenMetricLooksNumeric && tokenMetricValue !== "0"
        ? `${tokenMetricValue} tokens`
        : tokenMetricValue;
  const accessibleCodexSessionValue =
    codexLiveSessionCount <= 1
      ? String(codexLiveSessionCount)
      : `${codexLiveSessionCount} sessions`;
  const idSuffix = showAccountId ? ` | ID ${compactId}` : "";
  const isOmxBoosted = Boolean(account.codexAuth?.isOmxBoosted);
  const primaryCliSessionKey = useMemo(
    () => sessionTaskRows.find((row) => !row.synthetic)?.sessionKey ?? null,
    [sessionTaskRows],
  );
  const openCodexLogsView = () => {
    const focusSessionKey = primaryCliSessionKey ?? undefined;
    const context = focusSessionKey
      ? { focusSessionKey, source: "watch-logs" as const }
      : undefined;
    if (onAction) {
      onAction(account, "sessions", context);
      return;
    }

    const searchParams = new URLSearchParams({
      accountId: account.accountId,
    });
    if (focusSessionKey) {
      searchParams.set("sessionKey", focusSessionKey);
      searchParams.set("view", "watch");
    }
    navigate(`/sessions?${searchParams.toString()}`);
  };
  const tokenCardStatusClass = cn(
    "h-7 gap-1.5 rounded-full border px-3 text-[11px] font-semibold tracking-[0.02em] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
    status === "active" &&
      "border-emerald-500/35 bg-emerald-500/14 text-emerald-300",
    status === "paused" && "border-amber-500/35 bg-amber-500/14 text-amber-200",
    status === "limited" &&
      "border-orange-500/35 bg-orange-500/14 text-orange-200",
    status === "exceeded" && "border-red-500/35 bg-red-500/14 text-red-200",
    status === "deactivated" &&
      "border-zinc-500/35 bg-zinc-500/14 text-zinc-300",
  );
  const hideLiveTaskAndStatusBadges = showWeeklyUsageLimitDetailBadge;
  const tokenCardLiveLabel = hasLiveSession ? "Live token card" : "Token card";
  return (
    <div className="relative">
      <div
        className={cn(
          (showUsageLimitGraceOverlay || showMissingSnapshotLockOverlay) &&
            "blur-[1.5px] saturate-[0.82]",
        )}
      >
        <div
          className={cn(
            "card-hover relative overflow-hidden rounded-[18px] border border-white/10 bg-[#060A13] px-3.5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_42px_rgba(0,0,0,0.58)]",
            showLimitTint && "border-red-500/40",
          )}
        >
          <div className="relative">
            <div className="mb-2 flex items-start justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-200/90">
              <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5 text-zinc-100">
                <img
                  src="/openai.svg"
                  alt=""
                  className="h-3.5 w-3.5 opacity-80 brightness-0 invert"
                  aria-hidden
                />
                <span>OpenAI</span>
                <span
                  className="shrink-0 text-[9px] tracking-[0.18em] text-zinc-300/80"
                  data-testid="token-card-label"
                >
                  {tokenCardLiveLabel}
                </span>
              </span>

              <div
                className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 pl-2"
                data-testid="token-card-badge-row"
              >
                {!hideLiveTaskAndStatusBadges ? (
                  <Badge variant="outline" className={tokenCardStatusClass}>
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-current"
                      aria-hidden
                    />
                    {STATUS_LABELS[status] ?? status}
                  </Badge>
                ) : null}
                {isOmxBoosted ? (
                  <Badge
                    variant="outline"
                    className="gap-1.5 border-zinc-500/40 bg-zinc-950/80 text-zinc-100"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-current"
                      aria-hidden
                    />
                    OMX
                  </Badge>
                ) : null}
                {showUsageLimitHitBadge ? (
                  <Badge
                    variant="outline"
                    className="gap-1.5 border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-current"
                      aria-hidden
                    />
                    Usage limit hit
                    {usageLimitHit && usageLimitHitCountdownLabel ? (
                      <span className="font-medium text-red-700 dark:text-red-300">
                        · leaves in {usageLimitHitCountdownLabel}
                      </span>
                    ) : null}
                  </Badge>
                ) : !hideLiveTaskAndStatusBadges && showWorkingIndicator ? (
                  <WorkingNowPill />
                ) : !hideLiveTaskAndStatusBadges &&
                  showWaitingForTaskIndicator ? (
                  <WaitingForTaskPill label={waitingTaskPillLabel} />
                ) : null}
                {showWeeklyUsageLimitDetailBadge ? (
                  <Badge
                    variant="outline"
                    className="gap-1.5 border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-current"
                      aria-hidden
                    />
                    Weekly usage limit hit
                  </Badge>
                ) : null}
                {hasExpiredRefreshToken ? (
                  <Badge
                    variant="outline"
                    className="gap-1.5 border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    title={
                      account.deactivationReason ??
                      "Re-login is required to refresh the account token."
                    }
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-current"
                      aria-hidden
                    />
                    Expired refresh token
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="mt-2 flex items-start gap-2.5">
              <div className="mt-0.5 flex shrink-0 items-center gap-2 text-zinc-200/85">
                <div className="h-5 w-7 rounded-[4px] border border-amber-200/35 bg-[linear-gradient(145deg,#f2ca7d_0%,#d79a24_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]" />
                <span className="text-xs tracking-[0.18em]">)))</span>
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[11px] font-semibold uppercase tracking-[0.13em] text-zinc-300"
                  title={
                    showAccountId
                      ? `Account ID ${account.accountId}`
                      : undefined
                  }
                >
                  {showCodexOnlyAccountSubtitle ? (
                    codexOnlyEmailLabel ? (
                      <>
                        CODEX ONLY ACCOUNT ·{" "}
                        {codexOnlyEmailIsSensitive && blurred ? (
                          <span className="privacy-blur">
                            {codexOnlyEmailLabel}
                          </span>
                        ) : (
                          codexOnlyEmailLabel
                        )}
                      </>
                    ) : (
                      "CODEX ONLY ACCOUNT"
                    )
                  ) : snapshotIsEmail && blurred ? (
                    <>
                      {planLabel} ·{" "}
                      <span className="privacy-blur">{snapshotLabel}</span>
                    </>
                  ) : (
                    planWithSnapshot
                  )}
                  {idSuffix}
                </p>
                <p className="mt-0.5 truncate text-sm font-semibold leading-tight text-zinc-200/85">
                  {accountIdentityIsSensitive && blurred ? (
                    <span className="privacy-blur">{accountIdentityLabel}</span>
                  ) : (
                    accountIdentityLabel
                  )}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Tokens:
                </p>
                <p className="truncate rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-sm font-medium tracking-[0.22em] text-zinc-100 sm:text-base">
                  {tokenCardPrimaryLine}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  CLI sessions:
                </p>
                <p className="truncate rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-sm font-medium tracking-[0.22em] text-zinc-100 sm:text-base">
                  {tokenCardSecondaryLine}
                </p>
              </div>
            </div>
            <div className="mt-3 border-t border-white/10 pt-3">
              <div
                className={cn(
                  "grid gap-2.5",
                  showPrimaryQuotaBar ? "grid-cols-2" : "grid-cols-1",
                )}
              >
                {showPrimaryQuotaBar && (
                  <QuotaBar
                    label={primaryWindowLabel}
                    percent={primaryRemaining}
                    resetLabel={primaryReset}
                    lastSeenLabel={stalePrimaryLastSeen.label}
                    lastSeenUpToDate={stalePrimaryLastSeen.upToDate}
                    deactivated={isDeactivated}
                    isLive={hasLiveSession}
                    telemetryPending={primaryTelemetryPending}
                    usageLimitHit={usageLimitHit}
                    inTokenCard
                  />
                )}
                <QuotaBar
                  label="Weekly"
                  percent={secondaryRemaining}
                  resetLabel={secondaryReset}
                  lastSeenLabel={
                    staleSecondaryLastSeen.label ?? weeklyFallbackStateLabel
                  }
                  lastSeenUpToDate={staleSecondaryLastSeen.upToDate}
                  isLive={hasLiveSession}
                  telemetryPending={secondaryTelemetryPending}
                  inTokenCard
                />
              </div>
            </div>

            {shouldRenderTaskPanel ? (
              <div className="relative mt-3">
                <div className="space-y-1.5">
                  {hasTaskPanelTopContent ? (
                    <div
                      className={cn(
                        "relative transition-all duration-200",
                        hideTaskContainerChrome
                          ? "px-0 py-0"
                          : showRalplanPlanningGraph || showCodexActiveAgentCard
                            ? "px-0 py-0"
                            : cn(
                                "rounded-lg border px-2 py-1.5",
                                isCurrentTaskWaiting
                                  ? "border-cyan-400/30 bg-transparent hover:border-cyan-300/45 hover:shadow-[0_0_0_1px_rgba(34,211,238,0.16)]"
                                  : "border-indigo-300/30 bg-transparent hover:border-indigo-200/45 hover:shadow-[0_0_0_1px_rgba(129,140,248,0.18)]",
                              ),
                      )}
                    >
                      {!hideCurrentTaskPreview ? (
                        showRalplanPlanningGraph ? (
                          <OmxPlanningPromptGraph
                            activeNodeKey={omxPlanningActiveNodeKey}
                            cliRuntimeState={omxPlanningCliRuntimeState}
                          />
                        ) : showCodexActiveAgentCard ? (
                          <CodexActiveAgentCard
                            cliRuntimeState={codexActiveCardCliRuntimeState}
                          />
                        ) : null
                      ) : null}
                      {taskPanelAddon ? (
                        <div className={cn(!hideCurrentTaskPreview && "mt-2")}>
                          {taskPanelAddon}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {showLastTaskPreview ? (
                    <div className="rounded-lg border border-white/15 bg-transparent px-2 py-1">
                      <div>
                        <p
                          className="break-words whitespace-pre-wrap text-xs leading-relaxed text-zinc-300/90"
                          title={codexLastTaskPreview ?? undefined}
                        >
                          <span className="font-medium text-zinc-200">
                            Last codex response:
                          </span>
                          <span className="ml-1 inline-flex items-center gap-1.5">
                            {hasNextTaskHint(codexLastTaskPreview) ? (
                              <NextTaskBadge />
                            ) : null}
                            <span>{displayLastTaskPreviewText}</span>
                          </span>
                        </p>
                        {lastTaskPreviewExcerpt?.truncated ? (
                          <button
                            type="button"
                            className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-200 transition-colors hover:text-cyan-100"
                            aria-expanded={lastTaskPreviewExpanded}
                            onClick={() =>
                              toggleTaskPreviewExpanded(
                                LAST_TASK_PREVIEW_EXPANSION_KEY,
                              )
                            }
                          >
                            {lastTaskPreviewExpanded
                              ? "Show Less"
                              : "View Full"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {hasSessionTaskRows ? (
                    <div className="relative isolate mt-1.5 overflow-hidden rounded-xl border border-cyan-500/20 bg-[linear-gradient(180deg,rgba(2,8,24,0.92),rgba(2,10,28,0.78))] p-2 pt-1.5 shadow-[inset_0_1px_0_rgba(148,163,184,0.1),0_10px_28px_rgba(2,6,23,0.45)]">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(120%_100%_at_100%_0%,rgba(34,211,238,0.18),transparent_60%)]"
                      />
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 top-9 h-px bg-gradient-to-r from-transparent via-cyan-300/25 to-transparent"
                      />
                      <div className="relative mb-1 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          className="inline-flex min-w-[13rem] flex-1 items-center justify-between gap-2 rounded-lg border border-cyan-300/35 bg-cyan-500/[0.06] px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/95 transition-all duration-200 hover:border-cyan-200/60 hover:bg-cyan-500/[0.1]"
                          aria-expanded={!sessionTasksCollapsed}
                          onClick={() =>
                            setSessionTasksCollapsed((current) => !current)
                          }
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              aria-hidden
                              className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-200"
                            >
                              <span className="absolute inset-0 rounded-full bg-cyan-200/60 motion-safe:animate-ping [animation-duration:1.5s]" />
                            </span>
                            <span>CLI session tasks</span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-zinc-300">
                            <span className="font-mono text-[10px]">
                              {sessionTaskRows.length}
                            </span>
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5 transition-transform duration-200",
                                sessionTasksCollapsed && "-rotate-90",
                              )}
                            />
                          </span>
                        </button>
                        <span className="inline-flex h-5 items-center rounded-md border border-emerald-300/40 bg-emerald-500/12 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
                          {sessionTaskSummary.assignedCount} assigned
                        </span>
                        <span className="inline-flex h-5 items-center rounded-md border border-cyan-300/40 bg-cyan-500/12 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
                          {sessionTaskSummary.waitingCount} waiting
                        </span>
                        {sessionTaskSummary.finishedCount > 0 ? (
                          <span className="inline-flex h-5 items-center rounded-md border border-violet-300/40 bg-violet-500/12 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
                            {sessionTaskSummary.finishedCount} finished
                          </span>
                        ) : null}
                      </div>
                      {!sessionTasksCollapsed ? (
                        <ul className="relative space-y-2">
                          {sessionTaskRows.map((preview, index) => {
                            const sessionTaskState =
                              sessionTaskStates[index] ?? "waiting";
                            const sessionTaskRowKey = `${preview.sessionKey}-${preview.ordinal}`;
                            const sessionTaskPreviewExcerpt =
                              getTaskPreviewExcerpt(preview.taskPreview);
                            const sessionTaskPreviewExpanded =
                              isTaskPreviewExpanded(sessionTaskRowKey);
                            const displaySessionTaskPreview =
                              sessionTaskPreviewExcerpt.truncated &&
                              !sessionTaskPreviewExpanded
                                ? sessionTaskPreviewExcerpt.text
                                : preview.taskPreview;
                            const usageLimitSessionPreview =
                              isUsageLimitTaskPreview(preview.taskPreview);
                            return (
                              <li
                                key={sessionTaskRowKey}
                                className={cn(
                                  "group relative overflow-hidden space-y-1.5 rounded-xl border border-white/10 bg-[#020a19]/85 pl-3 pr-2.5 py-2 shadow-[inset_0_1px_0_rgba(148,163,184,0.08)] transition-all duration-200",
                                  sessionTaskState === "waiting" &&
                                    "hover:border-cyan-300/45 hover:bg-cyan-500/[0.08]",
                                  sessionTaskState === "thinking" &&
                                    "border-indigo-300/30 bg-indigo-500/[0.1] hover:border-indigo-200/45 hover:bg-indigo-500/[0.14]",
                                  sessionTaskState === "finished" &&
                                    "border-emerald-300/28 bg-emerald-500/[0.08] hover:border-emerald-200/45 hover:bg-emerald-500/[0.12]",
                                )}
                              >
                                <span
                                  className="pointer-events-none absolute -right-8 top-0 h-20 w-20 rounded-full bg-cyan-300/10 opacity-0 blur-2xl transition-opacity duration-200 group-hover:opacity-100"
                                  aria-hidden
                                />
                                <span
                                  className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/40 to-transparent"
                                  aria-hidden
                                />
                                <span
                                  className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-200/20 to-transparent"
                                  aria-hidden
                                />
                                <span
                                  className={cn(
                                    "pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-r-full bg-gradient-to-b opacity-95",
                                    resolveSessionTaskAccentClass(index),
                                  )}
                                  aria-hidden
                                />
                                <div className="flex items-start justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-300">
                                  <span>Session {preview.ordinal}</span>
                                  <div className="flex min-w-0 flex-col items-end gap-1">
                                    {!preview.synthetic ? (
                                      <span
                                        className="max-w-[11rem] truncate font-mono text-zinc-400"
                                        title={preview.sessionKey}
                                      >
                                        {formatSessionKeyLabel(
                                          preview.sessionKey,
                                        )}
                                      </span>
                                    ) : null}
                                    <SessionTaskStatePill
                                      taskPreview={preview.taskPreview}
                                      stateOverride={sessionTaskState}
                                      className="h-5 px-2 text-[9px]"
                                    />
                                  </div>
                                </div>
                                <div title={preview.taskPreview}>
                                  <div className="rounded-lg border border-white/8 bg-[#040d22]/70 px-2 py-1.5 shadow-[inset_0_1px_0_rgba(148,163,184,0.06)]">
                                    {sessionTaskState === "thinking" ? (
                                      <div className="mb-1 inline-flex h-4 items-center gap-1 rounded-full border border-indigo-200/40 bg-indigo-500/18 px-1.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-indigo-100">
                                        Prompt
                                      </div>
                                    ) : null}
                                    <span
                                      className={cn(
                                        "inline-flex items-center gap-1.5 break-words whitespace-pre-wrap text-xs leading-relaxed text-zinc-100/95",
                                      )}
                                    >
                                      {hasNextTaskHint(preview.taskPreview) ? (
                                        <NextTaskBadge />
                                      ) : null}
                                      {usageLimitSessionPreview ? (
                                        <UsageLimitTaskPreviewText
                                          text={displaySessionTaskPreview}
                                        />
                                      ) : (
                                        <span>{displaySessionTaskPreview}</span>
                                      )}
                                    </span>
                                  </div>
                                  {sessionTaskPreviewExcerpt.truncated ? (
                                    <button
                                      type="button"
                                      className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-200/95 transition-colors hover:text-cyan-100"
                                      aria-expanded={sessionTaskPreviewExpanded}
                                      onClick={() =>
                                        toggleTaskPreviewExpanded(
                                          sessionTaskRowKey,
                                        )
                                      }
                                    >
                                      {sessionTaskPreviewExpanded
                                        ? "Show Less"
                                        : "View Full"}
                                    </button>
                                  ) : null}
                                  {sessionTaskState === "waiting" &&
                                  resolveWaitingTaskHelperText(
                                    preview.taskPreview,
                                  ) ? (
                                    <p className="mt-1 text-[10px] leading-relaxed text-cyan-100/90">
                                      {resolveWaitingTaskHelperText(
                                        preview.taskPreview,
                                      )}
                                    </p>
                                  ) : null}
                                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                                    <button
                                      type="button"
                                      className="inline-flex h-6 items-center gap-1 rounded-md border border-cyan-300/50 bg-cyan-500/12 px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-50 transition-all duration-200 hover:border-cyan-200/70 hover:bg-cyan-500/20"
                                      aria-expanded={
                                        expandedSessionLogRowKey ===
                                        sessionTaskRowKey
                                      }
                                      onClick={() => {
                                        if (onAction && !preview.synthetic) {
                                          onAction(account, "sessions", {
                                            focusSessionKey: preview.sessionKey,
                                            source: "watch-logs",
                                          });
                                          return;
                                        }
                                        setExpandedSessionLogRowKey(
                                          (current) =>
                                            current === sessionTaskRowKey
                                              ? null
                                              : sessionTaskRowKey,
                                        );
                                      }}
                                    >
                                      <Eye className="h-3 w-3" />
                                      Watch logs
                                    </button>
                                    {!preview.synthetic ? (
                                      <button
                                        type="button"
                                        className="inline-flex h-6 items-center rounded-md border border-white/25 bg-white/[0.02] px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-200 transition-all duration-200 hover:border-cyan-300/45 hover:bg-cyan-500/[0.08] hover:text-zinc-50"
                                        onClick={() =>
                                          onAction?.(account, "sessions", {
                                            focusSessionKey: preview.sessionKey,
                                            source: "session-panel",
                                          })
                                        }
                                      >
                                        Open session view
                                      </button>
                                    ) : null}
                                  </div>
                                  {expandedSessionLogRowKey ===
                                  sessionTaskRowKey ? (
                                    <div className="mt-1.5 rounded-lg border border-cyan-400/35 bg-[#010714]/95 p-1.5 shadow-[inset_0_1px_0_rgba(148,163,184,0.1),0_10px_24px_rgba(2,6,23,0.35)]">
                                      <div className="mb-1 flex items-center gap-1.5 px-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-cyan-200/80">
                                        <span
                                          aria-hidden
                                          className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-200"
                                        >
                                          <span className="absolute inset-0 rounded-full bg-cyan-200/65 motion-safe:animate-ping [animation-duration:1.6s]" />
                                        </span>
                                        Live stream
                                      </div>
                                      <ol className="max-h-40 overflow-y-auto font-mono text-[10px] leading-5 text-cyan-100">
                                        {buildSessionTaskLogLines({
                                          accountId: account.accountId,
                                          row: preview,
                                          state: sessionTaskState,
                                          quotaDebugLogText,
                                        }).map((line, lineIndex) => (
                                          <li
                                            key={`${sessionTaskRowKey}-log-${lineIndex}`}
                                            className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 rounded-sm px-1.5 even:bg-cyan-500/[0.07]"
                                          >
                                            <span className="select-none text-right text-cyan-400/55">
                                              {String(lineIndex + 1).padStart(
                                                2,
                                                "0",
                                              )}
                                            </span>
                                            <span className="break-all">
                                              {line}
                                            </span>
                                          </li>
                                        ))}
                                      </ol>
                                    </div>
                                  ) : null}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="sr-only">
            <div className="min-w-0 space-y-2">
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {tokenMetricLabel}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold tabular-nums">
                  <span>{accessibleTokenMetricValue}</span>
                  {isWorkingNow ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                      live
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Codex CLI sessions
                </p>
                <p className="mt-0.5 text-xs font-semibold tabular-nums">
                  {accessibleCodexSessionValue}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Tracked: {codexTrackedSessionCount}
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-3.5 border-t border-white/10 pt-3">
            <Button
              type="button"
              size="sm"
              variant="default"
              className={cn(
                "h-9 w-full justify-center gap-1.5 rounded-xl border border-emerald-400/35 bg-gradient-to-r from-emerald-500/22 via-emerald-500/16 to-cyan-500/14 px-3 text-sm font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition-colors hover:from-emerald-500/30 hover:via-emerald-500/22 hover:to-cyan-500/20",
                useLocalButtonShowsSuccess &&
                  "border-emerald-300/60 from-emerald-500/34 via-emerald-500/30 to-cyan-500/24 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_0_1px_rgba(16,185,129,0.22)]",
                canUseLocally
                  ? "text-emerald-700 hover:text-emerald-800 dark:text-emerald-200 dark:hover:text-emerald-100"
                  : "text-muted-foreground",
              )}
              disabled={useLocalButtonDisabled}
              title={useLocalButtonDisabledReason ?? undefined}
              aria-label={primaryActionAriaLabel}
              onClick={() => onAction?.(account, "useLocal")}
            >
              {useLocalButtonShowsSuccess ? (
                <CheckCircle2
                  data-testid="use-local-success-icon"
                  className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300"
                />
              ) : null}
              {resolvedPrimaryActionLabel}
            </Button>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {hasSnapshotMismatch ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground"
                    disabled={disableSecondaryActions}
                    onClick={() => onAction?.(account, "repairSnapshotReadd")}
                  >
                    Re-add snapshot
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground"
                    disabled={disableSecondaryActions}
                    onClick={() => onAction?.(account, "repairSnapshotRename")}
                  >
                    Rename snapshot
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground"
                disabled={disableSecondaryActions}
                onClick={() => onAction?.(account, "details")}
              >
                <ExternalLink className="h-3 w-3" />
                Details
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 rounded-lg text-xs text-cyan-700 hover:bg-cyan-500/10 hover:text-cyan-800 disabled:pointer-events-none disabled:text-muted-foreground dark:text-cyan-300 dark:hover:text-cyan-200"
                disabled={disableSecondaryActions || !hasSessionInventory}
                title={!hasSessionInventory ? "No tracked sessions" : undefined}
                onClick={() => onAction?.(account, "sessions")}
              >
                <ExternalLink className="h-3 w-3" />
                Sessions
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 rounded-lg text-xs text-red-600 hover:bg-red-500/10 hover:text-red-700 disabled:pointer-events-none disabled:text-muted-foreground dark:text-red-400 dark:hover:text-red-300"
                disabled={deleteBusy || disableSecondaryActions}
                onClick={() => onAction?.(account, "delete")}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </Button>
              {status === "paused" && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 rounded-lg text-xs text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                  disabled={disableSecondaryActions}
                  onClick={() => onAction?.(account, "resume")}
                >
                  <Play className="h-3 w-3" />
                  Resume
                </Button>
              )}
              {(status === "deactivated" || hasExpiredRefreshToken) && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 rounded-lg text-xs text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                  disabled={disableSecondaryActions}
                  onClick={() => onAction?.(account, "reauth")}
                >
                  <RotateCcw className="h-3 w-3" />
                  Re-auth
                </Button>
              )}
            </div>
          </div>

          {hasSessionInventory || liveQuotaDebug ? (
            <div className="mt-2.5 rounded-xl border border-cyan-500/20 bg-[#020812]/95 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div
                className="flex w-full items-center justify-between gap-2"
                data-testid="codex-logs-label"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/95">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-200/85 shadow-[0_0_0_2px_rgba(34,211,238,0.12)]" />
                    Codex logs
                  </p>
                  {activeOmxPlanningLogLabel ? (
                    <p
                      data-testid="codex-logs-active-agent-label"
                      className="mt-1 inline-flex items-center rounded-md border border-indigo-300/35 bg-indigo-500/14 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-indigo-100/95"
                    >
                      {activeOmxPlanningLogLabel}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-500/16"
                  onClick={openCodexLogsView}
                >
                  <ExternalLink className="h-3 w-3" />
                  Open logs
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {showUsageLimitGraceOverlay ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-xl border border-red-500/40 bg-red-500/14 px-4 py-2.5 text-center shadow-lg backdrop-blur-[2px]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-red-700 dark:text-red-300">
              Usage limit hit
            </p>
            <p className="mt-1 text-sm font-semibold tabular-nums text-red-800 dark:text-red-200">
              Leaving working now in {usageLimitHitCountdownLabel}
            </p>
          </div>
        </div>
      ) : null}
      {showMissingSnapshotLockOverlay ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center px-4">
          <div
            className="pointer-events-none absolute inset-0 bg-black/45 backdrop-blur-[1.5px]"
            aria-hidden
          />
          <div className="relative z-10 flex w-full max-w-[13rem] flex-col items-center gap-2 rounded-2xl border border-white/10 bg-black/75 px-4 py-3.5 text-center shadow-[0_20px_55px_rgba(0,0,0,0.55)] backdrop-blur-md">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-400/25 bg-cyan-400/10">
              <Lock className="h-4 w-4 text-cyan-200" aria-hidden />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-300">
              Locked account
            </p>
            <p
              className={cn(
                "max-w-full truncate font-mono text-xs text-zinc-200/90",
                lockedAccountIdentityBlurred && "privacy-blur",
              )}
              title={lockedAccountIdentity}
            >
              {lockedAccountIdentity}
            </p>
            <div className="mt-0.5 flex w-full items-center justify-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-lg border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-100 hover:border-cyan-400/35 hover:bg-cyan-400/12 hover:text-cyan-100"
                onClick={handleUnlock}
              >
                Unlock
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 rounded-lg border-red-500/25 bg-red-500/10 px-3 text-xs font-semibold text-red-200 hover:border-red-400/35 hover:bg-red-500/16 hover:text-red-100 disabled:pointer-events-none disabled:opacity-60"
                disabled={deleteBusy}
                onClick={() => onAction?.(account, "delete")}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
