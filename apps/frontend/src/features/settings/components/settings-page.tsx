import { FolderGit2, KeyRound, LayoutGrid, Palette, Settings2, UserRound, Users } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountTab } from "@/features/settings/components/account-tab";
import { AppearanceTab } from "@/features/settings/components/appearance-tab";
import { MembersTab } from "@/features/settings/components/members-tab";
import { RepositoriesTab } from "@/features/settings/components/repositories-tab";
import { TokensTab } from "@/features/settings/components/tokens-tab";
import { WorkspaceTab } from "@/features/settings/components/workspace-tab";
import { WorkspacesTab } from "@/features/settings/components/workspaces-tab";
import { useWorkspaces } from "@/features/workspaces/hooks/use-workspaces";

const ACCOUNT_TABS = [
  { value: "profile", label: "Profile", icon: UserRound },
  { value: "appearance", label: "Appearance", icon: Palette },
  { value: "tokens", label: "API Tokens", icon: KeyRound },
] as const;

const WORKSPACE_TABS = [
  { value: "workspaces", label: "Workspaces", icon: LayoutGrid },
  { value: "workspace", label: "General", icon: Settings2 },
  { value: "repositories", label: "Repositories", icon: FolderGit2 },
  { value: "members", label: "Members", icon: Users },
] as const;

export function SettingsPage() {
  const { workspacesQuery } = useWorkspaces();
  const entries = workspacesQuery.data?.entries ?? [];
  const activeWorkspace = entries.find((entry) => entry.isActive) ?? entries[0] ?? null;
  const activeWorkspaceId = activeWorkspace?.id ?? "workspace-none";
  const workspaceLabel = activeWorkspace?.name?.trim() || "Workspace";

  return (
    <div className="animate-fade-in-up">
      <Tabs
        defaultValue="profile"
        orientation="vertical"
        className="min-h-[calc(100vh-11rem)] overflow-hidden rounded-2xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,10,18,0.98)_0%,rgba(3,5,12,1)_100%)]"
      >
        <div className="w-56 shrink-0 border-r border-white/[0.08] bg-black/20 p-4">
          <h1 className="mb-4 px-2 text-sm font-semibold text-foreground">Settings</h1>

          <TabsList variant="line" className="w-full flex-col items-stretch gap-0.5">
            <span className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">My Account</span>
            {ACCOUNT_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="h-8 text-sm">
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </TabsTrigger>
            ))}

            <span className="truncate px-2 pb-1 pt-4 text-xs font-medium text-muted-foreground">{workspaceLabel}</span>
            {WORKSPACE_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="h-8 text-sm">
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl p-6">
            <TabsContent value="profile">
              <AccountTab />
            </TabsContent>
            <TabsContent value="appearance">
              <AppearanceTab />
            </TabsContent>
            <TabsContent value="tokens">
              <TokensTab />
            </TabsContent>
            <TabsContent value="workspace">
              <WorkspaceTab key={`workspace-${activeWorkspaceId}`} />
            </TabsContent>
            <TabsContent value="workspaces">
              <WorkspacesTab />
            </TabsContent>
            <TabsContent value="repositories">
              <RepositoriesTab key={`repositories-${activeWorkspaceId}`} />
            </TabsContent>
            <TabsContent value="members">
              <MembersTab key={`members-${activeWorkspaceId}`} />
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
