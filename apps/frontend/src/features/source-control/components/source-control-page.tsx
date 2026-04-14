import { useMemo, useState } from "react";
import {
  Bot,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GripVertical,
  RefreshCw,
  TerminalSquare,
  Workflow,
} from "lucide-react";

import { AlertMessage } from "@/components/alert-message";
import { Button } from "@/components/ui/button";
import { SpinnerBlock } from "@/components/ui/spinner";
import { useProjects } from "@/features/projects/hooks/use-projects";
import { useSourceControl } from "@/features/source-control/hooks/use-source-control";
import type { SourceControlMergeState, SourceControlPreviewResponse } from "@/features/source-control/schemas";
import { useWorkspaces } from "@/features/workspaces/hooks/use-workspaces";
import { cn } from "@/lib/utils";
import { getErrorMessageOrNull } from "@/utils/errors";

function formatIso(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }
  return parsed.toLocaleString();
}

function mergeBadgeClass(mergeState: SourceControlMergeState): string {
  switch (mergeState) {
    case "merged":
      return "border-emerald-400/35 bg-emerald-500/15 text-emerald-200";
    case "ready":
      return "border-cyan-400/35 bg-cyan-500/15 text-cyan-200";
    case "behind":
      return "border-amber-400/35 bg-amber-500/15 text-amber-200";
    case "diverged":
      return "border-rose-400/35 bg-rose-500/15 text-rose-200";
    default:
      return "border-white/20 bg-white/10 text-zinc-300";
  }
}

function toMergeStateLabel(mergeState: SourceControlMergeState): string {
  switch (mergeState) {
    case "merged":
      return "Merged";
    case "ready":
      return "Ready";
    case "behind":
      return "Behind";
    case "diverged":
      return "Diverged";
    default:
      return "Unknown";
  }
}

function checksSummary(data: SourceControlPreviewResponse): string {
  if (data.mergePreview.length === 0) {
    return "checks: no bot branches";
  }
  const diverged = data.mergePreview.filter((entry) => entry.mergeState === "diverged").length;
  if (diverged > 0) {
    return `checks: attention (${diverged} diverged)`;
  }
  const passing = data.mergePreview.filter((entry) =>
    entry.mergeState === "merged" || entry.mergeState === "ready" || entry.mergeState === "behind",
  ).length;
  return `checks: passing (${passing}/${data.mergePreview.length})`;
}

export function SourceControlPage() {
  const { workspacesQuery } = useWorkspaces();
  const activeWorkspaceId = useMemo(() => {
    const entries = workspacesQuery.data?.entries ?? [];
    return entries.find((entry) => entry.isActive)?.id ?? entries[0]?.id ?? null;
  }, [workspacesQuery.data?.entries]);
  const { projectsQuery } = useProjects(activeWorkspaceId);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  const projects = useMemo(() => projectsQuery.data?.entries ?? [], [projectsQuery.data?.entries]);
  const effectiveProjectId = useMemo(() => {
    if (!selectedProjectId) {
      return "";
    }
    return projects.some((project) => project.id === selectedProjectId) ? selectedProjectId : "";
  }, [projects, selectedProjectId]);
  const sourceControlQuery = useSourceControl(effectiveProjectId || null);

  const error = getErrorMessageOrNull(sourceControlQuery.error);
  const data = sourceControlQuery.data;

  const botsByBranch = useMemo(() => {
    if (!data) {
      return new Map<string, string[]>();
    }
    const map = new Map<string, string[]>();
    for (const bot of data.gxBots) {
      if (!bot.matchedBranch) {
        continue;
      }
      const existing = map.get(bot.matchedBranch) ?? [];
      existing.push(bot.botName);
      map.set(bot.matchedBranch, existing);
    }
    return map;
  }, [data]);

  const loading = sourceControlQuery.isLoading && !data;
  if (loading) {
    return (
      <div className="py-12">
        <SpinnerBlock />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Source Control</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            VS Code style commit and merge preview synced with gx bots and subbranch status.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="source-control-project-select">
            Project
          </label>
          <select
            id="source-control-project-select"
            value={effectiveProjectId}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            className="h-9 min-w-[280px] rounded-lg border border-white/15 bg-[#0b1222] px-3 text-sm text-zinc-100 outline-none transition-colors focus:border-cyan-300/45"
          >
            <option value="">Current repository</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => {
              void sourceControlQuery.refetch();
            }}
            disabled={sourceControlQuery.isFetching}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", sourceControlQuery.isFetching ? "animate-spin" : "")} />
            Refresh
          </Button>
        </div>
      </div>

      {error ? <AlertMessage variant="error">{error}</AlertMessage> : null}

      {data ? (
        <section className="relative overflow-hidden rounded-[22px] border border-[#2b3552] bg-[#040b17] font-mono shadow-[0_26px_64px_rgba(0,0,0,0.48)]">
          <div className="pointer-events-none absolute -left-28 top-6 h-52 w-52 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -right-24 bottom-2 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />

          <div className="relative border-b border-white/10 bg-[#111b32]/85 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] tracking-wide text-zinc-300">
              <span className="mr-2 inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400/90" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300/90" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/90" />
              </span>
              <span className="inline-flex rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-cyan-100">
                source-control.tsx
              </span>
              <span className="inline-flex rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-zinc-300">
                commit-preview.tsx
              </span>
              <span className="inline-flex rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-zinc-300">
                merge-preview.tsx
              </span>
              <span className="ml-auto truncate text-zinc-500">{data.repositoryRoot}</span>
            </div>
          </div>

          <div className="relative grid gap-4 p-4 md:grid-cols-[310px_1fr]">
            <aside className="flex min-h-0 gap-3 overflow-hidden rounded-xl border border-white/10 bg-[#0a1425]/85 p-3">
              <div className="flex w-8 shrink-0 flex-col items-center gap-3 pt-1 text-zinc-500">
                <FolderGit2 className="h-4 w-4 text-cyan-300" />
                <GripVertical className="h-4 w-4" />
                <GitBranch className="h-4 w-4" />
                <FileCode2 className="h-4 w-4" />
                <TerminalSquare className="h-4 w-4" />
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <article className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                    <span>Branches</span>
                    <span>{data.branches.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {data.branches.slice(0, 8).map((branch) => (
                      <div
                        key={branch.name}
                        className={cn(
                          "rounded-md border px-2.5 py-1.5 text-[11px]",
                          branch.isActive
                            ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100"
                            : "border-white/10 bg-black/30 text-zinc-300",
                        )}
                      >
                        <p className="truncate font-semibold">{branch.name}</p>
                        <p className="mt-1 text-[10px] text-zinc-500">+{branch.ahead} / -{branch.behind}</p>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-lg border border-white/10 bg-black/25 p-3">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-zinc-400">Changes</div>
                  {data.changedFiles.length === 0 ? (
                    <p className="text-xs text-zinc-500">Working tree is clean.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {data.changedFiles.slice(0, 12).map((file) => (
                        <div
                          key={`${file.path}-${file.code}`}
                          className="flex items-start gap-2 rounded-md border border-white/10 bg-[#030912] px-2 py-1.5"
                        >
                          <span className="mt-0.5 w-4 text-[10px] font-semibold text-emerald-300">{file.code}</span>
                          <span className="min-w-0 truncate text-[11px] text-zinc-300">{file.path}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              </div>
            </aside>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.11em]">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/35 bg-emerald-500/15 px-2.5 py-1 text-emerald-200">
                  Active: {data.activeBranch}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/8 px-2.5 py-1 text-zinc-300">
                  base: {data.baseBranch}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/35 bg-cyan-500/12 px-2.5 py-1 text-cyan-200">
                  {checksSummary(data)}
                </span>
                <span className="ml-auto text-zinc-500">refreshed {formatIso(data.refreshedAt)}</span>
              </div>

              <article className="rounded-xl border border-cyan-500/20 bg-[#061220]/85 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300">
                  <GitCommitHorizontal className="h-3.5 w-3.5 text-cyan-300" />
                  Commit preview
                </div>
                <p className="text-sm font-semibold text-zinc-100">{data.commitPreview.subject}</p>
                {data.commitPreview.body ? (
                  <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-black/25 p-3 text-xs text-zinc-300">
                    {data.commitPreview.body}
                  </pre>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-400">
                  <span>hash: {data.commitPreview.hash ?? "--"}</span>
                  <span>author: {data.commitPreview.authorName ?? "--"}</span>
                  <span>at: {formatIso(data.commitPreview.authoredAt)}</span>
                </div>
              </article>

              <div className="grid gap-4 xl:grid-cols-2">
                <article className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">
                    <GitMerge className="h-3.5 w-3.5 text-emerald-300" />
                    Merge preview
                  </div>
                  <div className="space-y-2">
                    {data.mergePreview.length === 0 ? (
                      <p className="text-xs text-zinc-500">No bot branches detected.</p>
                    ) : (
                      data.mergePreview.map((entry) => (
                        <div key={entry.branch} className="rounded-md border border-white/8 bg-black/20 px-2.5 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-zinc-100">{entry.branch}</p>
                            <span
                              className={cn(
                                "inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]",
                                mergeBadgeClass(entry.mergeState),
                              )}
                            >
                              {toMergeStateLabel(entry.mergeState)}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-zinc-400">ahead {entry.ahead} • behind {entry.behind}</p>
                          {(botsByBranch.get(entry.branch) ?? []).length > 0 ? (
                            <p className="mt-1 truncate text-[10px] uppercase tracking-[0.1em] text-cyan-200">
                              bot: {botsByBranch.get(entry.branch)?.join(", ")}
                            </p>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </article>

                <article className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">
                    <Bot className="h-3.5 w-3.5 text-cyan-300" />
                    GX bot sync
                  </div>
                  <div className="space-y-2">
                    {data.gxBots.length === 0 ? (
                      <p className="text-xs text-zinc-500">No bots configured.</p>
                    ) : (
                      data.gxBots.map((bot) => (
                        <div key={`${bot.botName}-${bot.runtime}`} className="rounded-md border border-white/8 bg-black/20 px-2.5 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-zinc-100">{bot.botName}</p>
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]",
                                bot.inSync
                                  ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-200"
                                  : "border-amber-400/35 bg-amber-500/12 text-amber-200",
                              )}
                            >
                              {bot.inSync ? "in sync" : "missing branch"}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-zinc-400">runtime: {bot.runtime}</p>
                          <p className="mt-1 text-[11px] text-zinc-400">matched branch: {bot.matchedBranch ?? "--"}</p>
                        </div>
                      ))
                    )}
                  </div>
                </article>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1fr_1.25fr]">
                <article className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">
                    <Workflow className="h-3.5 w-3.5 text-cyan-300" />
                    Worktrees
                  </div>
                  <div className="space-y-1.5">
                    {data.worktrees.length === 0 ? (
                      <p className="text-xs text-zinc-500">No worktrees reported.</p>
                    ) : (
                      data.worktrees.map((worktree) => (
                        <div
                          key={worktree.path}
                          className={cn(
                            "rounded-md border px-2.5 py-1.5 text-[11px]",
                            worktree.isCurrent
                              ? "border-cyan-400/30 bg-cyan-500/12 text-cyan-100"
                              : "border-white/10 bg-black/20 text-zinc-300",
                          )}
                        >
                          <p className="truncate">{worktree.path}</p>
                          <p className="mt-1 text-zinc-500">branch: {worktree.branch ?? "detached"}</p>
                        </div>
                      ))
                    )}
                  </div>
                </article>

                <article className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">Quick actions</p>
                  <div className="space-y-1.5">
                    {data.quickActions.map((command) => (
                      <code
                        key={command}
                        className="block overflow-x-auto rounded-md border border-white/10 bg-black/25 px-2.5 py-1.5 font-mono text-[11px] text-cyan-200"
                      >
                        {command}
                      </code>
                    ))}
                  </div>
                </article>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
