import { useMemo, useState } from "react";
import { FolderKanban } from "lucide-react";

import { AlertMessage } from "@/components/alert-message";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SpinnerBlock } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useProjects } from "@/features/projects/hooks/use-projects";
import { useDialogState } from "@/hooks/use-dialog-state";
import { getErrorMessageOrNull } from "@/utils/errors";
import { formatTimeLong } from "@/utils/formatters";

export function ProjectsPage() {
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [editingProjectDescription, setEditingProjectDescription] = useState("");
  const { projectsQuery, createMutation, updateMutation, deleteMutation } = useProjects();
  const deleteDialog = useDialogState<{ id: string; name: string }>();

  const mutationError = useMemo(
    () =>
      getErrorMessageOrNull(projectsQuery.error) ||
      getErrorMessageOrNull(createMutation.error) ||
      getErrorMessageOrNull(updateMutation.error) ||
      getErrorMessageOrNull(deleteMutation.error),
    [projectsQuery.error, createMutation.error, updateMutation.error, deleteMutation.error],
  );

  const entries = projectsQuery.data?.entries ?? [];
  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const addDisabled = busy || editingProjectId !== null;

  const handleAdd = async () => {
    const name = projectName.trim();
    if (!name) {
      return;
    }

    await createMutation.mutateAsync({
      name,
      description: projectDescription.trim() || null,
    });

    setProjectName("");
    setProjectDescription("");
  };

  const handleEditStart = (projectId: string, name: string, description: string | null) => {
    setEditingProjectId(projectId);
    setEditingProjectName(name);
    setEditingProjectDescription(description ?? "");
  };

  const handleEditCancel = () => {
    setEditingProjectId(null);
    setEditingProjectName("");
    setEditingProjectDescription("");
  };

  const handleEditSave = async () => {
    if (!editingProjectId) {
      return;
    }
    const name = editingProjectName.trim();
    if (!name) {
      return;
    }
    await updateMutation.mutateAsync({
      projectId: editingProjectId,
      payload: {
        name,
        description: editingProjectDescription.trim() || null,
      },
    });
    handleEditCancel();
  };

  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Group and manage your project contexts in one place.
        </p>
      </div>

      {mutationError ? <AlertMessage variant="error">{mutationError}</AlertMessage> : null}

      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <FolderKanban className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Saved projects</h3>
            <p className="text-xs text-muted-foreground">Create and maintain reusable project contexts.</p>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project name (e.g. recodee-core)"
              className="h-8 text-xs"
              disabled={addDisabled}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                void handleAdd();
              }}
              disabled={addDisabled || !projectName.trim()}
            >
              Add project
            </Button>
          </div>
          <Textarea
            value={projectDescription}
            onChange={(event) => setProjectDescription(event.target.value)}
            placeholder="Optional description (max 512 characters)"
            className="min-h-20 text-xs"
            disabled={addDisabled}
            maxLength={512}
          />
        </div>

        {projectsQuery.isLoading && !projectsQuery.data ? (
          <div className="py-8">
            <SpinnerBlock />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Add a project name to get started."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-[160px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const isEditing = editingProjectId === entry.id;
                  const updated = formatTimeLong(entry.updatedAt);
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">
                        {isEditing ? (
                          <Input
                            value={editingProjectName}
                            onChange={(event) => setEditingProjectName(event.target.value)}
                            className="h-8 text-xs"
                            disabled={busy}
                            aria-label={`Edit project name for ${entry.name}`}
                          />
                        ) : (
                          entry.name
                        )}
                      </TableCell>
                      <TableCell className="max-w-[460px] align-top">
                        {isEditing ? (
                          <Textarea
                            value={editingProjectDescription}
                            onChange={(event) => setEditingProjectDescription(event.target.value)}
                            className="min-h-20 text-xs"
                            disabled={busy}
                            maxLength={512}
                            aria-label={`Edit project description for ${entry.name}`}
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground">{entry.description || "—"}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {updated.date} {updated.time}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          {isEditing ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => {
                                  void handleEditSave();
                                }}
                                disabled={busy || !editingProjectName.trim()}
                              >
                                Save
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={handleEditCancel}
                                disabled={busy}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditStart(entry.id, entry.name, entry.description)}
                                disabled={busy}
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => deleteDialog.show({ id: entry.id, name: entry.name })}
                                disabled={busy}
                              >
                                Delete
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

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
            if (editingProjectId === target.id) {
              handleEditCancel();
            }
          });
        }}
      />
    </div>
  );
}
