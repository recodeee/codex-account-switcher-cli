import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { CheckCircle2, ImagePlus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  patchWorkspaceLocalProfile,
  readWorkspaceLocalProfile,
} from "@/features/settings/components/workspace-settings-local";
import { useWorkspaces } from "@/features/workspaces/hooks/use-workspaces";
import type { WorkspaceEntry } from "@/features/workspaces/schemas";
import { cn } from "@/lib/utils";

type WorkspaceDraft = {
  displayName: string;
  label: string;
  description: string;
  context: string;
  avatarDataUrl: string | null;
};

const EMPTY_WORKSPACES: WorkspaceEntry[] = [];

function toWorkspaceDraft(workspace: WorkspaceEntry): WorkspaceDraft {
  const localProfile = readWorkspaceLocalProfile(workspace.id);
  return {
    displayName: localProfile.displayName.trim() || workspace.name,
    label: localProfile.label.trim() || workspace.label,
    description: localProfile.description,
    context: localProfile.context,
    avatarDataUrl: localProfile.avatarDataUrl,
  };
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "W";
  }
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() ?? "")
    .join("");
}

export function WorkspacesTab() {
  const { workspacesQuery, selectMutation, deleteMutation } = useWorkspaces();
  const workspaces = workspacesQuery.data?.entries ?? EMPTY_WORKSPACES;
  const activeWorkspaceId = workspaces.find((workspace) => workspace.isActive)?.id ?? workspaces[0]?.id ?? null;

  const [draftsByWorkspace, setDraftsByWorkspace] = useState<Record<string, WorkspaceDraft>>({});
  const [workspacePendingDelete, setWorkspacePendingDelete] = useState<WorkspaceEntry | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const canDeleteWorkspace = workspaces.length > 1;
  const deletingWorkspaceId = workspacePendingDelete?.id ?? null;

  const drafts = useMemo(() => {
    return workspaces.map((workspace) => ({
      workspace,
      draft: draftsByWorkspace[workspace.id] ?? toWorkspaceDraft(workspace),
    }));
  }, [draftsByWorkspace, workspaces]);

  const updateDraft = (workspaceId: string, patch: Partial<WorkspaceDraft>) => {
    setDraftsByWorkspace((previous) => ({
      ...previous,
      [workspaceId]: {
        ...(previous[workspaceId] ??
          toWorkspaceDraft(
            workspaces.find((entry) => entry.id === workspaceId) ?? {
              id: workspaceId,
              name: "Workspace",
              slug: "workspace",
              label: "Team",
              isActive: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          )),
        ...patch,
      },
    }));
  };

  const handleUploadAvatar = (workspaceId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        return;
      }
      updateDraft(workspaceId, { avatarDataUrl: reader.result });
      toast.success("Workspace avatar updated locally");
    };
    reader.onerror = () => {
      toast.error("Failed to read image");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const handleSaveWorkspace = (workspace: WorkspaceEntry, draft: WorkspaceDraft) => {
    const normalizedDisplayName = draft.displayName.trim();
    const normalizedLabel = draft.label.trim();

    patchWorkspaceLocalProfile(workspace.id, {
      displayName: normalizedDisplayName && normalizedDisplayName !== workspace.name ? normalizedDisplayName : "",
      label: normalizedLabel && normalizedLabel !== workspace.label ? normalizedLabel : "",
      description: draft.description.trim(),
      context: draft.context.trim(),
      avatarDataUrl: draft.avatarDataUrl,
    });

    toast.success(`Saved workspace profile: ${normalizedDisplayName || workspace.name}`);
  };

  if (workspaces.length === 0) {
    return (
      <Card className="border-white/[0.08] bg-white/[0.03]">
        <CardContent className="p-4 text-sm text-muted-foreground">
          No workspaces found.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Workspaces</h2>
        <p className="text-xs text-muted-foreground">
          Manage all workspace profiles, labels, descriptions, and avatars.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {drafts.map(({ workspace, draft }) => {
          const isActive = workspace.id === activeWorkspaceId;
          const displayName = draft.displayName.trim() || workspace.name;
          const avatarSrc = draft.avatarDataUrl;
          const initials = getInitials(displayName);
          const avatarInputId = `workspace-avatar-input-${workspace.id}`;

          return (
            <Card
              key={workspace.id}
              className={cn(
                "border-white/[0.08] bg-white/[0.03]",
                isActive ? "ring-1 ring-emerald-300/40" : "",
              )}
            >
              <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => inputRefs.current[workspace.id]?.click()}
                    aria-label={`Upload avatar for ${workspace.name}`}
                  >
                    {avatarSrc ? (
                      <img src={avatarSrc} alt={`${displayName} avatar`} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-muted-foreground">
                        {initials}
                      </span>
                    )}
                  </button>
                  <input
                    id={avatarInputId}
                    ref={(element) => {
                      inputRefs.current[workspace.id] = element;
                    }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => handleUploadAvatar(workspace.id, event)}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">{workspace.slug}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {isActive ? (
                      <Badge className="border-emerald-300/40 bg-emerald-300/15 text-emerald-100">
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                        Active
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => selectMutation.mutate(workspace.id)}
                        disabled={selectMutation.isPending}
                      >
                        Use workspace
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => inputRefs.current[workspace.id]?.click()}
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      Avatar
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`workspace-name-${workspace.id}`} className="text-xs text-muted-foreground">
                      Name
                    </Label>
                    <Input
                      id={`workspace-name-${workspace.id}`}
                      value={draft.displayName}
                      onChange={(event) => updateDraft(workspace.id, { displayName: event.target.value })}
                      placeholder="Workspace name"
                      className="bg-white/[0.03]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`workspace-label-${workspace.id}`} className="text-xs text-muted-foreground">
                      Label
                    </Label>
                    <Input
                      id={`workspace-label-${workspace.id}`}
                      value={draft.label}
                      onChange={(event) => updateDraft(workspace.id, { label: event.target.value })}
                      placeholder="Team"
                      className="bg-white/[0.03]"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`workspace-description-${workspace.id}`} className="text-xs text-muted-foreground">
                    Description
                  </Label>
                  <Textarea
                    id={`workspace-description-${workspace.id}`}
                    rows={2}
                    value={draft.description}
                    onChange={(event) => updateDraft(workspace.id, { description: event.target.value })}
                    placeholder="What does this workspace focus on?"
                    className="resize-none bg-white/[0.03]"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`workspace-context-${workspace.id}`} className="text-xs text-muted-foreground">
                    Context
                  </Label>
                  <Textarea
                    id={`workspace-context-${workspace.id}`}
                    rows={3}
                    value={draft.context}
                    onChange={(event) => updateDraft(workspace.id, { context: event.target.value })}
                    placeholder="Shared context for agents and members in this workspace"
                    className="resize-none bg-white/[0.03]"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => setWorkspacePendingDelete(workspace)}
                    disabled={isActive || !canDeleteWorkspace || deleteMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                  <Button type="button" size="sm" onClick={() => handleSaveWorkspace(workspace, draft)}>
                    <Save className="h-3.5 w-3.5" />
                    Save changes
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={Boolean(workspacePendingDelete)} onOpenChange={(open) => !open && setWorkspacePendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <strong>{workspacePendingDelete?.name ?? "this workspace"}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!workspacePendingDelete) {
                  return;
                }
                void deleteMutation.mutateAsync({
                  workspaceId: workspacePendingDelete.id,
                  workspaceName: workspacePendingDelete.name,
                });
                setWorkspacePendingDelete(null);
              }}
              disabled={deleteMutation.isPending && deletingWorkspaceId === workspacePendingDelete?.id}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
