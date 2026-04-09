import { useState } from "react";
import {
  Circle,
  CircleDotDashed,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Compass,
  ExternalLink,
  FolderTree,
  Image as ImageIcon,
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

type InitialPromptPreview = {
  text: string | null;
  imageUrls: string[];
  imageReferences: string[];
};

function extractInitialPromptImageUrls(markdown: string): string[] {
  const imageUrls = new Set<string>();
  const markdownImageRegex = /!\[[^\]]*]\(([^)\s]+(?:\?[^)\s]*)?)\)/gi;

  for (const match of markdown.matchAll(markdownImageRegex)) {
    const url = match[1]?.trim();
    if (!url) {
      continue;
    }
    if (/^(https?:\/\/|\/|data:image\/)/i.test(url)) {
      imageUrls.add(url);
    }
  }

  const directImageUrlRegex = /(https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|webp|svg)(?:\?[^)\s]*)?)/gi;
  for (const match of markdown.matchAll(directImageUrlRegex)) {
    const url = match[1]?.trim();
    if (url) {
      imageUrls.add(url);
    }
  }

  return [...imageUrls];
}

function extractInitialPromptImageReferences(markdown: string): string[] {
  const references = new Set<string>();
  for (const match of markdown.matchAll(/\[Image\s*#\d+\]/gi)) {
    const value = match[0]?.trim();
    if (value) {
      references.add(value);
    }
  }
  return [...references];
}

function sanitizeInitialPromptText(rawPrompt: string): string | null {
  const withoutImages = rawPrompt
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[Image\s*#\d+\]/gi, " ");
  const normalized = normalizeMarkdownLine(withoutImages).replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function parseInitialPrompt(summaryMarkdown: string): InitialPromptPreview {
  const normalizedMarkdown = summaryMarkdown.replace(/\\n/g, "\n");
  const taskMatch = normalizedMarkdown.match(/^\s*-\s*\*\*(?:Task|Initial Prompt|Prompt):\*\*\s*(.+)$/im);
  if (taskMatch?.[1]) {
    const rawPrompt = taskMatch[1];
    return {
      text: sanitizeInitialPromptText(rawPrompt),
      imageUrls: extractInitialPromptImageUrls(rawPrompt),
      imageReferences: extractInitialPromptImageReferences(rawPrompt),
    };
  }

  const lines = normalizedMarkdown.split("\n");
  const contextHeadingIndex = lines.findIndex((line) => /^##\s+context\b/i.test(line.trim()));
  if (contextHeadingIndex === -1) {
    return {
      text: null,
      imageUrls: [],
      imageReferences: [],
    };
  }

  const contextLines: string[] = [];
  for (const rawLine of lines.slice(contextHeadingIndex + 1)) {
    if (/^##\s+/i.test(rawLine.trim())) {
      break;
    }
    if (!rawLine.trim()) {
      continue;
    }
    contextLines.push(rawLine.trim());
  }

  const contextBlock = contextLines.join("\n");
  const textLine = contextLines.length > 0 ? sanitizeInitialPromptText(contextLines[0]) : null;

  return {
    text: textLine,
    imageUrls: extractInitialPromptImageUrls(contextBlock),
    imageReferences: extractInitialPromptImageReferences(contextBlock),
  };
}

type PlanStepStatus = "completed" | "in-progress" | "pending";

type ParsedRoleTaskItem = {
  id: string;
  title: string;
  status: PlanStepStatus;
  section: string | null;
};

type PlanStepTimelineRow = {
  role: string;
  status: PlanStepStatus;
  doneCheckpoints: number;
  totalCheckpoints: number;
  items: ParsedRoleTaskItem[];
};

function normalizePlanMarkdown(markdown: string): string {
  return markdown.replace(/\\n/g, "\n");
}

function parseRoleTaskItems(tasksMarkdown: string): ParsedRoleTaskItem[] {
  const lines = normalizePlanMarkdown(tasksMarkdown).split("\n");
  const items: ParsedRoleTaskItem[] = [];
  let currentSection: string | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const headingMatch = trimmed.match(/^##\s+(.+)$/);
    if (headingMatch) {
      currentSection = normalizeMarkdownLine(headingMatch[1]);
      continue;
    }

    const checkboxMatch = trimmed.match(/^[-*]\s*\[(x|X| )\]\s*(.+)$/);
    if (!checkboxMatch) {
      continue;
    }

    const status: PlanStepStatus =
      checkboxMatch[1].toLowerCase() === "x" ? "completed" : "pending";
    const normalizedTitle = normalizeMarkdownLine(checkboxMatch[2])
      .replace(/^\d+(?:\.\d+)*\s+/, "")
      .replace(/^\[[^\]]+\]\s*/, "")
      .replace(/^(?:todo|ready|done|in[- ]?progress|pending)\s*-\s*/i, "")
      .trim();

    if (!normalizedTitle) {
      continue;
    }

    items.push({
      id: `${items.length + 1}`,
      title: normalizedTitle,
      status,
      section: currentSection,
    });
  }

  return items;
}

function resolvePlanStepStatus(
  doneCheckpoints: number,
  totalCheckpoints: number,
  isCurrentCheckpointRole: boolean,
): PlanStepStatus {
  if (totalCheckpoints > 0 && doneCheckpoints >= totalCheckpoints) {
    return "completed";
  }
  if (doneCheckpoints > 0 || isCurrentCheckpointRole) {
    return "in-progress";
  }
  return "pending";
}

function statusLabel(status: PlanStepStatus): string {
  if (status === "in-progress") {
    return "in progress";
  }
  return status;
}

function stepStatusBadgeClass(status: PlanStepStatus): string {
  if (status === "completed") {
    return "border-emerald-500/40 bg-emerald-500/20 text-emerald-200";
  }
  if (status === "in-progress") {
    return "border-sky-500/40 bg-sky-500/20 text-sky-200";
  }
  return "border-slate-500/30 bg-slate-500/15 text-slate-300";
}

function StepStatusIcon({
  status,
  className,
}: {
  status: PlanStepStatus;
  className?: string;
}) {
  if (status === "completed") {
    return <CheckCircle2 className={cn("h-4 w-4 text-emerald-400", className)} aria-hidden />;
  }
  if (status === "in-progress") {
    return <CircleDotDashed className={cn("h-4 w-4 text-sky-400", className)} aria-hidden />;
  }
  return <Circle className={cn("h-4 w-4 text-zinc-500", className)} aria-hidden />;
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
  const starterCommand = `$ralph "Continue OpenSpec plan ${planDetail.slug} from the latest checkpoint in ${planPath} without restarting planning."`;

  const lines = [
    starterCommand,
    "",
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
    "Keep each role `tasks.md` checklist updated (`- [ ]` / `- [x]`) because the Plans timeline UI reads those lines as step-by-step progress.",
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
  const [collapsedStepRows, setCollapsedStepRows] = useState<Record<string, boolean>>({});
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
  const initialPrompt = planDetail
    ? parseInitialPrompt(planDetail.summaryMarkdown)
    : { text: null, imageUrls: [], imageReferences: [] };
  const stepTimelineRows: PlanStepTimelineRow[] = planDetail
    ? planDetail.roles.map((role) => {
        const resolvedStatus = resolvePlanStepStatus(
          role.doneCheckpoints,
          role.totalCheckpoints,
          planDetail.currentCheckpoint?.role === role.role,
        );
        const parsedItems = parseRoleTaskItems(role.tasksMarkdown);
        const nonCheckpointItems = parsedItems.filter(
          (item) => !(item.section && /checkpoints?/i.test(item.section)),
        );
        const visibleItems = (nonCheckpointItems.length > 0 ? nonCheckpointItems : parsedItems).slice(0, 4);
        let promotedPending = false;
        const displayItems = visibleItems.map((item) => {
          if (resolvedStatus !== "in-progress" || item.status !== "pending" || promotedPending) {
            return item;
          }
          promotedPending = true;
          return { ...item, status: "in-progress" as const };
        });

        return {
          role: role.role,
          status: resolvedStatus,
          doneCheckpoints: role.doneCheckpoints,
          totalCheckpoints: role.totalCheckpoints,
          items: displayItems,
        };
      })
    : [];

  const toggleStepRow = (role: string) => {
    setCollapsedStepRows((prev) => ({
      ...prev,
      [role]: !(prev[role] ?? false),
    }));
  };
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
                <div className="mb-3 rounded-lg border border-cyan-500/15 bg-gradient-to-r from-[#040c18]/95 via-[#050c16]/95 to-[#060913]/95 p-3 shadow-[0_10px_30px_-24px_rgba(34,211,238,0.75)]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h2 className="truncate text-lg font-semibold">{selectedEntry.title}</h2>
                        <Badge
                          variant="outline"
                          className={cn("capitalize", statusBadgeClass(selectedEntryDisplayStatus ?? selectedEntry.status))}
                        >
                          {selectedEntryDisplayStatus ?? selectedEntry.status}
                        </Badge>
                      </div>
                      {initialPrompt.text ? (
                        <p
                          className="max-w-[44rem] truncate rounded-md border border-white/10 bg-background/35 px-2.5 py-1.5 text-xs text-muted-foreground"
                          data-testid="plan-initial-prompt"
                          title={initialPrompt.text}
                        >
                          <span className="font-medium text-foreground/80">Initial prompt:</span> {initialPrompt.text}
                        </p>
                      ) : null}
                      {initialPrompt.imageUrls.length > 0 || initialPrompt.imageReferences.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2" data-testid="plan-initial-prompt-images">
                          {initialPrompt.imageUrls.map((imageUrl, index) => (
                            <a
                              key={`${imageUrl}-${index}`}
                              href={imageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="group relative block overflow-hidden rounded-md border border-white/15 bg-background/60"
                            >
                              <img
                                src={imageUrl}
                                alt={`Initial prompt attachment ${index + 1}`}
                                className="h-12 w-12 object-cover transition-transform duration-200 group-hover:scale-105"
                                loading="lazy"
                              />
                              <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/60 py-0.5 text-[10px] text-white/90 opacity-0 transition-opacity group-hover:opacity-100">
                                Open <ExternalLink className="h-2.5 w-2.5" />
                              </span>
                            </a>
                          ))}
                          {initialPrompt.imageReferences.map((reference) => (
                            <span
                              key={reference}
                              className="inline-flex items-center gap-1 rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-100/90"
                            >
                              <ImageIcon className="h-3 w-3" />
                              {reference}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="shrink-0">
                      {starterPrompt ? <CopyButton value={starterPrompt} label="Copy starter prompt" /> : null}
                    </div>
                  </div>
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

                    <div
                      className="space-y-2 rounded-lg border border-border/60 bg-background/30 p-3"
                      data-testid="plan-step-timeline"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Plan steps</p>
                        <Badge variant="outline" className="text-[10px]">
                          {stepTimelineRows.length} phases
                        </Badge>
                      </div>

                      {stepTimelineRows.length > 0 ? (
                        <ul className="space-y-2">
                          {stepTimelineRows.map((row) => {
                            const rowKey = row.role;
                            const isCollapsed = collapsedStepRows[rowKey] ?? false;
                            const roleVisual = getRoleVisual(row.role);
                            const RoleIcon = roleVisual.icon;

                            return (
                              <li
                                key={row.role}
                                className="overflow-hidden rounded-md border border-border/50 bg-background/45"
                              >
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left transition-colors hover:bg-background/80"
                                  aria-expanded={!isCollapsed}
                                  onClick={() => toggleStepRow(rowKey)}
                                >
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span
                                      className={cn(
                                        "inline-flex size-6 shrink-0 items-center justify-center rounded-full border",
                                        roleVisual.iconClass,
                                      )}
                                    >
                                      <RoleIcon className="size-3.5" />
                                    </span>
                                    <StepStatusIcon status={row.status} className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate text-sm font-medium">{formatRoleLabel(row.role)}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <Badge variant="outline" className={cn("text-[10px] capitalize", stepStatusBadgeClass(row.status))}>
                                      {statusLabel(row.status)}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px]">
                                      {roleCompletionLabel(row.doneCheckpoints, row.totalCheckpoints)}
                                    </Badge>
                                    <ChevronDown
                                      className={cn(
                                        "h-4 w-4 text-muted-foreground transition-transform duration-200",
                                        isCollapsed ? "-rotate-90" : "rotate-0",
                                      )}
                                      aria-hidden
                                    />
                                  </div>
                                </button>
                                {!isCollapsed ? (
                                  <div className="border-t border-border/40 px-3 py-2">
                                    {row.items.length > 0 ? (
                                      <ul className="space-y-1.5 pl-6">
                                        {row.items.map((item) => (
                                          <li
                                            key={`${row.role}-${item.id}`}
                                            className="group/item flex items-start gap-2"
                                          >
                                            <StepStatusIcon status={item.status} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                            <p
                                              className={cn(
                                                "text-sm text-foreground/90",
                                                item.status === "completed" &&
                                                  "text-muted-foreground line-through transition-[text-decoration-line,color] group-hover/item:text-foreground/90 group-hover/item:[text-decoration-line:none]",
                                              )}
                                            >
                                              {item.title}
                                            </p>
                                          </li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p className="text-xs text-muted-foreground">No task checklist items yet.</p>
                                    )}
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground">No phase data available.</p>
                      )}
                    </div>

                    <div
                      className="space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3"
                      data-testid="plan-left-off-card"
                    >
                      <p className="text-xs uppercase tracking-wide text-red-200/95">Where plan left off</p>
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
                          <p className="text-sm text-red-100/90">
                            {planDetail.currentCheckpoint.message || "No checkpoint message provided."}
                          </p>
                          <p className="text-xs text-red-100/70">
                            {formatCheckpointTimestamp(planDetail.currentCheckpoint.timestamp)}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-red-100/80">No checkpoint activity recorded yet.</p>
                      )}
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
