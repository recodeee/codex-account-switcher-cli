import { ChevronRight, CircleDot, Ellipsis, Filter, LayoutGrid } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkspaces } from "@/features/workspaces/hooks/use-workspaces";

type IssueStatusKey = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked";

type IssueCard = {
  id: string;
  title: string;
  priority: string;
};

type IssueColumn = {
  key: IssueStatusKey;
  label: string;
  badgeClassName: string;
  panelClassName: string;
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
  {
    key: "blocked",
    label: "Blocked",
    badgeClassName: "border-rose-400/35 bg-rose-500/12 text-rose-300",
    panelClassName: "border-rose-400/20 bg-rose-500/8",
  },
];

const ISSUE_SEED: Record<IssueStatusKey, IssueCard[]> = {
  backlog: [
    { id: "NEW-4", title: "Invite a teammate", priority: "No priority" },
    { id: "NEW-2", title: "Set up your repository connection", priority: "No priority" },
    { id: "NEW-3", title: "Create a skill for your agent", priority: "No priority" },
    { id: "NEW-1", title: "Say hello to the team!", priority: "No priority" },
  ],
  todo: [],
  in_progress: [],
  in_review: [],
  done: [],
  blocked: [],
};

function cloneIssueSeed(): Record<IssueStatusKey, IssueCard[]> {
  return {
    backlog: [...ISSUE_SEED.backlog],
    todo: [...ISSUE_SEED.todo],
    in_progress: [...ISSUE_SEED.in_progress],
    in_review: [...ISSUE_SEED.in_review],
    done: [...ISSUE_SEED.done],
    blocked: [...ISSUE_SEED.blocked],
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

  if (!sourceStatus || !sourceIssue) {
    return columns;
  }

  if (sourceStatus === targetStatus) {
    return columns;
  }

  return {
    ...columns,
    [sourceStatus]: columns[sourceStatus].filter((issue) => issue.id !== issueId),
    [targetStatus]: [...columns[targetStatus], sourceIssue],
  };
}

export function IssuesPage() {
  const { workspacesQuery } = useWorkspaces();
  const [issuesByColumn, setIssuesByColumn] = useState<Record<IssueStatusKey, IssueCard[]>>(() =>
    cloneIssueSeed(),
  );
  const [draggingIssueId, setDraggingIssueId] = useState<string | null>(null);
  const [activeDropColumn, setActiveDropColumn] = useState<IssueStatusKey | null>(null);

  const workspaceName = useMemo(() => {
    const entries = workspacesQuery.data?.entries ?? [];
    return entries.find((entry) => entry.isActive)?.name ?? entries[0]?.name ?? "Workspace";
  }, [workspacesQuery.data?.entries]);

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

  return (
    <div className="flex min-h-[calc(100vh-8.5rem)] flex-col rounded-2xl border border-white/10 bg-[#070a12]">
      <h1 className="sr-only">Issues</h1>
      <div className="flex h-11 items-center justify-between border-b border-white/8 px-4">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="max-w-[160px] truncate font-medium text-zinc-300">{workspaceName}</span>
          <ChevronRight className="h-3 w-3 text-zinc-500" />
          <span className="font-semibold text-white">Issues</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="rounded-md border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white"
          >
            All
          </button>
          <button
            type="button"
            className="rounded-md border border-transparent bg-transparent px-2.5 py-1 text-[11px] font-medium text-zinc-400 hover:border-white/10 hover:bg-white/5 hover:text-zinc-200"
          >
            Members
          </button>
          <button
            type="button"
            className="rounded-md border border-transparent bg-transparent px-2.5 py-1 text-[11px] font-medium text-zinc-400 hover:border-white/10 hover:bg-white/5 hover:text-zinc-200"
          >
            Agents
          </button>
        </div>
      </div>

      <div className="flex h-11 items-center justify-end gap-2 border-b border-white/8 px-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Filter issues"
          className="h-7 w-7 rounded-md border border-white/10 text-zinc-400 hover:bg-white/8 hover:text-zinc-200"
        >
          <Filter className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Board view"
          className="h-7 w-7 rounded-md border border-white/10 bg-white/10 text-zinc-100 hover:bg-white/15"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-x-auto p-3">
        <div className="grid min-h-full min-w-[1200px] grid-cols-6 gap-3">
          {ISSUE_COLUMNS.map((column) => {
            const entries = issuesByColumn[column.key];
            const isDropTarget = activeDropColumn === column.key;

            return (
              <section
                key={column.key}
                aria-label={`${column.label} issues`}
                className={cn(
                  "flex min-w-0 flex-col rounded-xl border p-2 transition-colors",
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
                        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                        column.badgeClassName,
                      )}
                    >
                      <CircleDot className="h-3 w-3" />
                      {column.label}
                    </span>
                    <span className="text-[11px] text-zinc-500">{entries.length}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Column options for ${column.label}`}
                    className="rounded-md p-1 text-zinc-500 hover:bg-white/6 hover:text-zinc-300"
                  >
                    <Ellipsis className="h-3.5 w-3.5" />
                  </button>
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
                        <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                          {issue.id}
                        </p>
                        <p className="mt-1 text-[13px] font-medium text-zinc-100">{issue.title}</p>
                        <span className="mt-2 inline-flex rounded border border-white/12 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          {issue.priority}
                        </span>
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
    </div>
  );
}
