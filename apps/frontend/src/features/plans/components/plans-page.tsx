import { useMemo, useState } from "react";
import {
  Maximize2,
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SpinnerBlock } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listProjects } from "@/features/projects/api";
import { useOpenSpecPlans } from "@/features/plans/hooks/use-open-spec-plans";
import type { OpenSpecPlanDetail } from "@/features/plans/schemas";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { getErrorMessageOrNull } from "@/utils/errors";
import { formatTimeLong } from "@/utils/formatters";

function roleCompletionLabel(done: number, total: number): string {
  return `${done}/${total}`;
}

function isFinishedProgress(progress: { doneCheckpoints: number; totalCheckpoints: number }): boolean {
  return progress.totalCheckpoints > 0 && progress.doneCheckpoints >= progress.totalCheckpoints;
}

function toStatusLabel(status: string): string {
  return status
    .split(/[\s_-]+/g)
    .map((segment) => (segment ? `${segment[0].toUpperCase()}${segment.slice(1)}` : ""))
    .join(" ");
}

type PlanStatusBadge = {
  label: string;
  className: string;
};

function resolvePlanStatusBadge(
  status: string,
  progress: { doneCheckpoints: number; totalCheckpoints: number },
): PlanStatusBadge {
  if (isFinishedProgress(progress)) {
    return {
      label: "Completed",
      className: "border-emerald-500/40 bg-emerald-500/20 text-emerald-200",
    };
  }

  const normalizedStatus = status.trim().toLowerCase().replace(/\s+/g, "-");
  const compactStatus = normalizedStatus.replace(/-/g, "_");

  if (["in_progress", "running", "active", "draft", "proposed", "planning", "pending", "todo"].includes(compactStatus)) {
    return {
      label: "In progress",
      className: "border-sky-500/35 bg-sky-500/15 text-sky-200",
    };
  }

  if (["on_hold", "blocked", "paused", "stalled", "waiting"].includes(compactStatus)) {
    return {
      label: "On hold",
      className: "border-amber-500/40 bg-amber-500/20 text-amber-200",
    };
  }

  if (["inactive", "cancelled", "canceled", "archived", "abandoned"].includes(compactStatus)) {
    return {
      label: "Inactive",
      className: "border-zinc-500/45 bg-zinc-500/20 text-zinc-200",
    };
  }

  if (["approved", "ready"].includes(compactStatus)) {
    return {
      label: "Approved",
      className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
    };
  }

  if (compactStatus === "unknown") {
    return {
      label: "Unknown",
      className: "border-red-500/30 bg-red-500/15 text-red-300",
    };
  }

  return {
    label: toStatusLabel(normalizedStatus || "unknown"),
    className: "border-slate-500/30 bg-slate-500/15 text-slate-300",
  };
}

function getDisplayStatus(
  status: string,
  progress: { doneCheckpoints: number; totalCheckpoints: number },
): string {
  return resolvePlanStatusBadge(status, progress).label;
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

type IncludedPromptCard = {
  key: string;
  id: string;
  title: string;
  content: string;
  bundleTitle: string;
  sourcePath: string;
  checkpointIds: string[];
  status: PlanStepStatus;
  goal: string | null;
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

const PROMPT_WAVE_CHECKPOINT_MAP: Array<{ pattern: RegExp; checkpointIds: string[] }> = [
  { pattern: /\bwave[-\s]?7a\b/i, checkpointIds: ["E1"] },
  { pattern: /\bwave[-\s]?7b\b/i, checkpointIds: ["E2"] },
  { pattern: /\bwave[-\s]?7c\b/i, checkpointIds: ["E3"] },
  { pattern: /\bwave[-\s]?8\b/i, checkpointIds: ["E4", "E5"] },
];

function extractPromptGoal(promptContent: string): string | null {
  const lines = normalizePlanMarkdown(promptContent).split("\n");
  const goalLineIndex = lines.findIndex((line) => /^goal\s*:/i.test(line.trim()));
  if (goalLineIndex === -1) {
    return null;
  }

  const inlineGoal = lines[goalLineIndex].replace(/^goal\s*:\s*/i, "").trim();
  if (inlineGoal) {
    return inlineGoal;
  }

  const goalLines: string[] = [];
  for (const rawLine of lines.slice(goalLineIndex + 1)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (goalLines.length > 0) {
        break;
      }
      continue;
    }
    if (
      /^(hard constraints|owned scope|execution steps|required lock flow|final report|global rules|wave execution order|required per-wave|mandatory verification commands|checkpoint gating|coordinator procedure|blocking rules)\s*:/i.test(
        trimmed,
      )
    ) {
      break;
    }
    goalLines.push(trimmed.replace(/^[-*]\s+/, ""));
  }

  if (goalLines.length === 0) {
    return null;
  }
  return goalLines.join(" ");
}

function parseCheckpointStatusMap(tasksMarkdown: string): Record<string, PlanStepStatus> {
  const statuses: Record<string, PlanStepStatus> = {};
  for (const line of normalizePlanMarkdown(tasksMarkdown).split("\n")) {
    const match = line.trim().match(/^[-*]\s*\[(x|X| )\]\s*\[([A-Za-z]\d+)\]\s+/);
    if (!match) {
      continue;
    }
    statuses[match[2].toUpperCase()] = match[1].toLowerCase() === "x" ? "completed" : "pending";
  }
  return statuses;
}

function resolvePromptCheckpointIds(promptTitle: string, promptContent: string): string[] {
  const source = `${promptTitle}\n${promptContent}`;
  const explicitIds = [...source.matchAll(/\b(E\d+)\b/gi)].map((match) => match[1].toUpperCase());
  if (explicitIds.length > 0) {
    return [...new Set(explicitIds)];
  }

  const inferredIds: string[] = [];
  for (const rule of PROMPT_WAVE_CHECKPOINT_MAP) {
    if (rule.pattern.test(source)) {
      inferredIds.push(...rule.checkpointIds);
    }
  }

  if (/master coordinator prompt/i.test(promptTitle) && inferredIds.length === 0) {
    inferredIds.push("E1", "E2", "E3", "E4", "E5");
  }

  return [...new Set(inferredIds)];
}

function resolvePromptStatus(
  checkpointIds: string[],
  checkpointStatusMap: Record<string, PlanStepStatus>,
): PlanStepStatus {
  if (checkpointIds.length === 0) {
    return "pending";
  }

  let completedCount = 0;
  let hasInProgress = false;

  for (const checkpointId of checkpointIds) {
    const status = checkpointStatusMap[checkpointId];
    if (status === "completed") {
      completedCount += 1;
      continue;
    }
    if (status === "in-progress") {
      hasInProgress = true;
    }
  }

  if (completedCount === checkpointIds.length) {
    return "completed";
  }
  if (hasInProgress || completedCount > 0) {
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

<<<<<<< Updated upstream
type PlanLaunchSuggestion = {
  id: "ralph" | "team";
  title: string;
  description: string;
  command: string;
};

export function buildPlanLaunchSuggestions(planDetail: OpenSpecPlanDetail): PlanLaunchSuggestion[] {
  const plannerPlanPath = `openspec/plan/${planDetail.slug}/planner/plan.md`;

  return [
    {
      id: "ralph",
      title: "Execute sequentially with $ralph",
      description: "Single-owner execution and verification loop for this plan.",
      command: `$ralph execute ${plannerPlanPath}`,
    },
    {
      id: "team",
      title: "Execute in parallel with $team",
      description: "Coordinated parallel lanes (waves + integrator) on the same plan file.",
      command: `$team execute ${plannerPlanPath}`,
    },
  ];
=======
export function buildPlanTeamExecutionPrompt(
  planDetail: OpenSpecPlanDetail,
  displayStatus: string,
  summaryLines: string[],
): string {
  const planPath = `openspec/plan/${planDetail.slug}`;
  const remainingRoles = planDetail.roles.filter((role) => role.doneCheckpoints < role.totalCheckpoints);
  const currentCheckpoint = planDetail.currentCheckpoint;
  const recommendedWorkerCount = Math.max(3, Math.min(6, remainingRoles.length || 1));
  const starterCommand = `$team ${recommendedWorkerCount}:executor "Execute OpenSpec plan ${planDetail.slug} from ${planPath} with master-agent coordination and verification lane."`;

  const lines = [
    starterCommand,
    "",
    "Run this from your Master Agent session to start coordinated team execution for this plan.",
    `Repository: /home/deadpool/Documents/recodee`,
    `Plan workspace: ${planPath}`,
    "",
    "Team execution contract:",
    "- Keep one implementation lane and one verification lane active in parallel.",
    "- Use the plan checkpoint files as source of truth (do not restart planning).",
    "- Track progress by updating role tasks/checkpoints as work completes.",
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
    "Use bundled prompt cards from this plan when delegating waves to teammates.",
    "After team lanes converge, run final verification before shutdown.",
  );

  return lines.join("\n");
>>>>>>> Stashed changes
}

export function PlansPage() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showCompletedPlans, setShowCompletedPlans] = useState(false);
  const [collapsedStepRows, setCollapsedStepRows] = useState<Record<string, boolean>>({});
  const [collapsedPromptCards, setCollapsedPromptCards] = useState<Record<string, boolean>>({});
  const [zoomedPromptKey, setZoomedPromptKey] = useState<string | null>(null);
  const projectsQuery = useQuery({
    queryKey: ["projects", "list", "plans-page"],
    queryFn: listProjects,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const projectEntries = useMemo(
    () => (projectsQuery.data?.entries ?? []).filter((entry) => Boolean(entry.projectPath)),
    [projectsQuery.data?.entries],
  );
  const effectiveProjectId = useMemo(() => {
    if (projectEntries.length === 0) {
      return null;
    }
    if (selectedProjectId && projectEntries.some((entry) => entry.id === selectedProjectId)) {
      return selectedProjectId;
    }
    return projectEntries[0].id;
  }, [projectEntries, selectedProjectId]);
  const { plansQuery, planDetailQuery, effectiveSelectedSlug, allEntries, entries } = useOpenSpecPlans(selectedSlug, {
    projectId: effectiveProjectId,
    showCompleted: showCompletedPlans,
  });

  const projectsError = getErrorMessageOrNull(projectsQuery.error);
  const listError = getErrorMessageOrNull(plansQuery.error);
  const detailError = getErrorMessageOrNull(planDetailQuery.error);
  const planDetail = planDetailQuery.data;

  const selectedEntry = entries.find((entry) => entry.slug === effectiveSelectedSlug) ?? null;

  const selectedEntryDisplayStatus = selectedEntry
    ? getDisplayStatus(selectedEntry.status, selectedEntry.overallProgress)
    : null;
  const summaryLines = planDetail ? parseSummaryLines(planDetail.summaryMarkdown) : [];
  const initialPrompt = selectedEntry
    ? parseInitialPrompt(selectedEntry.summaryMarkdown)
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
  const togglePromptCard = (key: string) => {
    setCollapsedPromptCards((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? true),
    }));
  };
  const starterPrompt =
    planDetail && selectedEntryDisplayStatus
      ? buildPlanStarterPrompt(planDetail, selectedEntryDisplayStatus, summaryLines)
      : "";
<<<<<<< Updated upstream
  const launchSuggestions = planDetail ? buildPlanLaunchSuggestions(planDetail) : [];
=======
  const teamExecutionPrompt =
    planDetail && selectedEntryDisplayStatus
      ? buildPlanTeamExecutionPrompt(planDetail, selectedEntryDisplayStatus, summaryLines)
      : "";
>>>>>>> Stashed changes
  const executorRole = planDetail?.roles.find((role) => role.role.trim().toLowerCase() === "executor") ?? null;
  const executorCheckpointStatusMap = parseCheckpointStatusMap(executorRole?.tasksMarkdown ?? "");
  if (
    planDetail?.currentCheckpoint &&
    planDetail.currentCheckpoint.role.trim().toLowerCase() === "executor" &&
    planDetail.currentCheckpoint.state.trim().toUpperCase() !== "DONE"
  ) {
    const currentExecutorCheckpointId = planDetail.currentCheckpoint.checkpointId.trim().toUpperCase();
    if (executorCheckpointStatusMap[currentExecutorCheckpointId] !== "completed") {
      executorCheckpointStatusMap[currentExecutorCheckpointId] = "in-progress";
    }
  }
  const includedPromptCards: IncludedPromptCard[] = planDetail
    ? planDetail.promptBundles.flatMap((bundle) =>
        bundle.prompts.map((prompt, promptIndex) => {
          const checkpointIds = resolvePromptCheckpointIds(prompt.title, prompt.content);
          return {
            key: `${bundle.id}-${prompt.id}-${promptIndex}`,
            id: prompt.id,
            title: prompt.title,
            content: prompt.content,
            bundleTitle: bundle.title,
            sourcePath: prompt.sourcePath || bundle.sourcePath,
            checkpointIds,
            status: resolvePromptStatus(checkpointIds, executorCheckpointStatusMap),
            goal: extractPromptGoal(prompt.content),
          };
        }),
      )
    : [];
  const zoomedPrompt = includedPromptCards.find((prompt) => prompt.key === zoomedPromptKey) ?? null;

  return (
    <section className="space-y-6">
      <h1 className="sr-only">Plans</h1>

      {listError ? (
        <AlertMessage variant="error">Couldn’t load plans: {listError}</AlertMessage>
      ) : null}
      {projectsError ? (
        <AlertMessage variant="error">Couldn’t load projects: {projectsError}</AlertMessage>
      ) : null}

      <div className="rounded-xl border border-border/60 bg-card/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-[14rem] flex-1 space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/90">Project</p>
            <Select
              value={effectiveProjectId ?? "__current_repository__"}
              onValueChange={(value) => {
                setSelectedSlug(null);
                setSelectedProjectId(value === "__current_repository__" ? null : value);
              }}
              disabled={projectsQuery.isLoading}
            >
              <SelectTrigger className="h-9 bg-background/60 text-sm" data-testid="plans-project-select">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projectEntries.length === 0 ? (
                  <SelectItem value="__current_repository__">Current repository</SelectItem>
                ) : (
                  projectEntries.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={showCompletedPlans}
              onCheckedChange={(checked) => {
                setSelectedSlug(null);
                setShowCompletedPlans(checked);
              }}
              aria-label="Show completed plans"
            />
            Show completed plans
          </label>
        </div>
      </div>

      {plansQuery.isLoading ? (
        <SpinnerBlock label="Loading plans…" />
      ) : allEntries.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="No plans found"
          description="Create a plan workspace under openspec/plan to visualize it here."
        />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="No in-progress plans"
          description='This project only has completed plans right now. Enable "Show completed plans" to view them.'
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(32rem,40rem)_minmax(0,1fr)]">
          <div className="rounded-xl border border-border/60 bg-card/60 p-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[52%]">Plan</TableHead>
                  <TableHead className="w-[18%]">Status</TableHead>
                  <TableHead className="w-[30%] text-right">Created / Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const createdAt = formatTimeLong(entry.createdAt);
                  const updatedAt = formatTimeLong(entry.updatedAt);
                  const statusBadge = resolvePlanStatusBadge(entry.status, entry.overallProgress);
                  const rowInitialPrompt = parseInitialPrompt(entry.summaryMarkdown);
                  const rowAttachmentCount =
                    rowInitialPrompt.imageUrls.length + rowInitialPrompt.imageReferences.length;
                  const progressLabel =
                    entry.overallProgress.totalCheckpoints > 0
                      ? `${roleCompletionLabel(entry.overallProgress.doneCheckpoints, entry.overallProgress.totalCheckpoints)} checkpoints • ${entry.overallProgress.percentComplete}%`
                      : "No checkpoints yet";

                  return (
                    <TableRow
                      key={entry.slug}
                      data-testid={`plan-row-${entry.slug}`}
                      className={cn(
                        "cursor-pointer",
                        entry.slug === effectiveSelectedSlug ? "bg-muted/50" : undefined,
                      )}
                      onClick={() => {
                        setSelectedSlug(entry.slug);
                      }}
                    >
                      <TableCell className="align-top">
                        <div className="space-y-1.5">
                          <p className="truncate font-medium">{entry.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{entry.slug}</p>
                          {rowInitialPrompt.text ? (
                            <p
                              className="truncate text-[11px] text-muted-foreground"
                              title={rowInitialPrompt.text}
                              data-testid={`plan-row-initial-prompt-${entry.slug}`}
                            >
                              <span className="text-foreground/70">Initial prompt:</span> {rowInitialPrompt.text}
                            </p>
                          ) : null}
                          {rowAttachmentCount > 0 ? (
                            <p
                              className="inline-flex w-fit items-center gap-1 rounded-md border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-100/85"
                              data-testid={`plan-row-initial-prompt-attachments-${entry.slug}`}
                            >
                              <ImageIcon className="h-3 w-3" />
                              {rowAttachmentCount} attachment{rowAttachmentCount > 1 ? "s" : ""}
                            </p>
                          ) : null}
                          <div className="space-y-1">
                            <Progress value={entry.overallProgress.percentComplete} className="h-1.5" />
                            <p className="text-[11px] text-muted-foreground">{progressLabel}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="outline" className={cn(statusBadge.className)}>
                          {statusBadge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top text-right text-xs text-muted-foreground">
                        <div className="space-y-1 whitespace-nowrap">
                          <div className="space-y-0.5">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/90">Created</p>
                            <p>{createdAt.date}</p>
                            <p>{createdAt.time}</p>
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/90">Updated</p>
                            <p>{updatedAt.date}</p>
                            <p>{updatedAt.time}</p>
                          </div>
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
                          className={cn(
                            resolvePlanStatusBadge(selectedEntry.status, selectedEntry.overallProgress).className,
                          )}
                        >
                          {resolvePlanStatusBadge(selectedEntry.status, selectedEntry.overallProgress).label}
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
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {teamExecutionPrompt ? (
                        <CopyButton value={teamExecutionPrompt} label="Copy team execution prompt" />
                      ) : null}
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
                      className="space-y-3 rounded-xl border border-emerald-500/20 bg-gradient-to-b from-[#021114] via-[#020b12] to-[#02080f] p-3.5 shadow-[0_16px_38px_-34px_rgba(34,197,94,0.9)]"
                      data-testid="plan-next-step-suggestions"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-wide text-emerald-100/85">Suggested next step</p>
                        <Badge variant="outline" className="border-emerald-400/35 bg-emerald-500/15 text-[10px] text-emerald-100">
                          {launchSuggestions.length} options
                        </Badge>
                      </div>
                      <ol className="space-y-2">
                        {launchSuggestions.map((suggestion, index) => (
                          <li
                            key={suggestion.id}
                            className="rounded-lg border border-emerald-500/20 bg-[#021219]/70 px-3 py-2.5"
                            data-testid={`plan-launch-suggestion-${suggestion.id}`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2.5">
                              <div className="min-w-0 space-y-1">
                                <p className="text-sm font-medium text-emerald-100">
                                  {index + 1}. {suggestion.title}
                                </p>
                                <p className="text-xs text-emerald-100/70">{suggestion.description}</p>
                                <pre className="overflow-auto rounded-md border border-emerald-500/25 bg-[#010b10] px-2 py-1.5 font-mono text-[11px] text-emerald-100/95">
                                  {suggestion.command}
                                </pre>
                              </div>
                              <CopyButton value={suggestion.command} label={`Copy ${suggestion.id} next-step command`} />
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div
                      className="space-y-3 rounded-xl border border-border/60 bg-gradient-to-b from-[#030a16]/85 via-[#020813]/85 to-[#020611]/85 p-3.5"
                      data-testid="plan-included-prompts"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Included AI prompts</p>
                        <Badge variant="outline" className="text-[10px]">
                          {includedPromptCards.length} prompt{includedPromptCards.length === 1 ? "" : "s"}
                        </Badge>
                      </div>

                      {includedPromptCards.length > 0 ? (
                        <ul className="grid gap-2 lg:grid-cols-2">
                          {includedPromptCards.map((prompt) => {
                            const isCollapsed = collapsedPromptCards[prompt.key] ?? true;

                            return (
                              <li
                                key={prompt.key}
                                className="overflow-hidden rounded-lg border border-white/10 bg-[#020913]/70 shadow-[inset_0_1px_0_rgba(148,163,184,0.06)]"
                                data-testid={`plan-included-prompt-card-${prompt.id}`}
                              >
                                <div
                                  className={cn(
                                    "px-2.5 py-2 transition-colors hover:bg-background/30",
                                    !isCollapsed ? "border-b border-border/40" : null,
                                  )}
                                >
                                  <div className="flex items-start gap-2">
                                    <button
                                      type="button"
                                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                                      aria-expanded={!isCollapsed}
                                      onClick={() => togglePromptCard(prompt.key)}
                                    >
                                      <StepStatusIcon status={prompt.status} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                      <div className="min-w-0 space-y-1">
                                        <p className="truncate text-sm font-medium text-foreground/90">{prompt.title}</p>
                                        {prompt.goal ? (
                                          <p className="text-[11px] leading-relaxed text-foreground/85">
                                            <span className="font-semibold text-foreground/95">Goal:</span>
                                            <span className="mt-0.5 block line-clamp-3">{prompt.goal}</span>
                                          </p>
                                        ) : null}
                                      </div>
                                    </button>
                                    <ChevronDown
                                      className={cn(
                                        "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                                        isCollapsed ? "-rotate-90" : "rotate-0",
                                      )}
                                      aria-hidden
                                    />
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-5">
                                    {prompt.status !== "pending" ? (
                                      <Badge
                                        variant="outline"
                                        className={cn("text-[10px] capitalize", stepStatusBadgeClass(prompt.status))}
                                        data-testid={`plan-included-prompt-status-${prompt.id}`}
                                      >
                                        {statusLabel(prompt.status)}
                                      </Badge>
                                    ) : null}
                                    {prompt.checkpointIds.length > 0 ? (
                                      <Badge variant="outline" className="text-[10px]">
                                        {prompt.checkpointIds.join(" · ")}
                                      </Badge>
                                    ) : null}
                                    <CopyButton value={prompt.content} label={`Copy ${prompt.title}`} />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="xs"
                                      onClick={() => setZoomedPromptKey(prompt.key)}
                                      aria-label={`Zoom ${prompt.title}`}
                                    >
                                      <Maximize2 className="size-3" />
                                      Zoom
                                    </Button>
                                  </div>
                                </div>
                                {!isCollapsed ? (
                                  <div className="px-3 py-2">
                                    <pre className="max-h-64 overflow-auto rounded-md border border-border/60 bg-background/30 px-2 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/85">
                                      {prompt.content}
                                    </pre>
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No bundled prompts found for this plan yet.
                        </p>
                      )}
                    </div>
                    <Dialog open={Boolean(zoomedPrompt)} onOpenChange={(open) => (open ? undefined : setZoomedPromptKey(null))}>
                      {zoomedPrompt ? (
                        <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-5xl">
                          <DialogHeader className="border-b border-border/60 bg-[#020714] px-5 py-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 space-y-1">
                                <DialogTitle className="truncate text-base">{zoomedPrompt.title}</DialogTitle>
                                <DialogDescription className="truncate text-xs">
                                  {zoomedPrompt.bundleTitle} · {zoomedPrompt.sourcePath}
                                </DialogDescription>
                                {zoomedPrompt.goal ? (
                                  <p className="text-xs text-cyan-100/80">
                                    <span className="font-semibold text-cyan-100/95">Goal:</span> {zoomedPrompt.goal}
                                  </p>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-1.5 pr-8">
                                <StepStatusIcon status={zoomedPrompt.status} className="h-4 w-4" />
                                {zoomedPrompt.status !== "pending" ? (
                                  <Badge
                                    variant="outline"
                                    className={cn("text-[10px] capitalize", stepStatusBadgeClass(zoomedPrompt.status))}
                                  >
                                    {statusLabel(zoomedPrompt.status)}
                                  </Badge>
                                ) : null}
                                <CopyButton value={zoomedPrompt.content} label={`Copy ${zoomedPrompt.title}`} />
                              </div>
                            </div>
                          </DialogHeader>
                          <div className="overflow-auto p-5">
                            <pre className="max-h-[68vh] overflow-auto rounded-md border border-white/10 bg-[#020714]/90 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-cyan-100/90">
                              {zoomedPrompt.content}
                            </pre>
                          </div>
                        </DialogContent>
                      ) : null}
                    </Dialog>

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
