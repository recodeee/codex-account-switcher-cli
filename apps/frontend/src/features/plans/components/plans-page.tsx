import { useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Compass,
  FolderTree,
  Palette,
  PenLine,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AlertMessage } from "@/components/alert-message";
import { CopyButton } from "@/components/copy-button";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SpinnerBlock } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOpenSpecPlans } from "@/features/plans/hooks/use-open-spec-plans";
import type { OpenSpecPlanDetail } from "@/features/plans/schemas";
import { cn } from "@/lib/utils";
import { getErrorMessageOrNull } from "@/utils/errors";
import { formatTimeLong } from "@/utils/formatters";

function roleCompletionLabel(done: number, total: number): string {
  return `${done}/${total}`;
}

function isFinishedProgress(progress: { doneCheckpoints: number; totalCheckpoints: number }): boolean {
  return progress.totalCheckpoints > 0 && progress.doneCheckpoints >= progress.totalCheckpoints;
}

function getDisplayStatus(
  status: string,
  progress: { doneCheckpoints: number; totalCheckpoints: number },
): string {
  if (isFinishedProgress(progress)) {
    return "Finished";
  }
  return status;
}

function statusBadgeClass(status: string): string {
  const normalizedStatus = status.trim().toLowerCase();

  if (normalizedStatus === "finished") {
    return "border-emerald-500/40 bg-emerald-500/20 text-emerald-200";
  }

  if (normalizedStatus === "approved") {
    return "border-emerald-500/30 bg-emerald-500/15 text-emerald-300";
  }

  if (normalizedStatus === "draft") {
    return "border-border/70 bg-secondary/60 text-secondary-foreground";
  }

  if (normalizedStatus === "unknown") {
    return "border-red-500/30 bg-red-500/15 text-red-300";
  }

  return "border-slate-500/30 bg-slate-500/15 text-slate-300";
}

type RoleVisual = {
  icon: LucideIcon;
  badgeClass: string;
  progressClass: string;
  cardClass: string;
  iconClass: string;
  metaClass: string;
};

const ROLE_VISUALS: Record<string, RoleVisual> = {
  planner: {
    icon: ClipboardList,
    badgeClass: "border-sky-500/35 bg-sky-500/15 text-sky-200",
    progressClass: "bg-sky-400/80",
    cardClass:
      "border-sky-500/25 bg-gradient-to-br from-sky-500/12 via-[#040d1b] to-[#040a14] hover:border-sky-400/45",
    iconClass: "border-sky-400/35 bg-sky-500/20 text-sky-100",
    metaClass: "text-sky-100/70",
  },
  architect: {
    icon: Compass,
    badgeClass: "border-violet-500/35 bg-violet-500/15 text-violet-200",
    progressClass: "bg-violet-400/80",
    cardClass:
      "border-violet-500/25 bg-gradient-to-br from-violet-500/12 via-[#0a0818] to-[#060611] hover:border-violet-400/45",
    iconClass: "border-violet-400/35 bg-violet-500/20 text-violet-100",
    metaClass: "text-violet-100/70",
  },
  critic: {
    icon: TriangleAlert,
    badgeClass: "border-amber-500/35 bg-amber-500/15 text-amber-200",
    progressClass: "bg-amber-400/80",
    cardClass:
      "border-amber-500/25 bg-gradient-to-br from-amber-500/12 via-[#140d05] to-[#0b0703] hover:border-amber-400/45",
    iconClass: "border-amber-400/35 bg-amber-500/20 text-amber-100",
    metaClass: "text-amber-100/70",
  },
  executor: {
    icon: Wrench,
    badgeClass: "border-cyan-500/35 bg-cyan-500/15 text-cyan-200",
    progressClass: "bg-cyan-400/80",
    cardClass:
      "border-cyan-500/25 bg-gradient-to-br from-cyan-500/12 via-[#04121a] to-[#040a12] hover:border-cyan-400/45",
    iconClass: "border-cyan-400/35 bg-cyan-500/20 text-cyan-100",
    metaClass: "text-cyan-100/70",
  },
  writer: {
    icon: PenLine,
    badgeClass: "border-pink-500/35 bg-pink-500/15 text-pink-200",
    progressClass: "bg-pink-400/80",
    cardClass:
      "border-pink-500/25 bg-gradient-to-br from-pink-500/12 via-[#170615] to-[#0f040e] hover:border-pink-400/45",
    iconClass: "border-pink-400/35 bg-pink-500/20 text-pink-100",
    metaClass: "text-pink-100/70",
  },
  verifier: {
    icon: ShieldCheck,
    badgeClass: "border-emerald-500/35 bg-emerald-500/15 text-emerald-200",
    progressClass: "bg-emerald-400/80",
    cardClass:
      "border-emerald-500/25 bg-gradient-to-br from-emerald-500/12 via-[#05130c] to-[#040c0a] hover:border-emerald-400/45",
    iconClass: "border-emerald-400/35 bg-emerald-500/20 text-emerald-100",
    metaClass: "text-emerald-100/70",
  },
  designer: {
    icon: Palette,
    badgeClass: "border-indigo-500/35 bg-indigo-500/15 text-indigo-200",
    progressClass: "bg-indigo-400/80",
    cardClass:
      "border-indigo-500/25 bg-gradient-to-br from-indigo-500/12 via-[#0a0b1b] to-[#050711] hover:border-indigo-400/45",
    iconClass: "border-indigo-400/35 bg-indigo-500/20 text-indigo-100",
    metaClass: "text-indigo-100/70",
  },
};

function getRoleVisual(role: string): RoleVisual {
  return ROLE_VISUALS[role.trim().toLowerCase()] ?? {
    icon: CheckCircle2,
    badgeClass: "border-slate-500/35 bg-slate-500/15 text-slate-200",
    progressClass: "bg-slate-300/80",
    cardClass:
      "border-slate-500/25 bg-gradient-to-br from-slate-500/10 via-[#070b14] to-[#05080f] hover:border-slate-400/45",
    iconClass: "border-slate-400/35 bg-slate-500/20 text-slate-100",
    metaClass: "text-slate-200/70",
  };
}

function roleProgressPercent(done: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function checkpointStateBadgeClass(state: string): string {
  const normalizedState = state.trim().toLowerCase().replace(/\s+/g, "_");

  if (["done", "approved", "finished", "completed", "success", "passed"].includes(normalizedState)) {
    return "border-emerald-500/40 bg-emerald-500/20 text-emerald-200";
  }

  if (["in_progress", "running", "active"].includes(normalizedState)) {
    return "border-sky-500/40 bg-sky-500/20 text-sky-200";
  }

  if (["failed", "error", "blocked", "rejected", "cancelled", "canceled"].includes(normalizedState)) {
    return "border-red-500/40 bg-red-500/20 text-red-200";
  }

  if (["pending", "queued", "todo", "draft"].includes(normalizedState)) {
    return "border-amber-500/40 bg-amber-500/20 text-amber-200";
  }

  return "border-slate-500/30 bg-slate-500/15 text-slate-300";
}

function formatRoleLabel(role: string): string {
  return role
    .split(/[_-]/g)
    .map((segment) => (segment ? `${segment[0].toUpperCase()}${segment.slice(1)}` : ""))
    .join(" ");
}

function formatCheckpointState(state: string): string {
  return state.toLowerCase().replace(/_/g, " ");
}

function formatCheckpointTimestamp(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return timestamp;
  }

  const formatted = formatTimeLong(new Date(parsed).toISOString());
  return `${formatted.date} ${formatted.time}`;
}

function normalizeMarkdownLine(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function parseSummaryLines(summaryMarkdown: string): string[] {
  const normalizedMarkdown = summaryMarkdown.replace(/\\n/g, "\n");

  return normalizedMarkdown
    .split("\n")
    .map((line) => normalizeMarkdownLine(line))
    .filter((line) => line.length > 0);
}

type ParsedCheckpointEntry = {
  timestamp: string;
  role: string | null;
  checkpointId: string | null;
  state: string | null;
  message: string | null;
};

type ParsedCheckpointLine =
  | { type: "entry"; entry: ParsedCheckpointEntry }
  | { type: "text"; text: string };

function parseCheckpointEntry(line: string): ParsedCheckpointEntry | null {
  const normalized = normalizeMarkdownLine(line);
  if (!normalized || /^no checkpoints recorded yet\.?$/i.test(normalized)) {
    return null;
  }

  const segments = normalized.split("|").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const [timestamp, ...rest] = segments;
  let role: string | null = null;
  let checkpointId: string | null = null;
  let state: string | null = null;
  const messageSegments: string[] = [];

  for (const segment of rest) {
    const separatorIndex = segment.indexOf("=");
    if (separatorIndex < 0) {
      messageSegments.push(segment);
      continue;
    }

    const key = segment.slice(0, separatorIndex).trim().toLowerCase();
    const value = segment.slice(separatorIndex + 1).trim();
    if (!value) {
      continue;
    }

    if (key === "role") {
      role = value;
      continue;
    }
    if (key === "id" || key === "checkpoint") {
      checkpointId = value;
      continue;
    }
    if (key === "state") {
      state = value;
      continue;
    }

    messageSegments.push(`${key}: ${value}`);
  }

  return {
    timestamp,
    role,
    checkpointId,
    state,
    message: messageSegments.length > 0 ? messageSegments.join(" • ") : null,
  };
}

function parseCheckpointLines(checkpointsMarkdown: string): ParsedCheckpointLine[] {
  const normalizedMarkdown = checkpointsMarkdown.replace(/\\n/g, "\n");
  const lines = normalizedMarkdown
    .split("\n")
    .map((line) => normalizeMarkdownLine(line))
    .filter((line) => line.length > 0 && !/^plan checkpoints:/i.test(line));

  if (lines.length === 0) {
    return [];
  }

  return lines.map((line) => {
    if (/^no checkpoints recorded yet\.?$/i.test(line)) {
      return { type: "text", text: "No checkpoints recorded yet." } as const;
    }

    const parsedEntry = parseCheckpointEntry(line);
    if (!parsedEntry) {
      return { type: "text", text: line } as const;
    }

    return { type: "entry", entry: parsedEntry } as const;
  });
}

export function buildPlanStarterPrompt(
  planDetail: OpenSpecPlanDetail,
  displayStatus: string,
  summaryLines: string[],
): string {
  const planPath = `openspec/plan/${planDetail.slug}`;
  const remainingRoles = planDetail.roles.filter((role) => role.doneCheckpoints < role.totalCheckpoints);
  const nextRole = remainingRoles[0] ?? null;
  const currentCheckpoint = planDetail.currentCheckpoint;

  const lines = [
    "$ralph",
    "You are a new Codex session/account continuing an existing OpenSpec implementation plan.",
    `Repository: /home/deadpool/Documents/codex-lb`,
    `Plan workspace: ${planPath}`,
    "",
    "Use the existing plan artifacts as source of truth. Do not restart planning from scratch unless the artifacts are inconsistent.",
    "",
    "Read first:",
    `- ${planPath}/summary.md`,
    `- ${planPath}/checkpoints.md`,
    `- ${planPath}/planner/plan.md`,
    `- ${planPath}/executor/tasks.md`,
    `- ${planPath}/writer/tasks.md`,
    `- ${planPath}/verifier/tasks.md`,
    "",
    `Plan: ${planDetail.title}`,
    `Slug: ${planDetail.slug}`,
    `Status: ${displayStatus}`,
    `Overall progress: ${roleCompletionLabel(planDetail.overallProgress.doneCheckpoints, planDetail.overallProgress.totalCheckpoints)} checkpoints complete (${planDetail.overallProgress.percentComplete}%)`,
  ];

  if (currentCheckpoint) {
    lines.push(
      `Current checkpoint: ${formatRoleLabel(currentCheckpoint.role)} · ${currentCheckpoint.checkpointId} · ${formatCheckpointState(currentCheckpoint.state)}`,
      `Current checkpoint note: ${currentCheckpoint.message || "No checkpoint message provided."}`,
      `Current checkpoint time: ${currentCheckpoint.timestamp}`,
    );
  } else {
    lines.push("Current checkpoint: none recorded.");
  }

  if (remainingRoles.length > 0) {
    lines.push("Remaining role checkpoints:");
    lines.push(
      ...remainingRoles.map(
        (role) =>
          `- ${formatRoleLabel(role.role)} ${roleCompletionLabel(role.doneCheckpoints, role.totalCheckpoints)}`,
      ),
    );
  }

  if (summaryLines.length > 0) {
    lines.push("Plan summary:");
    lines.push(...summaryLines.map((line) => `- ${line}`));
  }

  lines.push(
    "",
    "Continue implementation from the current checkpoint or the next unfinished role.",
    "Update the OpenSpec plan tasks/checkpoints as you progress.",
    "Verify current repo state before editing, then run focused tests/lint/typecheck before marking the work complete.",
  );

  if (nextRole) {
    lines.push(`If the current checkpoint is stale, resume from the next unfinished role: ${formatRoleLabel(nextRole.role)}.`);
  }

  return lines.join("\n");
}

export function PlansPage() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const { plansQuery, planDetailQuery, effectiveSelectedSlug } = useOpenSpecPlans(selectedSlug);

  const entries = plansQuery.data?.entries ?? [];
  const listError = getErrorMessageOrNull(plansQuery.error);
  const detailError = getErrorMessageOrNull(planDetailQuery.error);
  const planDetail = planDetailQuery.data;

  const selectedEntry = entries.find((entry) => entry.slug === effectiveSelectedSlug) ?? null;
  const sortedEntries = [...entries].sort((left, right) => {
    const leftFinished = isFinishedProgress(left.overallProgress);
    const rightFinished = isFinishedProgress(right.overallProgress);

    if (leftFinished === rightFinished) {
      return 0;
    }

    return leftFinished ? 1 : -1;
  });

  const selectedEntryDisplayStatus = selectedEntry
    ? getDisplayStatus(selectedEntry.status, selectedEntry.overallProgress)
    : null;
  const summaryLines = planDetail ? parseSummaryLines(planDetail.summaryMarkdown) : [];
  const checkpointLines = planDetail ? parseCheckpointLines(planDetail.checkpointsMarkdown) : [];
  const starterPrompt =
    planDetail && selectedEntryDisplayStatus
      ? buildPlanStarterPrompt(planDetail, selectedEntryDisplayStatus, summaryLines)
      : "";

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
        <p className="text-sm text-muted-foreground">
          Visualize OpenSpec plan workspaces from <code>openspec/plan</code>.
        </p>
      </div>

      {listError ? (
        <AlertMessage variant="error">Couldn’t load plans: {listError}</AlertMessage>
      ) : null}

      {plansQuery.isLoading ? (
        <SpinnerBlock label="Loading plans…" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="No plans found"
          description="Create a plan workspace under openspec/plan to visualize it here."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(30rem,36rem)_minmax(0,1fr)]">
          <div className="rounded-xl border border-border/60 bg-card/60 p-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[56%]">Plan</TableHead>
                  <TableHead className="w-[18%]">Status</TableHead>
                  <TableHead className="w-[26%] text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedEntries.map((entry) => {
                  const updatedAt = formatTimeLong(entry.updatedAt);
                  const isFinished = isFinishedProgress(entry.overallProgress);
                  const displayStatus = getDisplayStatus(entry.status, entry.overallProgress);
                  const progressLabel =
                    entry.overallProgress.totalCheckpoints > 0
                      ? `${roleCompletionLabel(entry.overallProgress.doneCheckpoints, entry.overallProgress.totalCheckpoints)} checkpoints • ${entry.overallProgress.percentComplete}%`
                      : "No checkpoints yet";

                  return (
                    <TableRow
                      key={entry.slug}
                      data-testid={`plan-row-${entry.slug}`}
                      className={cn(
                        isFinished ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                        entry.slug === effectiveSelectedSlug ? "bg-muted/50" : undefined,
                      )}
                      onClick={() => {
                        if (isFinished) {
                          return;
                        }
                        setSelectedSlug(entry.slug);
                      }}
                    >
                      <TableCell className="align-top">
                        <div className="space-y-1.5">
                          <p className="truncate font-medium">{entry.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{entry.slug}</p>
                          <div className="space-y-1">
                            <Progress value={entry.overallProgress.percentComplete} className="h-1.5" />
                            <p className="text-[11px] text-muted-foreground">{progressLabel}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="outline" className={cn("capitalize", statusBadgeClass(displayStatus))}>
                          {displayStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top text-right text-xs text-muted-foreground">
                        <div className="space-y-0.5 whitespace-nowrap">
                          <p>{updatedAt.date}</p>
                          <p>{updatedAt.time}</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-xl border border-border/60 bg-card/60 p-4">
            {selectedEntry ? (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{selectedEntry.title}</h2>
                    <Badge
                      variant="outline"
                      className={cn("capitalize", statusBadgeClass(selectedEntryDisplayStatus ?? selectedEntry.status))}
                    >
                      {selectedEntryDisplayStatus ?? selectedEntry.status}
                    </Badge>
                  </div>
                  {starterPrompt ? <CopyButton value={starterPrompt} label="Copy starter prompt" /> : null}
                </div>

                {detailError ? (
                  <AlertMessage variant="error">
                    Couldn’t load plan details: {detailError}
                  </AlertMessage>
                ) : planDetailQuery.isLoading ? (
                  <SpinnerBlock label="Loading plan details…" />
                ) : planDetail ? (
                  <div className="space-y-4">
                    <div className="space-y-2 rounded-lg border border-border/60 bg-background/30 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Overall progress</p>
                        <p className="text-xs font-medium text-muted-foreground" data-testid="plan-progress-percent">
                          {planDetail.overallProgress.percentComplete}%
                        </p>
                      </div>
                      <Progress
                        value={planDetail.overallProgress.percentComplete}
                        className="h-2"
                        data-testid="plan-progress-bar"
                      />
                      <p className="text-xs text-muted-foreground">
                        {roleCompletionLabel(
                          planDetail.overallProgress.doneCheckpoints,
                          planDetail.overallProgress.totalCheckpoints,
                        )}{" "}
                        checkpoints complete
                      </p>
                    </div>

                    <div className="space-y-2 rounded-lg border border-border/60 bg-background/30 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Where plan left off</p>
                      {planDetail.currentCheckpoint ? (
                        <div className="space-y-2" data-testid="plan-current-checkpoint">
                          <div className="flex flex-wrap items-center gap-2">
                            {(() => {
                              const roleVisual = getRoleVisual(planDetail.currentCheckpoint.role);
                              const RoleIcon = roleVisual.icon;

                              return (
                                <Badge
                                  variant="outline"
                                  className={cn("inline-flex items-center gap-1 text-[10px]", roleVisual.badgeClass)}
                                >
                                  <RoleIcon className="size-3" />
                                  {formatRoleLabel(planDetail.currentCheckpoint.role)}
                                </Badge>
                              );
                            })()}
                            <Badge variant="outline" className="text-[10px]">
                              {planDetail.currentCheckpoint.checkpointId}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] capitalize",
                                checkpointStateBadgeClass(planDetail.currentCheckpoint.state),
                              )}
                            >
                              {formatCheckpointState(planDetail.currentCheckpoint.state)}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {planDetail.currentCheckpoint.message || "No checkpoint message provided."}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatCheckpointTimestamp(planDetail.currentCheckpoint.timestamp)}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No checkpoint activity recorded yet.</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Role checkpoints</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {planDetail.roles.map((role) => {
                          const roleVisual = getRoleVisual(role.role);
                          const RoleIcon = roleVisual.icon;
                          const percentComplete = roleProgressPercent(
                            role.doneCheckpoints,
                            role.totalCheckpoints,
                          );
                          const hasCheckpoints = role.totalCheckpoints > 0;
                          const isComplete = hasCheckpoints && role.doneCheckpoints >= role.totalCheckpoints;

                          return (
                            <div
                              key={role.role}
                              className={cn(
                                "group relative overflow-hidden rounded-xl border px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-all duration-200",
                                roleVisual.cardClass,
                                isComplete ? "ring-1 ring-emerald-400/25" : undefined,
                              )}
                            >
                              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/20 opacity-50" />
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <span
                                    className={cn(
                                      "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border backdrop-blur-sm",
                                      roleVisual.iconClass,
                                    )}
                                  >
                                    <RoleIcon className="size-4" />
                                  </span>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-foreground">
                                      {formatRoleLabel(role.role)}
                                    </p>
                                    <p className={cn("text-[10px] uppercase tracking-[0.11em]", roleVisual.metaClass)}>
                                      {hasCheckpoints ? `${role.totalCheckpoints} checkpoints` : "No checkpoints"}
                                    </p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-semibold tabular-nums text-foreground">
                                    {percentComplete}%
                                  </p>
                                  <span
                                    className={cn(
                                      "inline-flex rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums",
                                      isComplete
                                        ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-100"
                                        : "border-white/15 bg-white/[0.05] text-zinc-200/90",
                                    )}
                                  >
                                    {roleCompletionLabel(role.doneCheckpoints, role.totalCheckpoints)}
                                  </span>
                                </div>
                              </div>

                              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-black/30">
                                <div
                                  className={cn("h-full rounded-full transition-[width] duration-300", roleVisual.progressClass)}
                                  style={{ width: `${percentComplete}%` }}
                                />
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <p className={cn("text-[10px] uppercase tracking-[0.11em]", roleVisual.metaClass)}>
                                  {hasCheckpoints ? `${percentComplete}% complete` : "No checkpoints yet"}
                                </p>
                                <span
                                  className={cn(
                                    "text-[10px] font-medium uppercase tracking-[0.11em]",
                                    isComplete ? "text-emerald-200" : "text-zinc-300/80",
                                  )}
                                >
                                  {isComplete ? "Complete" : hasCheckpoints ? "In progress" : "Pending"}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Summary</p>
                      <div
                        className="max-h-56 space-y-2 overflow-auto rounded-lg border border-cyan-500/15 bg-[#030915] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                        data-testid="plan-summary-content"
                      >
                        {summaryLines.length > 0 ? (
                          summaryLines.map((line, index) => {
                            const keyValueMatch = line.match(/^([^:]{1,40}):\s*(.+)$/);
                            if (!keyValueMatch) {
                              return (
                                <p key={`${index}-${line}`} className="text-xs leading-relaxed text-foreground/90">
                                  {line}
                                </p>
                              );
                            }

                            return (
                              <div
                                key={`${index}-${line}`}
                                className="rounded-md border border-cyan-500/15 bg-[#020714] px-2.5 py-1.5"
                              >
                                <p className="text-[11px] uppercase tracking-wide text-cyan-100/70">
                                  {keyValueMatch[1]}
                                </p>
                                <p className="text-xs leading-relaxed text-zinc-100">{keyValueMatch[2]}</p>
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-xs text-muted-foreground">No summary details available.</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Checkpoints log</p>
                      <div
                        className="max-h-56 space-y-2 overflow-auto rounded-lg border border-border/60 bg-background/30 p-3"
                        data-testid="plan-checkpoints-content"
                      >
                        {checkpointLines.length > 0 ? (
                          checkpointLines.map((line, index) => {
                            if (line.type === "text") {
                              return (
                                <p key={`${index}-${line.text}`} className="text-xs leading-relaxed text-muted-foreground">
                                  {line.text}
                                </p>
                              );
                            }

                            return (
                              <div
                                key={`${line.entry.timestamp}-${index}`}
                                className="rounded-md border border-border/50 bg-background/50 p-2.5"
                                data-testid={`plan-checkpoint-entry-${index}`}
                              >
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <p className="text-[11px] font-medium text-muted-foreground">
                                    {formatCheckpointTimestamp(line.entry.timestamp)}
                                  </p>
                                  {line.entry.role
                                    ? (() => {
                                        const roleVisual = getRoleVisual(line.entry.role);
                                        const RoleIcon = roleVisual.icon;
                                        return (
                                          <Badge
                                            variant="outline"
                                            className={cn(
                                              "inline-flex items-center gap-1 text-[10px]",
                                              roleVisual.badgeClass,
                                            )}
                                          >
                                            <RoleIcon className="size-3" />
                                            {formatRoleLabel(line.entry.role)}
                                          </Badge>
                                        );
                                      })()
                                    : null}
                                  {line.entry.checkpointId ? (
                                    <Badge variant="outline" className="text-[10px]">
                                      {line.entry.checkpointId}
                                    </Badge>
                                  ) : null}
                                  {line.entry.state ? (
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "text-[10px] capitalize",
                                        checkpointStateBadgeClass(line.entry.state),
                                      )}
                                    >
                                      {formatCheckpointState(line.entry.state)}
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-xs leading-relaxed text-foreground/90">
                                  {line.entry.message ?? "Checkpoint event recorded."}
                                </p>
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-xs text-muted-foreground">No checkpoint log entries yet.</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
