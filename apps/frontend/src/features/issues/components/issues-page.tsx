import {
  CalendarDays,
  ChevronRight,
  CircleDot,
  Columns3,
  Ellipsis,
  Filter,
  ListTodo,
  Maximize2,
  Minimize2,
  Paperclip,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useProjects } from "@/features/projects/hooks/use-projects";
import { cn } from "@/lib/utils";
import { useSearchParams } from "@/lib/router-compat";
import { useWorkspaces } from "@/features/workspaces/hooks/use-workspaces";

type IssueScope = "all" | "members" | "agents";
type IssueStatusKey = "backlog" | "todo" | "in_progress" | "in_review" | "done";
type IssuePriorityKey = "none" | "low" | "medium" | "high";
type IssueAssigneeType = "member" | "agent" | null;

type IssueCard = {
  id: string;
  title: string;
  description?: string;
  priority: IssuePriorityKey;
  assigneeType: IssueAssigneeType;
  assigneeName: string | null;
  dueDate: string | null;
  projectId: string | null;
  projectName: string | null;
};

type IssueColumn = {
  key: IssueStatusKey;
  label: string;
  badgeClassName: string;
  panelClassName: string;
};

type CreateIssueInput = {
  title: string;
  description: string;
  status: IssueStatusKey;
  priority: IssuePriorityKey;
  assigneeType: IssueAssigneeType;
  assigneeName: string | null;
  dueDate: string | null;
  projectId: string | null;
  projectName: string | null;
};

type AssigneeOption = {
  type: Exclude<IssueAssigneeType, null>;
  name: string;
};

type IssueProjectOption = {
  id: string;
  name: string;
};

const ISSUE_COLUMNS: IssueColumn[] = [
  {
    key: "backlog",
    label: "Backlog",
    badgeClassName: "border-white/15 bg-white/10 text-zinc-300",
    panelClassName: "border-white/10 bg-white/[0.02]",
  },
  {
    key: "todo",
    label: "Todo",
    badgeClassName: "border-white/15 bg-white/10 text-zinc-300",
    panelClassName: "border-white/10 bg-zinc-900/55",
  },
  {
    key: "in_progress",
    label: "In Progress",
    badgeClassName: "border-amber-400/35 bg-amber-500/12 text-amber-300",
    panelClassName: "border-amber-400/20 bg-amber-500/8",
  },
  {
    key: "in_review",
    label: "In Review",
    badgeClassName: "border-emerald-400/35 bg-emerald-500/12 text-emerald-300",
    panelClassName: "border-emerald-400/20 bg-emerald-500/8",
  },
  {
    key: "done",
    label: "Done",
    badgeClassName: "border-sky-400/35 bg-sky-500/12 text-sky-300",
    panelClassName: "border-sky-400/20 bg-sky-500/8",
  },
];

const PRIORITY_LABELS: Record<IssuePriorityKey, string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
};

const SCOPE_OPTIONS: Array<{ key: IssueScope; label: string }> = [
  { key: "all", label: "All" },
  { key: "members", label: "Members" },
  { key: "agents", label: "Agents" },
];

const MEMBER_OPTIONS: AssigneeOption[] = [
  { type: "member", name: "Nina" },
  { type: "member", name: "Alex" },
  { type: "member", name: "Chris" },
];

const AGENT_OPTIONS: AssigneeOption[] = [
  { type: "agent", name: "Builder Bot" },
  { type: "agent", name: "Review Agent" },
  { type: "agent", name: "QA Agent" },
];

const ISSUE_SEED: Record<IssueStatusKey, IssueCard[]> = {
  backlog: [
    {
      id: "NEW-4",
      title: "Invite a teammate",
      priority: "none",
      assigneeType: "member",
      assigneeName: "Nina",
      dueDate: null,
      projectId: null,
      projectName: null,
    },
    {
      id: "NEW-2",
      title: "Set up your repository connection",
      priority: "none",
      assigneeType: "agent",
      assigneeName: "Builder Bot",
      dueDate: null,
      projectId: null,
      projectName: null,
    },
    {
      id: "NEW-3",
      title: "Create a skill for your agent",
      priority: "none",
      assigneeType: "agent",
      assigneeName: "Review Agent",
      dueDate: null,
      projectId: null,
      projectName: null,
    },
    {
      id: "NEW-1",
      title: "Say hello to the team!",
      priority: "none",
      assigneeType: "member",
      assigneeName: "Alex",
      dueDate: null,
      projectId: null,
      projectName: null,
    },
  ],
  todo: [],
  in_progress: [],
  in_review: [],
  done: [],
};

function cloneIssueSeed(): Record<IssueStatusKey, IssueCard[]> {
  return {
    backlog: [...ISSUE_SEED.backlog],
    todo: [...ISSUE_SEED.todo],
    in_progress: [...ISSUE_SEED.in_progress],
    in_review: [...ISSUE_SEED.in_review],
    done: [...ISSUE_SEED.done],
  };
}

function moveIssueToColumn(
  columns: Record<IssueStatusKey, IssueCard[]>,
  issueId: string,
  targetStatus: IssueStatusKey,
): Record<IssueStatusKey, IssueCard[]> {
  let sourceStatus: IssueStatusKey | null = null;
  let sourceIssue: IssueCard | null = null;

  for (const status of Object.keys(columns) as IssueStatusKey[]) {
    const match = columns[status].find((issue) => issue.id === issueId);
    if (match) {
      sourceStatus = status;
      sourceIssue = match;
      break;
    }
  }

  if (!sourceStatus || !sourceIssue || sourceStatus === targetStatus) {
    return columns;
  }

  return {
    ...columns,
    [sourceStatus]: columns[sourceStatus].filter((issue) => issue.id !== issueId),
    [targetStatus]: [...columns[targetStatus], sourceIssue],
  };
}

function issueMatchesScope(
  issue: IssueCard,
  scope: IssueScope,
  selectedProjectId: string | null,
): boolean {
  if (selectedProjectId && issue.projectId !== selectedProjectId) {
    return false;
  }
  if (scope === "members") {
    return issue.assigneeType === "member";
  }
  if (scope === "agents") {
    return issue.assigneeType === "agent";
  }
  return true;
}

function buildScopedColumns(
  columns: Record<IssueStatusKey, IssueCard[]>,
  scope: IssueScope,
  selectedProjectId: string | null,
): Record<IssueStatusKey, IssueCard[]> {
  return {
    backlog: columns.backlog.filter((issue) => issueMatchesScope(issue, scope, selectedProjectId)),
    todo: columns.todo.filter((issue) => issueMatchesScope(issue, scope, selectedProjectId)),
    in_progress: columns.in_progress.filter((issue) => issueMatchesScope(issue, scope, selectedProjectId)),
    in_review: columns.in_review.filter((issue) => issueMatchesScope(issue, scope, selectedProjectId)),
    done: columns.done.filter((issue) => issueMatchesScope(issue, scope, selectedProjectId)),
  };
}

function resolveNextIssueId(columns: Record<IssueStatusKey, IssueCard[]>): string {
  let highest = 0;
  for (const status of Object.keys(columns) as IssueStatusKey[]) {
    for (const issue of columns[status]) {
      const matched = /^NEW-(\d+)$/i.exec(issue.id);
      if (matched) {
        highest = Math.max(highest, Number.parseInt(matched[1] ?? "0", 10));
      }
    }
  }
  return `NEW-${highest + 1}`;
}

function formatDueDateLabel(value: string | null): string {
  if (!value) {
    return "Due date";
  }
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? "Due date"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function PillButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.03] px-2.5 text-xs text-zinc-300 transition-colors hover:bg-white/10",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

type CreateIssueDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
  defaultStatus: IssueStatusKey;
  selectedProjectId: string | null;
  projectOptions: IssueProjectOption[];
  onCreateIssue: (input: CreateIssueInput) => void;
};

function CreateIssueDialog({
  open,
  onOpenChange,
  workspaceName,
  defaultStatus,
  selectedProjectId,
  projectOptions,
  onCreateIssue,
}: CreateIssueDialogProps) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<IssueStatusKey>(defaultStatus);
  const [priority, setPriority] = useState<IssuePriorityKey>("none");
  const [assigneeType, setAssigneeType] = useState<IssueAssigneeType>(null);
  const [assigneeName, setAssigneeName] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(selectedProjectId);

  useEffect(() => {
    setProjectId(selectedProjectId);
  }, [selectedProjectId]);

  const reset = () => {
    setExpanded(false);
    setTitle("");
    setDescription("");
    setStatus(defaultStatus);
    setPriority("none");
    setAssigneeType(null);
    setAssigneeName(null);
    setDueDate(null);
    setProjectId(selectedProjectId);
  };

  const selectedStatus = ISSUE_COLUMNS.find((column) => column.key === status)?.label ?? "Backlog";
  const selectedAssigneeLabel = assigneeName ?? "Unassigned";
  const selectedProjectLabel = projectOptions.find((entry) => entry.id === projectId)?.name ?? "No project";

  const handleSubmit = () => {
    if (!title.trim()) {
      return;
    }
    onCreateIssue({
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      assigneeType,
      assigneeName,
      dueDate,
      projectId,
      projectName: projectOptions.find((entry) => entry.id === projectId)?.name ?? null,
    });
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          reset();
        } else {
          setStatus(defaultStatus);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex flex-col gap-0 overflow-hidden border border-white/10 bg-[#11131c] p-0 text-foreground shadow-2xl",
          "!top-1/2 !left-1/2 !-translate-x-1/2 !transition-all !duration-300 !ease-out",
          expanded
            ? "!h-[78vh] !w-full !max-w-4xl !-translate-y-1/2"
            : "!h-[380px] !w-full !max-w-2xl !-translate-y-1/2",
        )}
      >
        <DialogTitle className="sr-only">New issue</DialogTitle>
        <DialogDescription className="sr-only">Create a new issue card.</DialogDescription>

        <div className="flex items-center justify-between border-b border-white/5 px-5 pb-2 pt-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-zinc-500">{workspaceName}</span>
            <ChevronRight className="h-3 w-3 text-zinc-600" />
            <span className="font-semibold text-zinc-100">New issue</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              aria-label={expanded ? "Collapse issue modal" : "Expand issue modal"}
              className="rounded-sm p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                reset();
              }}
              aria-label="Close issue modal"
              className="rounded-sm p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-2 pt-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Issue title"
            className="w-full border-0 bg-transparent p-0 text-3xl font-semibold tracking-tight text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none"
          />
        </div>

        <div className="flex min-h-0 flex-1 px-5 pb-2">
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add description..."
            className="h-full min-h-[80px] w-full resize-none border-0 bg-transparent p-0 text-base leading-relaxed text-zinc-300 placeholder:text-zinc-500 focus-visible:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <PillButton>
                <CircleDot className="h-3.5 w-3.5" />
                {selectedStatus}
              </PillButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {ISSUE_COLUMNS.map((column) => (
                <DropdownMenuItem key={column.key} onClick={() => setStatus(column.key)}>
                  <CircleDot className="h-3.5 w-3.5" />
                  {column.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <PillButton>
                <span>Priority</span>
                <span className="text-zinc-500">{PRIORITY_LABELS[priority]}</span>
              </PillButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {(Object.keys(PRIORITY_LABELS) as IssuePriorityKey[]).map((value) => (
                <DropdownMenuItem key={value} onClick={() => setPriority(value)}>
                  {PRIORITY_LABELS[value]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <PillButton>
                <span>{selectedAssigneeLabel}</span>
              </PillButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem
                onClick={() => {
                  setAssigneeType(null);
                  setAssigneeName(null);
                }}
              >
                Unassigned
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Members</DropdownMenuLabel>
                {MEMBER_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.name}
                    onClick={() => {
                      setAssigneeType(option.type);
                      setAssigneeName(option.name);
                    }}
                  >
                    {option.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Agents</DropdownMenuLabel>
                {AGENT_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.name}
                    onClick={() => {
                      setAssigneeType(option.type);
                      setAssigneeName(option.name);
                    }}
                  >
                    {option.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover>
            <PopoverTrigger asChild>
              <PillButton>
                <CalendarDays className="h-3.5 w-3.5" />
                {formatDueDateLabel(dueDate)}
              </PillButton>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 space-y-2 p-3">
              <label htmlFor="issue-due-date" className="text-xs font-medium text-zinc-400">
                Due date
              </label>
              <input
                id="issue-due-date"
                type="date"
                value={dueDate ?? ""}
                onChange={(event) => setDueDate(event.target.value || null)}
                className="w-full rounded-md border border-white/12 bg-[#0b0e15] px-3 py-1.5 text-sm text-zinc-200"
              />
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => setDueDate(null)}
                className="justify-start text-zinc-400 hover:text-zinc-200"
              >
                Clear
              </Button>
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <PillButton>{selectedProjectLabel}</PillButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuItem onClick={() => setProjectId(null)}>No project</DropdownMenuItem>
              <DropdownMenuSeparator />
              {projectOptions.map((projectOption) => (
                <DropdownMenuItem key={projectOption.id} onClick={() => setProjectId(projectOption.id)}>
                  {projectOption.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center justify-between border-t border-white/6 px-4 py-2.5">
          <button
            type="button"
            aria-label="Attach files"
            className="rounded-sm p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <Button size="sm" disabled={!title.trim()} onClick={handleSubmit}>
            Create Issue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function IssuesPage() {
  const { workspacesQuery } = useWorkspaces();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeWorkspace = useMemo(
    () => (workspacesQuery.data?.entries ?? []).find((entry) => entry.isActive) ?? null,
    [workspacesQuery.data?.entries],
  );
  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const { projectsQuery } = useProjects(activeWorkspaceId);
  const [scope, setScope] = useState<IssueScope>("all");
  const [issuesByColumn, setIssuesByColumn] = useState<Record<IssueStatusKey, IssueCard[]>>(() =>
    cloneIssueSeed(),
  );
  const [draggingIssueId, setDraggingIssueId] = useState<string | null>(null);
  const [activeDropColumn, setActiveDropColumn] = useState<IssueStatusKey | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerDefaultStatus, setComposerDefaultStatus] = useState<IssueStatusKey>("backlog");

  const workspaceName = useMemo(() => {
    const entries = workspacesQuery.data?.entries ?? [];
    return entries.find((entry) => entry.isActive)?.name ?? entries[0]?.name ?? "Workspace";
  }, [workspacesQuery.data?.entries]);

  const projectOptions = useMemo(() => {
    const entries = projectsQuery.data?.entries ?? [];
    return entries.map((entry) => ({ id: entry.id, name: entry.name }));
  }, [projectsQuery.data?.entries]);

  const selectedProjectId = useMemo(() => {
    const requestedProjectId = searchParams.get("projectId");
    if (!requestedProjectId) {
      return null;
    }
    return projectOptions.some((project) => project.id === requestedProjectId)
      ? requestedProjectId
      : null;
  }, [projectOptions, searchParams]);

  const selectedProjectName = useMemo(
    () => projectOptions.find((project) => project.id === selectedProjectId)?.name ?? "All projects",
    [projectOptions, selectedProjectId],
  );

  const scopedIssuesByColumn = useMemo(
    () => buildScopedColumns(issuesByColumn, scope, selectedProjectId),
    [issuesByColumn, scope, selectedProjectId],
  );

  const hasScopedIssues = useMemo(
    () => ISSUE_COLUMNS.some((column) => scopedIssuesByColumn[column.key].length > 0),
    [scopedIssuesByColumn],
  );

  const handleDragStart = (event: DragEvent<HTMLElement>, issueId: string) => {
    setDraggingIssueId(issueId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", issueId);
  };

  const handleDragEnd = () => {
    setDraggingIssueId(null);
    setActiveDropColumn(null);
  };

  const handleDragOverColumn = (event: DragEvent<HTMLElement>, status: IssueStatusKey) => {
    if (!draggingIssueId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (activeDropColumn !== status) {
      setActiveDropColumn(status);
    }
  };

  const handleDropToColumn = (event: DragEvent<HTMLElement>, status: IssueStatusKey) => {
    event.preventDefault();
    const issueId = draggingIssueId || event.dataTransfer.getData("text/plain");
    if (!issueId) {
      setActiveDropColumn(null);
      return;
    }
    setIssuesByColumn((previous) => moveIssueToColumn(previous, issueId, status));
    setDraggingIssueId(null);
    setActiveDropColumn(null);
  };

  const openComposer = (status: IssueStatusKey) => {
    setComposerDefaultStatus(status);
    setComposerOpen(true);
  };

  const setProjectFilter = (projectId: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (projectId) {
      nextParams.set("projectId", projectId);
    } else {
      nextParams.delete("projectId");
    }
    setSearchParams(nextParams);
  };

  const handleCreateIssue = (input: CreateIssueInput) => {
    setIssuesByColumn((previous) => {
      const nextIssue: IssueCard = {
        id: resolveNextIssueId(previous),
        title: input.title,
        description: input.description || undefined,
        priority: input.priority,
        assigneeType: input.assigneeType,
        assigneeName: input.assigneeName,
        dueDate: input.dueDate,
        projectId: input.projectId,
        projectName: input.projectName,
      };
      return {
        ...previous,
        [input.status]: [nextIssue, ...previous[input.status]],
      };
    });
  };

  return (
    <>
      <div className="flex h-full w-full min-h-[calc(100vh-8.5rem)] flex-col overflow-hidden border-t border-white/8 bg-[#070a12]">
        <h1 className="sr-only">Issues</h1>

        <div className="flex h-11 items-center justify-between border-b border-white/8 px-4">
          <div className="flex items-center gap-1.5">
            {SCOPE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setScope(option.key)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  scope === option.key
                    ? "border-white/20 bg-white/12 text-white"
                    : "border-transparent bg-transparent text-zinc-400 hover:border-white/10 hover:bg-white/5 hover:text-zinc-200",
                )}
              >
                {option.label}
              </button>
            ))}
            {projectOptions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="ml-1 rounded-md border border-white/12 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-zinc-100"
                    aria-label="Project issues filter"
                  >
                    {selectedProjectName}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem onClick={() => setProjectFilter(null)}>
                    All projects
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {projectOptions.map((project) => (
                    <DropdownMenuItem key={project.id} onClick={() => setProjectFilter(project.id)}>
                      {project.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Filter issues"
              className="h-7 w-7 rounded-md border border-white/10 text-zinc-400 hover:bg-white/8 hover:text-zinc-200"
            >
              <Filter className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Issue view settings"
              className="h-7 w-7 rounded-md border border-white/10 text-zinc-400 hover:bg-white/8 hover:text-zinc-200"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Board view"
              className="h-7 w-7 rounded-md border border-white/10 bg-white/10 text-zinc-100 hover:bg-white/15"
            >
              <Columns3 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {hasScopedIssues ? (
          <div className="flex-1 overflow-x-auto px-4 pb-4 pt-3">
            <div className="flex min-h-full w-full min-w-[1150px] gap-3">
              {ISSUE_COLUMNS.map((column) => {
                const entries = scopedIssuesByColumn[column.key];
                const isDropTarget = activeDropColumn === column.key;

                return (
                  <section
                    key={column.key}
                    role="region"
                    aria-label={`${column.label} issues`}
                    className={cn(
                      "flex min-w-[220px] flex-1 flex-col rounded-xl border p-2 transition-colors",
                      column.panelClassName,
                      isDropTarget ? "ring-1 ring-white/25" : null,
                    )}
                    onDragOver={(event) => handleDragOverColumn(event, column.key)}
                    onDrop={(event) => handleDropToColumn(event, column.key)}
                    onDragLeave={() => {
                      if (activeDropColumn === column.key) {
                        setActiveDropColumn(null);
                      }
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between px-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            column.badgeClassName,
                          )}
                        >
                          <CircleDot className="h-3 w-3" />
                          {column.label}
                        </span>
                        <span className="text-[11px] text-zinc-500">{entries.length}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Column options for ${column.label}`}
                          className="rounded-md p-1 text-zinc-500 hover:bg-white/6 hover:text-zinc-300"
                        >
                          <Ellipsis className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Add issue in ${column.label}`}
                          onClick={() => openComposer(column.key)}
                          className="rounded-md p-1 text-zinc-500 hover:bg-white/6 hover:text-zinc-300"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex min-h-[520px] flex-1 flex-col gap-2">
                      {entries.length > 0 ? (
                        entries.map((issue) => (
                          <article
                            key={issue.id}
                            draggable
                            onDragStart={(event) => handleDragStart(event, issue.id)}
                            onDragEnd={handleDragEnd}
                            className={cn(
                              "rounded-lg border border-white/10 bg-[#111520] px-3 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.03)] transition-opacity",
                              draggingIssueId === issue.id ? "cursor-grabbing opacity-60" : "cursor-grab",
                            )}
                          >
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                              {issue.id}
                            </p>
                            <p className="mt-1 text-[13px] font-medium text-zinc-100">{issue.title}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex rounded border border-white/12 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
                                {PRIORITY_LABELS[issue.priority]}
                              </span>
                              {issue.assigneeType ? (
                                <span className="inline-flex rounded border border-white/12 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
                                  {issue.assigneeType === "member" ? "Member" : "Agent"}: {issue.assigneeName}
                                </span>
                              ) : null}
                              {issue.projectName ? (
                                <span className="inline-flex rounded border border-white/12 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
                                  {issue.projectName}
                                </span>
                              ) : null}
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="grid flex-1 place-items-start pt-4">
                          <p className="px-2 text-[11px] text-zinc-600">No issues</p>
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-2 text-zinc-500">
            <ListTodo className="h-10 w-10 text-zinc-600/70" />
            <p className="text-sm">No issues yet</p>
            <p className="text-xs">Create an issue to get started.</p>
          </div>
        )}
      </div>

      <CreateIssueDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        workspaceName={workspaceName}
        defaultStatus={composerDefaultStatus}
        selectedProjectId={selectedProjectId}
        projectOptions={projectOptions}
        onCreateIssue={handleCreateIssue}
      />
    </>
  );
}
