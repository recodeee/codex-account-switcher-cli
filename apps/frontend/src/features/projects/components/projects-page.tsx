import { useMemo, useState } from "react";
import { ChevronRight, CircleDot, ExternalLink, Filter, Folder, FolderOpen, FolderTree, Github, Globe, LayoutGrid, Maximize2, Minimize2, Minus, Pencil, Plus, Trash2, UserCircle2, X } from "lucide-react";

import { AlertMessage } from "@/components/alert-message";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SpinnerBlock } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useProjects } from "@/features/projects/hooks/use-projects";
import type { ProjectEntry, ProjectSandboxMode } from "@/features/projects/schemas";
import { useWorkspaces } from "@/features/workspaces/hooks/use-workspaces";
import { useDialogState } from "@/hooks/use-dialog-state";
import { useNavigate } from "@/lib/router-compat";
import { cn } from "@/lib/utils";
import { getErrorMessageOrNull } from "@/utils/errors";

const DEFAULT_SANDBOX_MODE: ProjectSandboxMode = "workspace-write";
const SANDBOX_MODE_OPTIONS: Array<{ value: ProjectSandboxMode; label: string }> = [
  { value: "read-only", label: "read-only" },
  { value: "workspace-write", label: "workspace-write" },
  { value: "danger-full-access", label: "danger-full-access" },
];

type ProjectDraft = {
  name: string;
  description: string;
  projectUrl: string;
  githubRepoUrl: string;
  projectPath: string;
  sandboxMode: ProjectSandboxMode;
  gitBranch: string;
};

function getEmptyProjectDraft(): ProjectDraft {
  return {
    name: "",
    description: "",
    projectUrl: "",
    githubRepoUrl: "",
    projectPath: "",
    sandboxMode: DEFAULT_SANDBOX_MODE,
    gitBranch: "",
  };
}

function draftFromProject(entry: ProjectEntry): ProjectDraft {
  return {
    name: entry.name,
    description: entry.description ?? "",
    projectUrl: entry.projectUrl ?? "",
    githubRepoUrl: entry.githubRepoUrl ?? "",
    projectPath: entry.projectPath ?? "",
    sandboxMode: entry.sandboxMode,
    gitBranch: entry.gitBranch ?? "",
  };
}

function resolveSandboxBadgeClass(mode: ProjectSandboxMode): string {
  if (mode === "danger-full-access") {
    return "border-red-500/35 bg-red-500/10 text-red-200";
  }
  if (mode === "workspace-write") {
    return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
  }
  return "border-sky-500/35 bg-sky-500/10 text-sky-200";
}

function toPlanSuccessPercent(completedPlans: number, totalPlans: number): number {
  if (totalPlans <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((completedPlans / totalPlans) * 100)));
}

function VsCodeIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-3.5 w-3.5 items-center justify-center overflow-hidden rounded-[2px] bg-[#0f1728]",
        className,
      )}
      aria-hidden="true"
    >
      <img src="/vscode.svg" alt="" className="h-full w-full object-contain" />
    </span>
  );
}

function PlansIcon({ className }: { className?: string }) {
  return (
    <FolderTree className={cn("h-4 w-4 text-slate-200", className)} strokeWidth={2.2} aria-hidden="true" />
  );
}

function clickFromInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest("button,a,input,select,textarea,[role='button']"));
}

type ProjectComposerMode = "create" | "edit";
type ProjectComposerDialogProps = {
  mode: ProjectComposerMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ProjectDraft;
  onDraftChange: (updater: (current: ProjectDraft) => ProjectDraft) => void;
  onSubmit: () => void;
  onPickProjectPath: () => Promise<void>;
  disabled: boolean;
  submitting: boolean;
  pickingProjectPath: boolean;
  workspaceName: string;
};

const PLAN_STAGE_OPTIONS = ["Planned", "In Progress", "Blocked", "Done"] as const;
const PRIORITY_OPTIONS = ["Low", "Medium", "High", "Urgent"] as const;
const LEAD_OPTIONS = ["Lead", "Pair", "Review"] as const;
const PROJECT_TABLE_GRID_CLASS_NAME =
  "grid-cols-[minmax(0,1.1fr)_minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,1fr)_minmax(0,0.78fr)_minmax(0,0.72fr)_minmax(0,0.9fr)_minmax(0,0.72fr)_minmax(0,2.25fr)]";

type ProjectIssueStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";
type ProjectIssuePriority = "none" | "low" | "medium" | "high" | "urgent";

type ProjectIssueMember = {
  id: string;
  name: string;
  initials: string;
  shellClassName: string;
};

type ProjectIssue = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: ProjectIssueStatus;
  priority: ProjectIssuePriority;
  assigneeId: string;
};

type NewIssueDraft = {
  projectId: string;
  title: string;
  description: string;
  status: ProjectIssueStatus;
  priority: ProjectIssuePriority;
  assigneeId: string;
};

const PROJECT_ISSUE_MEMBERS: ProjectIssueMember[] = [
  { id: "member-ar", name: "Alex Rivera", initials: "AR", shellClassName: "bg-emerald-500/20 text-emerald-100 border-emerald-400/35" },
  { id: "member-sk", name: "Sarah Kim", initials: "SK", shellClassName: "bg-sky-500/20 text-sky-100 border-sky-400/35" },
  { id: "member-jd", name: "Jordan Diaz", initials: "JD", shellClassName: "bg-violet-500/20 text-violet-100 border-violet-400/35" },
  { id: "member-cj", name: "Casey James", initials: "CJ", shellClassName: "bg-amber-500/20 text-amber-100 border-amber-400/35" },
];

const PROJECT_ISSUE_COLUMNS: Array<{
  key: ProjectIssueStatus;
  label: string;
  badgeClassName: string;
  panelClassName: string;
}> = [
  {
    key: "backlog",
    label: "Backlog",
    badgeClassName: "border-zinc-500/35 bg-zinc-500/12 text-zinc-200",
    panelClassName: "border-white/12 bg-white/[0.02]",
  },
  {
    key: "todo",
    label: "Todo",
    badgeClassName: "border-zinc-500/35 bg-zinc-500/12 text-zinc-200",
    panelClassName: "border-white/12 bg-zinc-900/50",
  },
  {
    key: "in_progress",
    label: "In Progress",
    badgeClassName: "border-amber-400/35 bg-amber-500/12 text-amber-200",
    panelClassName: "border-amber-400/20 bg-amber-500/[0.08]",
  },
  {
    key: "in_review",
    label: "In Review",
    badgeClassName: "border-emerald-400/35 bg-emerald-500/12 text-emerald-200",
    panelClassName: "border-emerald-400/20 bg-emerald-500/[0.08]",
  },
  {
    key: "done",
    label: "Done",
    badgeClassName: "border-sky-400/35 bg-sky-500/12 text-sky-200",
    panelClassName: "border-sky-400/20 bg-sky-500/[0.08]",
  },
];

function resolveIssuePriorityBadgeClass(priority: ProjectIssuePriority): string {
  if (priority === "urgent") {
    return "border-orange-400/35 bg-orange-500/15 text-orange-100";
  }
  if (priority === "high") {
    return "border-amber-400/35 bg-amber-500/15 text-amber-100";
  }
  if (priority === "medium") {
    return "border-violet-400/35 bg-violet-500/15 text-violet-100";
  }
  if (priority === "low") {
    return "border-zinc-400/30 bg-zinc-500/12 text-zinc-200";
  }
  return "border-zinc-500/25 bg-zinc-500/8 text-zinc-400";
}

function formatIssuePriority(priority: ProjectIssuePriority): string {
  if (priority === "none") {
    return "No priority";
  }
  return priority
    .split("_")
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}

function buildSeedIssues(projectId: string): ProjectIssue[] {
  return [
    {
      id: "MUL-7",
      projectId,
      title: "Add real-time collaborative editing",
      description: "Implement conflict-free real-time editing flow for issue notes.",
      status: "in_review",
      priority: "high",
      assigneeId: "member-ar",
    },
    {
      id: "MUL-10",
      projectId,
      title: "Integrate Stripe billing and subscriptions",
      description: "Add subscription plan sync and billing webhook handling.",
      status: "in_progress",
      priority: "urgent",
      assigneeId: "member-sk",
    },
    {
      id: "MUL-1",
      projectId,
      title: "Set up CI/CD pipeline with GitHub Actions",
      description: "Configure build, test, and deploy checks for pull requests.",
      status: "done",
      priority: "high",
      assigneeId: "member-jd",
    },
    {
      id: "MUL-12",
      projectId,
      title: "Add end-to-end encryption for messages",
      description: "Implement encrypted transport for project conversation threads.",
      status: "todo",
      priority: "high",
      assigneeId: "member-cj",
    },
  ];
}

function getEmptyIssueDraft(projectId: string | null): NewIssueDraft {
  return {
    projectId: projectId ?? "",
    title: "",
    description: "",
    status: "backlog",
    priority: "medium",
    assigneeId: PROJECT_ISSUE_MEMBERS[0]?.id ?? "",
  };
}

function buildNextIssueId(issues: ProjectIssue[]): string {
  const maxNumeric = issues.reduce((max, issue) => {
    const match = /^MUL-(\d+)$/i.exec(issue.id.trim());
    if (!match) {
      return max;
    }
    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(parsed)) {
      return max;
    }
    return Math.max(max, parsed);
  }, 0);
  return `MUL-${maxNumeric + 1}`;
}

function toNavigableHttpUrl(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function CreateProjectDialog({
  mode,
  open,
  onOpenChange,
  draft,
  onDraftChange,
  onSubmit,
  onPickProjectPath,
  disabled,
  submitting,
  pickingProjectPath,
  workspaceName,
}: ProjectComposerDialogProps) {
  const [expanded, setExpanded] = useState(false);
  const [planStageIndex, setPlanStageIndex] = useState(0);
  const [priorityIndex, setPriorityIndex] = useState(1);
  const [leadIndex, setLeadIndex] = useState(0);
  const submitDisabled = disabled || draft.name.trim().length === 0;
  const dialogTitle = mode === "create" ? "New project" : "Edit project";
  const dialogDescription =
    mode === "create"
      ? "Create a reusable project context for Codex tasks."
      : "Update project context details and sandbox settings.";
  const githubHref = toNavigableHttpUrl(draft.githubRepoUrl);
  const projectHref = toNavigableHttpUrl(draft.projectUrl);

  const resetInlineState = () => {
    setExpanded(false);
    setPlanStageIndex(0);
    setPriorityIndex(1);
    setLeadIndex(0);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetInlineState();
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex flex-col gap-0 overflow-hidden border border-white/10 bg-[#0a0d15] p-0 text-foreground shadow-2xl",
          "!top-1/2 !left-1/2 !-translate-x-1/2 !transition-all !duration-300 !ease-out",
          expanded
            ? "!h-[82vh] !w-full !max-w-5xl !-translate-y-1/2"
            : "!h-96 !w-full !max-w-4xl !-translate-y-1/2",
        )}
      >
        <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
        <DialogDescription className="sr-only">{dialogDescription}</DialogDescription>

        <div className="flex items-center justify-between border-b border-white/5 px-5 pb-2 pt-3">
          <div className="flex items-center gap-1.5 text-xs">
            <Folder className="size-3.5 text-amber-300" />
            <span className="text-muted-foreground">{workspaceName}</span>
            <ChevronRight className="size-3 text-muted-foreground/50" />
            <span className="font-medium text-white">{dialogTitle}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              aria-label={expanded ? "Collapse project modal" : "Expand project modal"}
              className="rounded-sm p-1.5 text-muted-foreground/75 transition-colors hover:bg-white/10 hover:text-white"
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="rounded-sm p-1.5 text-muted-foreground/75 transition-colors hover:bg-white/10 hover:text-white"
              title="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-3 px-5 pb-2 pt-4">
            <Folder className="h-5 w-5 text-amber-300" />
            <input
              value={draft.name}
              onChange={(event) => {
                onDraftChange((current) => ({ ...current, name: event.target.value }));
              }}
              placeholder={mode === "create" ? "Project title" : "Project name (e.g. recodee-core)"}
              className="w-full border-0 bg-transparent p-0 text-[2.6rem] font-semibold leading-tight tracking-tight text-white placeholder:text-white/45 focus-visible:outline-none"
              disabled={disabled}
            />
            <div className="flex items-center gap-2">
              <input
                value={draft.projectUrl}
                onChange={(event) => {
                  onDraftChange((current) => ({ ...current, projectUrl: event.target.value }));
                }}
                placeholder={mode === "create" ? "https://project-domain.com" : "https://project-domain.com (optional)"}
                className="w-full border-0 bg-transparent p-0 text-base text-cyan-200/90 placeholder:text-cyan-200/45 focus-visible:outline-none"
                disabled={disabled}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-cyan-200/80 hover:text-cyan-100"
                disabled={disabled || !projectHref}
                title="Open project URL"
                aria-label="Open project URL in new tab"
                onClick={() => {
                  if (!projectHref) {
                    return;
                  }
                  window.open(projectHref, "_blank", "noopener,noreferrer");
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={draft.githubRepoUrl}
                onChange={(event) => {
                  onDraftChange((current) => ({ ...current, githubRepoUrl: event.target.value }));
                }}
                placeholder={mode === "create" ? "https://github.com/owner/repo" : "https://github.com/owner/repo (optional)"}
                className="w-full border-0 bg-transparent p-0 text-sm text-emerald-200/90 placeholder:text-emerald-200/45 focus-visible:outline-none"
                disabled={disabled}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-emerald-200/80 hover:text-emerald-100"
                disabled={disabled || !githubHref}
                title="Open GitHub repository"
                aria-label="Open GitHub repository in new tab"
                onClick={() => {
                  if (!githubHref) {
                    return;
                  }
                  window.open(githubHref, "_blank", "noopener,noreferrer");
                }}
              >
                <Github className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={draft.projectPath}
                onChange={(event) => {
                  onDraftChange((current) => ({ ...current, projectPath: event.target.value }));
                }}
                placeholder={mode === "create" ? "/absolute/path/to/project" : "Absolute project path (optional)"}
                className="w-full border-0 bg-transparent p-0 text-sm font-mono text-muted-foreground/95 placeholder:text-muted-foreground/55 focus-visible:outline-none"
                disabled={disabled}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-muted-foreground/85 hover:text-foreground"
                onClick={() => {
                  void onPickProjectPath();
                }}
                disabled={disabled || pickingProjectPath}
                title={pickingProjectPath ? "Selecting project folder..." : "Select project folder"}
                aria-label="Select project folder"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid gap-3 pt-1 sm:grid-cols-[minmax(0,1fr)_200px]">
              <input
                value={draft.gitBranch}
                onChange={(event) => {
                  onDraftChange((current) => ({ ...current, gitBranch: event.target.value }));
                }}
                placeholder={mode === "create" ? "Git branch (optional)" : "Git branch (optional)"}
                className="w-full border-0 bg-transparent p-0 text-sm font-mono text-slate-200/90 placeholder:text-slate-300/50 focus-visible:outline-none"
                disabled={disabled}
              />
              <Select
                value={draft.sandboxMode}
                onValueChange={(value) => {
                  onDraftChange((current) => ({ ...current, sandboxMode: value as ProjectSandboxMode }));
                }}
                disabled={disabled}
              >
                <SelectTrigger className="h-8 rounded-md border-white/15 bg-white/[0.04] px-2 text-xs text-slate-100">
                  <SelectValue placeholder="Sandbox mode" />
                </SelectTrigger>
                <SelectContent>
                  {SANDBOX_MODE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5">
            <Textarea
              value={draft.description}
              onChange={(event) => {
                onDraftChange((current) => ({ ...current, description: event.target.value }));
              }}
              placeholder={mode === "create" ? "Add description..." : "Optional description (max 512 characters)"}
              className="min-h-full resize-none border-0 bg-transparent px-0 text-2xl text-muted-foreground shadow-none outline-none placeholder:text-muted-foreground/80 focus-visible:ring-0"
              disabled={disabled}
              maxLength={512}
            />
          </div>

          <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t border-white/10 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPlanStageIndex((current) => (current + 1) % PLAN_STAGE_OPTIONS.length);
                }}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-sm transition-colors hover:border-white/35",
                  planStageIndex === 3
                    ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-100"
                    : planStageIndex === 2
                      ? "border-amber-400/35 bg-amber-500/15 text-amber-100"
                      : planStageIndex === 1
                        ? "border-sky-400/35 bg-sky-500/15 text-sky-100"
                        : "border-white/12 bg-white/5 text-white/85",
                )}
                disabled={disabled}
                title="Cycle plan status badge"
              >
                <span className="size-2 rounded-full bg-current/90" />
                {PLAN_STAGE_OPTIONS[planStageIndex]}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPriorityIndex((current) => (current + 1) % PRIORITY_OPTIONS.length);
                }}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-sm transition-colors hover:border-white/35",
                  priorityIndex === 3
                    ? "border-red-400/35 bg-red-500/15 text-red-100"
                    : priorityIndex === 2
                      ? "border-amber-400/35 bg-amber-500/15 text-amber-100"
                      : priorityIndex === 1
                        ? "border-sky-400/35 bg-sky-500/15 text-sky-100"
                        : "border-white/12 bg-white/5 text-white/85",
                )}
                disabled={disabled}
                title="Cycle priority badge"
              >
                <Minus className="size-3.5" />
                {PRIORITY_OPTIONS[priorityIndex]}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLeadIndex((current) => (current + 1) % LEAD_OPTIONS.length);
                }}
                className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-2.5 py-1 text-sm text-white/85 transition-colors hover:border-white/35"
                disabled={disabled}
                title="Cycle lead badge"
              >
                {LEAD_OPTIONS[leadIndex]}
              </button>
            </div>

            <Button
              type="button"
              size="sm"
              onClick={onSubmit}
              disabled={submitDisabled}
              className="h-9 rounded-lg bg-white/20 px-4 text-sm font-semibold text-white hover:bg-white/30"
            >
              {submitting ? (mode === "create" ? "Creating…" : "Saving…") : (mode === "create" ? "Create Project" : "Save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { workspacesQuery } = useWorkspaces();
  const activeWorkspace = useMemo(
    () => (workspacesQuery.data?.entries ?? []).find((entry) => entry.isActive) ?? null,
    [workspacesQuery.data?.entries],
  );
  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const activeWorkspaceName = activeWorkspace?.name ?? "Workspace";
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<ProjectDraft>(() => getEmptyProjectDraft());
  const [editOpen, setEditOpen] = useState(false);
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ProjectDraft>(() => getEmptyProjectDraft());
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [issuesProjectId, setIssuesProjectId] = useState<string | null>(null);
  const [newIssueOpen, setNewIssueOpen] = useState(false);
  const [projectIssues, setProjectIssues] = useState<ProjectIssue[]>([]);
  const [newIssueDraft, setNewIssueDraft] = useState<NewIssueDraft>(() => getEmptyIssueDraft(null));
  const {
    projectsQuery,
    planLinksQuery,
    createMutation,
    updateMutation,
    deleteMutation,
    openFolderMutation,
    pickPathMutation,
  } = useProjects(activeWorkspaceId);
  const deleteDialog = useDialogState<{ id: string; name: string }>();

  const mutationError = useMemo(
    () =>
      getErrorMessageOrNull(projectsQuery.error)
      || getErrorMessageOrNull(createMutation.error)
      || getErrorMessageOrNull(updateMutation.error)
      || getErrorMessageOrNull(deleteMutation.error)
      || getErrorMessageOrNull(openFolderMutation.error)
      || getErrorMessageOrNull(pickPathMutation.error),
    [
      projectsQuery.error,
      createMutation.error,
      updateMutation.error,
      deleteMutation.error,
      openFolderMutation.error,
      pickPathMutation.error,
    ],
  );
  const displayMutationError = useMemo(() => {
    if (!mutationError) {
      return null;
    }
    if (
      mutationError.toLowerCase() === "unexpected error"
      && projectsQuery.isError
    ) {
      return "Couldn’t load projects yet. Check backend status and database migrations, then refresh.";
    }
    return mutationError;
  }, [mutationError, projectsQuery.isError]);

  const entries = useMemo(() => projectsQuery.data?.entries ?? [], [projectsQuery.data?.entries]);
  const effectiveIssuesProjectId =
    issuesProjectId && entries.some((entry) => entry.id === issuesProjectId)
      ? issuesProjectId
      : entries[0]?.id ?? null;
  const resolvedProjectIssues = useMemo(() => {
    const activeProjectIds = new Set(entries.map((entry) => entry.id));
    const retained = projectIssues.filter((issue) => activeProjectIds.has(issue.projectId));
    if (retained.length > 0 || entries.length === 0) {
      return retained;
    }
    return buildSeedIssues(entries[0]?.id ?? "");
  }, [entries, projectIssues]);

  const projectIssuesByStatus = useMemo(() => {
    const grouped: Record<ProjectIssueStatus, ProjectIssue[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
    };
    if (!effectiveIssuesProjectId) {
      return grouped;
    }

    for (const issue of resolvedProjectIssues) {
      if (issue.projectId !== effectiveIssuesProjectId) {
        continue;
      }
      grouped[issue.status].push(issue);
    }
    return grouped;
  }, [effectiveIssuesProjectId, resolvedProjectIssues]);

  const issueStatsByProject = useMemo(() => {
    const map = new Map<string, { total: number; highUrgent: number }>();
    for (const issue of resolvedProjectIssues) {
      const current = map.get(issue.projectId) ?? { total: 0, highUrgent: 0 };
      current.total += 1;
      if (issue.priority === "high" || issue.priority === "urgent") {
        current.highUrgent += 1;
      }
      map.set(issue.projectId, current);
    }
    return map;
  }, [resolvedProjectIssues]);

  const issueMemberById = useMemo(
    () => new Map(PROJECT_ISSUE_MEMBERS.map((member) => [member.id, member] as const)),
    [],
  );

  const selectedProjectIssueCount = useMemo(() => {
    if (!effectiveIssuesProjectId) {
      return 0;
    }
    return issueStatsByProject.get(effectiveIssuesProjectId)?.total ?? 0;
  }, [effectiveIssuesProjectId, issueStatsByProject]);

  const projectPlanLinkById = useMemo(
    () =>
      new Map((planLinksQuery.data?.entries ?? []).map((entry) => [entry.projectId, entry] as const)),
    [planLinksQuery.data?.entries],
  );
  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const openFolderBusyProjectId =
    openFolderMutation.isPending
    && typeof openFolderMutation.variables?.projectId === "string"
      ? openFolderMutation.variables.projectId
      : null;

  const handleAdd = async () => {
    const name = createDraft.name.trim();
    if (!name) {
      return;
    }

    await createMutation.mutateAsync({
      name,
      description: createDraft.description.trim() || null,
      projectUrl: createDraft.projectUrl.trim() || null,
      githubRepoUrl: createDraft.githubRepoUrl.trim() || null,
      projectPath: createDraft.projectPath.trim() || null,
      sandboxMode: createDraft.sandboxMode,
      gitBranch: createDraft.gitBranch.trim() || null,
    });

    setCreateOpen(false);
    setCreateDraft(getEmptyProjectDraft());
  };

  const handleEditStart = (entry: ProjectEntry) => {
    setEditProjectId(entry.id);
    setEditDraft(draftFromProject(entry));
    setEditOpen(true);
  };

  const handleEditCancel = () => {
    setEditOpen(false);
    setEditProjectId(null);
    setEditDraft(getEmptyProjectDraft());
    setActiveRowId(null);
  };

  const handleEditSave = async () => {
    if (!editProjectId) {
      return;
    }
    const name = editDraft.name.trim();
    if (!name) {
      return;
    }
    await updateMutation.mutateAsync({
      projectId: editProjectId,
      payload: {
        name,
        description: editDraft.description.trim() || null,
        projectUrl: editDraft.projectUrl.trim() || null,
        githubRepoUrl: editDraft.githubRepoUrl.trim() || null,
        projectPath: editDraft.projectPath.trim() || null,
        sandboxMode: editDraft.sandboxMode,
        gitBranch: editDraft.gitBranch.trim() || null,
      },
    });

    handleEditCancel();
  };

  const handleCreatePathPick = async () => {
    const payload = await pickPathMutation.mutateAsync();
    if (payload.status !== "selected" || !payload.path) {
      return;
    }
    setCreateDraft((current) => ({ ...current, projectPath: payload.path ?? "" }));
  };

  const handleEditPathPick = async () => {
    const payload = await pickPathMutation.mutateAsync();
    if (payload.status !== "selected" || !payload.path) {
      return;
    }
    setEditDraft((current) => ({ ...current, projectPath: payload.path ?? "" }));
  };

  const handleCreateIssue = () => {
    const projectId = newIssueDraft.projectId.trim();
    const title = newIssueDraft.title.trim();
    if (!projectId || !title) {
      return;
    }
    const assigneeId = issueMemberById.has(newIssueDraft.assigneeId)
      ? newIssueDraft.assigneeId
      : (PROJECT_ISSUE_MEMBERS[0]?.id ?? "");
    if (!assigneeId) {
      return;
    }

    setProjectIssues((current) => [
      ...(() => {
        const activeProjectIds = new Set(entries.map((entry) => entry.id));
        const retained = current.filter((issue) => activeProjectIds.has(issue.projectId));
        const base = retained.length > 0 || entries.length === 0
          ? retained
          : buildSeedIssues(entries[0]?.id ?? "");
        return [
          {
            id: buildNextIssueId(base),
            projectId,
            title,
            description: newIssueDraft.description.trim(),
            status: newIssueDraft.status,
            priority: newIssueDraft.priority,
            assigneeId,
          },
          ...base,
        ];
      })(),
    ]);
    setNewIssueOpen(false);
    setIssuesProjectId(projectId);
    setNewIssueDraft(getEmptyIssueDraft(projectId));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/65 px-5">
        <div className="flex items-center gap-2">
          <Folder className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-sm font-medium">Projects</h1>
          {!projectsQuery.isLoading && entries.length > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">{entries.length}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-full border border-white/15 bg-black px-3 text-xs text-white hover:bg-zinc-900"
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            New project
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
        {displayMutationError ? (
          <AlertMessage variant="error">{displayMutationError}</AlertMessage>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(420px,48%)_minmax(0,1fr)]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/65 bg-card/65">
            {projectsQuery.isLoading && !projectsQuery.data ? (
              <div className="flex flex-1 items-center justify-center py-10">
                <SpinnerBlock />
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
                <Folder className="h-10 w-10 text-muted-foreground/35" />
                <p className="text-sm text-muted-foreground">No projects yet</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    setCreateOpen(true);
                  }}
                >
                  Create your first project
                </Button>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="min-w-0">
                  <div
                    className={cn(
                      "sticky top-0 z-[1] grid h-9 items-center gap-3 border-b border-border/65 bg-background/95 px-5 text-[11px] uppercase tracking-[0.08em] text-muted-foreground backdrop-blur-sm",
                      PROJECT_TABLE_GRID_CLASS_NAME,
                    )}
                  >
                    <span>Name</span>
                    <span>URL</span>
                    <span>GitHub</span>
                    <span>Path</span>
                    <span>Sandbox</span>
                    <span>Branch</span>
                    <span>Plans</span>
                    <span>Issues</span>
                    <span className="text-right">Actions</span>
                  </div>

                  {entries.map((entry) => {
                    const isRowActive = activeRowId === entry.id;
                    const issueStats = issueStatsByProject.get(entry.id) ?? { total: 0, highUrgent: 0 };

                    return (
                      <div
                        key={entry.id}
                        onClick={(event) => {
                          if (clickFromInteractiveElement(event.target)) {
                            return;
                          }
                          setActiveRowId((current) => (current === entry.id ? null : entry.id));
                          setIssuesProjectId(entry.id);
                        }}
                        className={cn(
                          "group/row grid min-h-16 items-center gap-3 border-b border-border/45 px-5 py-0 text-sm transition-colors",
                          PROJECT_TABLE_GRID_CLASS_NAME,
                          isRowActive ? "bg-accent/45" : "hover:bg-accent/35",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{entry.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{entry.description || "No description"}</p>
                        </div>

                        <span className="min-w-0 text-xs text-muted-foreground">
                          {entry.projectUrl ? (
                            <span className="flex min-w-0 items-center gap-1.5">
                              <Globe className="h-3.5 w-3.5 shrink-0 text-cyan-300/80" />
                              <a
                                href={entry.projectUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="truncate text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline"
                              >
                                {entry.projectUrl}
                              </a>
                            </span>
                          ) : (
                            "—"
                          )}
                        </span>

                        <span className="min-w-0 text-xs text-muted-foreground">
                          {entry.githubRepoUrl ? (
                            <span className="flex min-w-0 items-center gap-1.5">
                              <Github className="h-3.5 w-3.5 shrink-0 text-emerald-300/80" />
                              <a
                                href={entry.githubRepoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="truncate text-emerald-300 underline-offset-2 hover:text-emerald-200 hover:underline"
                              >
                                {entry.githubRepoUrl}
                              </a>
                            </span>
                          ) : (
                            "—"
                          )}
                        </span>

                        <div className="flex min-w-0 items-center gap-1">
                          {entry.projectPath ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 shrink-0 text-muted-foreground/80 hover:text-foreground"
                              onClick={() => {
                                void openFolderMutation.mutateAsync({
                                  projectId: entry.id,
                                  target: "file-manager",
                                });
                              }}
                              disabled={busy || openFolderBusyProjectId === entry.id}
                              title="Open in file manager"
                              aria-label={`Open ${entry.name} in file manager`}
                            >
                              <FolderOpen className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                          <span className="truncate font-mono text-xs text-muted-foreground">
                            {entry.projectPath || "—"}
                          </span>
                        </div>

                        <Badge variant="outline" className={cn("justify-center rounded-md px-2 py-0.5 text-[11px] font-medium", resolveSandboxBadgeClass(entry.sandboxMode))}>
                          {entry.sandboxMode}
                        </Badge>

                        <span className="truncate font-mono text-xs text-muted-foreground">{entry.gitBranch || "—"}</span>

                        <div
                          className="min-w-0 text-xs text-muted-foreground"
                          data-testid={`project-plan-count-${entry.id}`}
                        >
                          {(() => {
                            const link = projectPlanLinkById.get(entry.id);
                            const totalPlans = link?.planCount ?? 0;
                            const completedPlans = Math.min(totalPlans, link?.completedPlanCount ?? 0);
                            const completionPercent = toPlanSuccessPercent(completedPlans, totalPlans);
                            const planLabel = `${totalPlans} plan${totalPlans === 1 ? "" : "s"}`;
                            const successLabel = `${completedPlans} successful`;

                            return (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">{planLabel}</span>
                                  <span className="shrink-0 text-[11px] text-emerald-300/90">{successLabel}</span>
                                </div>
                                <Progress value={completionPercent} className="h-1.5 bg-white/10" />
                              </div>
                            );
                          })()}
                        </div>

                        <div className="min-w-0 text-xs text-muted-foreground" data-testid={`project-issue-count-${entry.id}`}>
                          <div className="space-y-1">
                            <p className="truncate">{issueStats.total} issue{issueStats.total === 1 ? "" : "s"}</p>
                            <Badge
                              variant="outline"
                              className={cn(
                                "h-5 rounded px-1.5 text-[10px]",
                                issueStats.highUrgent > 0
                                  ? "border-orange-400/35 bg-orange-500/15 text-orange-100"
                                  : "border-zinc-500/25 bg-zinc-500/10 text-zinc-300/75",
                              )}
                            >
                              {issueStats.highUrgent} urgent/high
                            </Badge>
                          </div>
                        </div>

                        <div className="flex h-full min-h-12 flex-nowrap items-center justify-end whitespace-nowrap">
                          <div
                            className={cn(
                              "flex items-center overflow-hidden transition-all duration-200 ease-out",
                              isRowActive ? "pointer-events-none max-w-0 opacity-0" : "max-w-[260px] opacity-100",
                            )}
                          >
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-11 rounded-r-none rounded-l-md px-3 text-xs"
                              aria-label="Open plans"
                              onClick={() => navigate(`/projects/plans?projectId=${encodeURIComponent(entry.id)}`)}
                              disabled={busy}
                            >
                              <PlansIcon className="mr-1" />
                              Plans
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-11 rounded-none px-3 text-xs"
                              aria-label="Open VSCode"
                              onClick={() => {
                                void openFolderMutation.mutateAsync({
                                  projectId: entry.id,
                                  target: "vscode",
                                });
                              }}
                              disabled={busy || !entry.projectPath || openFolderBusyProjectId === entry.id}
                            >
                              <VsCodeIcon className="mr-1" />
                              VSCode
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-11 w-11 rounded-none px-0 text-xs"
                              onClick={() => {
                                void openFolderMutation.mutateAsync({
                                  projectId: entry.id,
                                  target: "file-manager",
                                });
                              }}
                              disabled={busy || !entry.projectPath || openFolderBusyProjectId === entry.id}
                              title="Open folder"
                            >
                              <FolderOpen className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-11 w-11 rounded-l-none rounded-r-md px-0 text-xs"
                              onClick={() => handleEditStart(entry)}
                              disabled={busy}
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                          <div
                            className={cn(
                              "overflow-hidden transition-all duration-200 ease-out",
                              isRowActive
                                ? "max-w-[150px] translate-x-0 opacity-100"
                                : "pointer-events-none max-w-0 translate-x-2 opacity-0",
                            )}
                          >
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-11 rounded-md px-3 text-xs font-semibold text-red-200 hover:bg-transparent hover:text-red-100"
                              onClick={() => deleteDialog.show({ id: entry.id, name: entry.name })}
                              disabled={busy}
                            >
                              <Trash2 className="mr-1 h-4 w-4" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#090d17]">
            <div className="flex h-11 items-center justify-between border-b border-white/10 px-4">
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-zinc-300" />
                <h2 className="text-sm font-medium text-zinc-100">Issues</h2>
                <Select
                  value={effectiveIssuesProjectId ?? "__none__"}
                  onValueChange={(value) => {
                    if (value === "__none__") {
                      return;
                    }
                    setIssuesProjectId(value);
                    setNewIssueDraft((current) => ({ ...current, projectId: value }));
                  }}
                  disabled={entries.length === 0}
                >
                  <SelectTrigger className="h-7 min-w-[180px] rounded-md border-white/15 bg-white/5 px-2 text-[11px] text-zinc-200">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {entries.length === 0 ? (
                      <SelectItem value="__none__">No project</SelectItem>
                    ) : (
                      entries.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">{selectedProjectIssueCount} issues</span>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 rounded-md border border-white/15 bg-black px-2.5 text-[11px] text-white hover:bg-zinc-900"
                  onClick={() => {
                    if (!effectiveIssuesProjectId) {
                      return;
                    }
                    setNewIssueDraft((current) => ({
                      ...current,
                      projectId: effectiveIssuesProjectId,
                    }));
                    setNewIssueOpen(true);
                  }}
                  disabled={!effectiveIssuesProjectId}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  New Issue
                </Button>
              </div>
            </div>
            <div className="flex h-10 items-center justify-between border-b border-white/10 px-4">
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-md border border-white/15 bg-white/10 px-2 text-[11px] text-zinc-100 hover:bg-white/15"
                >
                  <LayoutGrid className="mr-1 h-3.5 w-3.5" />
                  Board
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-md border border-white/10 px-2 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                >
                  <Filter className="mr-1 h-3.5 w-3.5" />
                  Filter
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-x-auto p-3">
              {entries.length === 0 || !effectiveIssuesProjectId ? (
                <div className="grid h-full place-items-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-zinc-200">Create a project first</p>
                    <p className="text-xs text-zinc-500">Issues are allocated to a selected project.</p>
                  </div>
                </div>
              ) : (
                <div className="grid min-h-full min-w-[980px] grid-cols-5 gap-3" data-testid="projects-issues-board">
                  {PROJECT_ISSUE_COLUMNS.map((column) => {
                    const columnIssues = projectIssuesByStatus[column.key];
                    return (
                      <section
                        key={column.key}
                        className={cn("flex min-w-0 flex-col rounded-xl border p-2", column.panelClassName)}
                        aria-label={`${column.label} issues`}
                      >
                        <div className="mb-2 flex items-center justify-between px-1">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              column.badgeClassName,
                            )}
                          >
                            <CircleDot className="h-3 w-3" />
                            {column.label}
                          </span>
                          <span className="text-[11px] text-zinc-500">{columnIssues.length}</span>
                        </div>
                        <div className="flex min-h-[380px] flex-1 flex-col gap-2">
                          {columnIssues.length > 0 ? (
                            columnIssues.map((issue) => {
                              const assignee = issueMemberById.get(issue.assigneeId);
                              return (
                                <article
                                  key={issue.id}
                                  className="rounded-lg border border-white/10 bg-[#111520] px-3 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.03)]"
                                >
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                                    {issue.id}
                                  </p>
                                  <p className="mt-1 line-clamp-2 text-[13px] font-medium text-zinc-100">{issue.title}</p>
                                  {issue.description ? (
                                    <p className="mt-1 line-clamp-2 text-[11px] text-zinc-400">{issue.description}</p>
                                  ) : null}
                                  <div className="mt-2 flex items-center justify-between gap-2">
                                    <Badge
                                      variant="outline"
                                      className={cn("h-5 rounded px-1.5 text-[10px]", resolveIssuePriorityBadgeClass(issue.priority))}
                                    >
                                      {formatIssuePriority(issue.priority)}
                                    </Badge>
                                    {assignee ? (
                                      <span className="inline-flex items-center gap-1.5 text-[10px] text-zinc-300/90">
                                        <span
                                          className={cn(
                                            "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-semibold",
                                            assignee.shellClassName,
                                          )}
                                        >
                                          {assignee.initials}
                                        </span>
                                        {assignee.name}
                                      </span>
                                    ) : (
                                      <UserCircle2 className="h-4 w-4 text-zinc-500" />
                                    )}
                                  </div>
                                </article>
                              );
                            })
                          ) : (
                            <div className="grid flex-1 place-items-start pt-3">
                              <p className="px-2 text-[11px] text-zinc-600">No issues</p>
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <Dialog
        open={newIssueOpen}
        onOpenChange={(open) => {
          setNewIssueOpen(open);
          if (!open) {
            setNewIssueDraft((current) => getEmptyIssueDraft(current.projectId || effectiveIssuesProjectId));
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>New Issue</DialogTitle>
          <DialogDescription>
            Add a project issue and allocate it to a project board.
          </DialogDescription>
          <div className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Issue title</p>
              <Input
                value={newIssueDraft.title}
                onChange={(event) => {
                  setNewIssueDraft((current) => ({ ...current, title: event.target.value }));
                }}
                placeholder="Issue title"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Description</p>
              <Textarea
                value={newIssueDraft.description}
                onChange={(event) => {
                  setNewIssueDraft((current) => ({ ...current, description: event.target.value }));
                }}
                placeholder="Optional issue description"
                className="min-h-24"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Project</p>
                <Select
                  value={newIssueDraft.projectId || "__none__"}
                  onValueChange={(value) => {
                    if (value === "__none__") {
                      return;
                    }
                    setNewIssueDraft((current) => ({ ...current, projectId: value }));
                  }}
                >
                  <SelectTrigger aria-label="Project">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {entries.length === 0 ? (
                      <SelectItem value="__none__">No project</SelectItem>
                    ) : (
                      entries.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Status</p>
                <Select
                  value={newIssueDraft.status}
                  onValueChange={(value) => {
                    setNewIssueDraft((current) => ({
                      ...current,
                      status: value as ProjectIssueStatus,
                    }));
                  }}
                >
                  <SelectTrigger aria-label="Status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_ISSUE_COLUMNS.map((column) => (
                      <SelectItem key={column.key} value={column.key}>
                        {column.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Priority</p>
                <Select
                  value={newIssueDraft.priority}
                  onValueChange={(value) => {
                    setNewIssueDraft((current) => ({
                      ...current,
                      priority: value as ProjectIssuePriority,
                    }));
                  }}
                >
                  <SelectTrigger aria-label="Priority">
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {(["none", "low", "medium", "high", "urgent"] as ProjectIssuePriority[]).map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        {formatIssuePriority(priority)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Member</p>
                <Select
                  value={newIssueDraft.assigneeId}
                  onValueChange={(value) => {
                    setNewIssueDraft((current) => ({ ...current, assigneeId: value }));
                  }}
                >
                  <SelectTrigger aria-label="Member">
                    <SelectValue placeholder="Select member" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_ISSUE_MEMBERS.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNewIssueOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleCreateIssue}
                disabled={!newIssueDraft.projectId.trim() || !newIssueDraft.title.trim()}
              >
                Create Issue
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CreateProjectDialog
        mode="create"
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open && !createMutation.isPending) {
            setCreateDraft(getEmptyProjectDraft());
          }
        }}
        draft={createDraft}
        onDraftChange={(updater) => {
          setCreateDraft((current) => updater(current));
        }}
        onSubmit={() => {
          void handleAdd();
        }}
        onPickProjectPath={handleCreatePathPick}
        disabled={busy}
        submitting={createMutation.isPending}
        pickingProjectPath={pickPathMutation.isPending}
        workspaceName={activeWorkspaceName}
      />

      <CreateProjectDialog
        mode="edit"
        open={editOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleEditCancel();
            return;
          }
          setEditOpen(open);
        }}
        draft={editDraft}
        onDraftChange={(updater) => {
          setEditDraft((current) => updater(current));
        }}
        onSubmit={() => {
          void handleEditSave();
        }}
        onPickProjectPath={handleEditPathPick}
        disabled={busy || editProjectId == null}
        submitting={updateMutation.isPending}
        pickingProjectPath={pickPathMutation.isPending}
        workspaceName={activeWorkspaceName}
      />

      <ConfirmDialog
        open={deleteDialog.open}
        title="Delete project?"
        description={
          deleteDialog.data
            ? `Remove ${deleteDialog.data.name}? This action cannot be undone.`
            : "This action cannot be undone."
        }
        confirmLabel="Delete"
        onOpenChange={deleteDialog.onOpenChange}
        onConfirm={() => {
          if (!deleteDialog.data) {
            return;
          }
          const target = deleteDialog.data;
          void deleteMutation.mutateAsync(target.id).then(() => {
            deleteDialog.hide();
            setActiveRowId(null);
            if (editProjectId === target.id) {
              handleEditCancel();
            }
          });
        }}
      />
    </div>
  );
}
