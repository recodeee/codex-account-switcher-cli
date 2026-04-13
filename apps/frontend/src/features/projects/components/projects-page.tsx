import { useMemo, useState } from "react";
import { FolderKanban, Plus } from "lucide-react";

import { AlertMessage } from "@/components/alert-message";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useDialogState } from "@/hooks/use-dialog-state";
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
  projectPath: string;
  sandboxMode: ProjectSandboxMode;
  gitBranch: string;
};

function getEmptyProjectDraft(): ProjectDraft {
  return {
    name: "",
    description: "",
    projectPath: "",
    sandboxMode: DEFAULT_SANDBOX_MODE,
    gitBranch: "",
  };
}

function draftFromProject(entry: ProjectEntry): ProjectDraft {
  return {
    name: entry.name,
    description: entry.description ?? "",
    projectPath: entry.projectPath ?? "",
    sandboxMode: entry.sandboxMode,
    gitBranch: entry.gitBranch ?? "",
  };
}

function formatRelativeDate(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) {
    return "Today";
  }
  if (days === 1) {
    return "1d ago";
  }
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
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

type ProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  draft: ProjectDraft;
  onDraftChange: (updater: (current: ProjectDraft) => ProjectDraft) => void;
  onSubmit: () => void;
  disabled: boolean;
};

function ProjectDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  draft,
  onDraftChange,
  onSubmit,
  disabled,
}: ProjectDialogProps) {
  const formDisabled = disabled;
  const submitDisabled = formDisabled || draft.name.trim().length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border border-white/10 bg-[#020308]/95 p-0 text-foreground shadow-2xl backdrop-blur-sm">
        <DialogHeader className="space-y-1 border-b border-border/55 px-5 py-4">
          <DialogTitle className="text-base font-semibold tracking-tight">{title}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Project name</Label>
              <Input
                value={draft.name}
                onChange={(event) => {
                  onDraftChange((current) => ({ ...current, name: event.target.value }));
                }}
                placeholder="Project name (e.g. recodee-core)"
                className="h-10 rounded-xl text-xs"
                disabled={formDisabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Absolute path</Label>
              <Input
                value={draft.projectPath}
                onChange={(event) => {
                  onDraftChange((current) => ({ ...current, projectPath: event.target.value }));
                }}
                placeholder="Absolute project path (optional)"
                className="h-10 rounded-xl text-xs"
                disabled={formDisabled}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Git branch</Label>
              <Input
                value={draft.gitBranch}
                onChange={(event) => {
                  onDraftChange((current) => ({ ...current, gitBranch: event.target.value }));
                }}
                placeholder="Git branch (optional)"
                className="h-10 rounded-xl text-xs"
                disabled={formDisabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Sandbox mode</Label>
              <Select
                value={draft.sandboxMode}
                onValueChange={(value) => {
                  onDraftChange((current) => ({ ...current, sandboxMode: value as ProjectSandboxMode }));
                }}
                disabled={formDisabled}
              >
                <SelectTrigger className="h-10 rounded-xl text-xs">
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

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Textarea
              value={draft.description}
              onChange={(event) => {
                onDraftChange((current) => ({ ...current, description: event.target.value }));
              }}
              placeholder="Optional description (max 512 characters)"
              className="min-h-24 rounded-xl text-xs"
              disabled={formDisabled}
              maxLength={512}
            />
          </div>
        </div>

        <DialogFooter className="border-t border-border/55 px-5 py-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={formDisabled}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={submitDisabled}
            className="rounded-lg"
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<ProjectDraft>(() => getEmptyProjectDraft());
  const [editOpen, setEditOpen] = useState(false);
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ProjectDraft>(() => getEmptyProjectDraft());
  const { projectsQuery, createMutation, updateMutation, deleteMutation } = useProjects();
  const deleteDialog = useDialogState<{ id: string; name: string }>();

  const mutationError = useMemo(
    () =>
      getErrorMessageOrNull(projectsQuery.error)
      || getErrorMessageOrNull(createMutation.error)
      || getErrorMessageOrNull(updateMutation.error)
      || getErrorMessageOrNull(deleteMutation.error),
    [
      projectsQuery.error,
      createMutation.error,
      updateMutation.error,
      deleteMutation.error,
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

  const entries = projectsQuery.data?.entries ?? [];
  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  const handleAdd = async () => {
    const name = createDraft.name.trim();
    if (!name) {
      return;
    }

    await createMutation.mutateAsync({
      name,
      description: createDraft.description.trim() || null,
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
        projectPath: editDraft.projectPath.trim() || null,
        sandboxMode: editDraft.sandboxMode,
        gitBranch: editDraft.gitBranch.trim() || null,
      },
    });

    handleEditCancel();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/65 px-5">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
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

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/65 bg-card/65">
          {projectsQuery.isLoading && !projectsQuery.data ? (
            <div className="flex flex-1 items-center justify-center py-10">
              <SpinnerBlock />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
              <FolderKanban className="h-10 w-10 text-muted-foreground/35" />
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
              <div className="min-w-[1040px]">
                <div className="sticky top-0 z-[1] grid h-9 grid-cols-[minmax(240px,1.7fr)_minmax(240px,2fr)_170px_170px_110px_170px] items-center gap-3 border-b border-border/65 bg-background/95 px-5 text-[11px] uppercase tracking-[0.08em] text-muted-foreground backdrop-blur-sm">
                  <span>Name</span>
                  <span>Path</span>
                  <span>Sandbox</span>
                  <span>Branch</span>
                  <span>Updated</span>
                  <span className="text-right">Actions</span>
                </div>

                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="group/row grid min-h-12 grid-cols-[minmax(240px,1.7fr)_minmax(240px,2fr)_170px_170px_110px_170px] items-center gap-3 border-b border-border/45 px-5 py-2 text-sm transition-colors hover:bg-accent/35"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{entry.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{entry.description || "No description"}</p>
                    </div>

                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {entry.projectPath || "—"}
                    </span>

                    <Badge variant="outline" className={cn("justify-center rounded-md px-2 py-0.5 text-[11px] font-medium", resolveSandboxBadgeClass(entry.sandboxMode))}>
                      {entry.sandboxMode}
                    </Badge>

                    <span className="truncate font-mono text-xs text-muted-foreground">{entry.gitBranch || "—"}</span>

                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatRelativeDate(entry.updatedAt)}
                    </span>

                    <div className="flex items-center justify-end gap-1.5 opacity-100 md:opacity-0 md:group-hover/row:opacity-100 transition-opacity">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-md px-2 text-xs"
                        onClick={() => handleEditStart(entry)}
                        disabled={busy}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-md px-2 text-xs text-red-300 hover:text-red-200"
                        onClick={() => deleteDialog.show({ id: entry.id, name: entry.name })}
                        disabled={busy}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <ProjectDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open && !createMutation.isPending) {
            setCreateDraft(getEmptyProjectDraft());
          }
        }}
        title="New project"
        description="Create a reusable project context for Codex tasks."
        submitLabel={createMutation.isPending ? "Creating…" : "Add project"}
        draft={createDraft}
        onDraftChange={(updater) => {
          setCreateDraft((current) => updater(current));
        }}
        onSubmit={() => {
          void handleAdd();
        }}
        disabled={busy}
      />

      <ProjectDialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleEditCancel();
            return;
          }
          setEditOpen(open);
        }}
        title="Edit project"
        description="Update project context details and sandbox settings."
        submitLabel={updateMutation.isPending ? "Saving…" : "Save"}
        draft={editDraft}
        onDraftChange={(updater) => {
          setEditDraft((current) => updater(current));
        }}
        onSubmit={() => {
          void handleEditSave();
        }}
        disabled={busy || editProjectId == null}
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
            if (editProjectId === target.id) {
              handleEditCancel();
            }
          });
        }}
      />
    </div>
  );
}
