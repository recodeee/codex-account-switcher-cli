import { Suspense, lazy, useMemo, useState } from "react";
import { LogOut, Save, Settings2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FirewallSection } from "@/features/firewall/components/firewall-section";
import { ImportSettings } from "@/features/settings/components/import-settings";
import { MedusaConnectionSettings } from "@/features/settings/components/medusa-connection-settings";
import { PasswordSettings } from "@/features/settings/components/password-settings";
import { RoutingSettings } from "@/features/settings/components/routing-settings";
import { patchWorkspaceLocalProfile, readWorkspaceLocalProfile } from "@/features/settings/components/workspace-settings-local";
import { useSettings } from "@/features/settings/hooks/use-settings";
import { StickySessionsSection } from "@/features/sticky-sessions/components/sticky-sessions-section";
import { useWorkspaces } from "@/features/workspaces/hooks/use-workspaces";

const TotpSettings = lazy(() =>
  import("@/features/settings/components/totp-settings").then((module) => ({ default: module.TotpSettings })),
);

export function WorkspaceTab() {
  const { workspacesQuery, deleteMutation } = useWorkspaces();
  const { settingsQuery, updateSettingsMutation } = useSettings();

  const workspace = useMemo(() => {
    const entries = workspacesQuery.data?.entries ?? [];
    return entries.find((entry) => entry.isActive) ?? entries[0] ?? null;
  }, [workspacesQuery.data?.entries]);

  const [name, setName] = useState(() => workspace?.name ?? "");
  const [description, setDescription] = useState(() => readWorkspaceLocalProfile(workspace?.id).description);
  const [context, setContext] = useState(() => readWorkspaceLocalProfile(workspace?.id).context);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const handleSaveGeneral = () => {
    if (!workspace) {
      return;
    }
    patchWorkspaceLocalProfile(workspace.id, {
      description: description.trim(),
      context: context.trim(),
    });
    if (name.trim() !== workspace.name.trim()) {
      toast.message("Workspace name rename is not available yet in this build.");
    } else {
      toast.success("Workspace settings saved");
    }
  };

  const settings = settingsQuery.data;
  const busy = updateSettingsMutation.isPending;

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">General</h2>

        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="space-y-3 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="workspace-name" className="text-xs text-muted-foreground">
                Name
              </Label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="bg-white/[0.03]"
                placeholder="Workspace name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="workspace-description" className="text-xs text-muted-foreground">
                Description
              </Label>
              <Textarea
                id="workspace-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="resize-none bg-white/[0.03]"
                placeholder="What does this workspace focus on?"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="workspace-context" className="text-xs text-muted-foreground">
                Context
              </Label>
              <Textarea
                id="workspace-context"
                value={context}
                onChange={(event) => setContext(event.target.value)}
                rows={4}
                className="resize-none bg-white/[0.03]"
                placeholder="Background information and context for AI agents working in this workspace"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Slug</Label>
              <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-muted-foreground">
                {workspace?.slug ?? "—"}
              </div>
            </div>

            <div className="flex items-center justify-end">
              <Button size="sm" onClick={handleSaveGeneral} disabled={!workspace}>
                <Save className="h-3.5 w-3.5" />
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <LogOut className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Danger Zone</h2>
        </div>

        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Leave workspace</p>
                <p className="text-xs text-muted-foreground">Remove yourself from this workspace.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setConfirmLeave(true)}>
                Leave workspace
              </Button>
            </div>
            <div className="flex flex-col gap-2 border-t border-white/10 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-destructive">Delete workspace</p>
                <p className="text-xs text-muted-foreground">Permanently delete this workspace and all associated data.</p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={!workspace || deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete workspace"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {settings ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Runtime & Security</h2>
          </div>
          <MedusaConnectionSettings />
          <RoutingSettings
            key={`${settings.openaiCacheAffinityMaxAgeSeconds}-${settings.stickyReallocationBudgetThresholdPct}`}
            settings={settings}
            busy={busy}
            onSave={async (payload) => {
              await updateSettingsMutation.mutateAsync(payload);
            }}
          />
          <ImportSettings
            settings={settings}
            busy={busy}
            onSave={async (payload) => {
              await updateSettingsMutation.mutateAsync(payload);
            }}
          />
          <PasswordSettings disabled={busy} />
          <Suspense fallback={null}>
            <TotpSettings
              settings={settings}
              disabled={busy}
              onSave={async (payload) => {
                await updateSettingsMutation.mutateAsync(payload);
              }}
            />
          </Suspense>
          <FirewallSection />
          <StickySessionsSection />
        </section>
      ) : null}

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave workspace</AlertDialogTitle>
            <AlertDialogDescription>
              Leave workspace action is not available yet in this build.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone and will remove workspace resources permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!workspace) {
                  return;
                }
                void deleteMutation.mutateAsync({ workspaceId: workspace.id, workspaceName: workspace.name });
                setConfirmDelete(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
