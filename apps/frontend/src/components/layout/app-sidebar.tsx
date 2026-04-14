import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  FolderTree,
  GitBranch,
  HardDrive,
  LayoutDashboard,
  ListTodo,
  Link2,
  PanelsTopLeft,
  Plus,
  Share2,
  Server,
  Settings2,
  Sparkles,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink } from "@/lib/router-compat";

import { CodexLogo } from "@/components/brand/codex-logo";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { WorkspaceOnboardingDialog } from "@/features/workspaces/components/workspace-onboarding-dialog";
import { useWorkspaces } from "@/features/workspaces/hooks/use-workspaces";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SidebarNavEntry = {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  children?: SidebarNavEntry[];
};

function workspaceMonogram(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "W";
  }
  const first = trimmed[0];
  return first ? first.toUpperCase() : "W";
}

const WORKSPACE_LINKS: SidebarNavEntry[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/issues", label: "Issues", icon: ListTodo },
  {
    to: "/projects",
    label: "Projects",
    icon: PanelsTopLeft,
    children: [{ to: "/projects/plans", label: "Plans", icon: FolderTree }],
  },
  { to: "/agents", label: "Agents", icon: Bot },
];

const MANAGER_LINKS: SidebarNavEntry[] = [
  { to: "/skills", label: "Skills", icon: Sparkles },
  { to: "/source-control", label: "Source Control", icon: GitBranch },
  { to: "/storage", label: "Storage", icon: HardDrive, badge: "Soon" },
  { to: "/accounts", label: "Accounts", icon: Users },
  { to: "/sessions", label: "Sessions", icon: Link2 },
  { to: "/referrals", label: "Referrals", icon: Share2 },
];

const CONFIGURE_LINKS: SidebarNavEntry[] = [
  { to: "/runtimes", label: "Runtimes", icon: Server },
  { to: "/settings", label: "Settings", icon: Settings2 },
];

const COLLAPSED_LINKS: SidebarNavEntry[] = [...WORKSPACE_LINKS, ...MANAGER_LINKS, ...CONFIGURE_LINKS];

const SIDEBAR_COLLAPSED_STORAGE_KEY = "recodee.com.sidebar.collapsed";

function readSidebarCollapsedPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
}

function writeSidebarCollapsedPreference(collapsed: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    SIDEBAR_COLLAPSED_STORAGE_KEY,
    collapsed ? "1" : "0",
  );
}

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    readSidebarCollapsedPreference(),
  );
  const [switchboardOpen, setSwitchboardOpen] = useState(false);
  const [workspaceOnboardingOpen, setWorkspaceOnboardingOpen] = useState(false);
  const dashboardQuery = useDashboard();
  const { workspacesQuery, createMutation, selectMutation } = useWorkspaces();

  const accountCountLabel = useMemo(() => {
    const count =
      dashboardQuery.data?.windows.primary.accounts.length ??
      dashboardQuery.data?.accounts.length ??
      0;
    return String(count);
  }, [dashboardQuery.data]);

  const activeRuntimeCount = useMemo(
    () =>
      (dashboardQuery.data?.accounts ?? []).filter(
        (account) =>
          Math.max(
            account.codexLiveSessionCount ?? 0,
            account.codexTrackedSessionCount ?? 0,
            account.codexSessionCount ?? 0,
          ) > 0,
      ).length,
    [dashboardQuery.data?.accounts],
  );

  const workspaces = useMemo(
    () => workspacesQuery.data?.entries ?? [],
    [workspacesQuery.data?.entries],
  );
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.isActive) ?? workspaces[0] ?? null,
    [workspaces],
  );

  const toggleCollapsed = () => {
    setCollapsed((previous) => {
      const next = !previous;
      writeSidebarCollapsedPreference(next);
      if (next) {
        setSwitchboardOpen(false);
      }
      return next;
    });
  };

  const openSwitchboardFromCollapsedLogo = () => {
    writeSidebarCollapsedPreference(false);
    setCollapsed(false);
    setSwitchboardOpen(true);
  };

  const handleSelectWorkspace = (workspaceId: string) => {
    if (selectMutation.isPending) {
      return;
    }
    selectMutation.mutate(workspaceId);
  };

  const renderNavLink = (item: SidebarNavEntry, compact = false) => {
    const Icon = item.icon;
    const showRuntimeIndicator = item.label === "Runtimes" && activeRuntimeCount > 0;

    return (
      <div key={`${item.label}-${compact ? "compact" : "full"}`} className={compact ? "" : "space-y-1"}>
        <NavLink to={item.to}>
          {({ isActive }) => (
            <span
              className={cn(
                "group flex items-center gap-3 rounded-xl border border-transparent text-sm font-medium transition-colors",
                compact ? "justify-center px-2 py-2.5" : "justify-between px-3 py-2.5",
                isActive
                  ? "border-white/[0.1] bg-white/[0.08] text-white"
                  : "text-slate-300 hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-white",
              )}
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {!compact ? <span>{item.label}</span> : null}
              </span>
              {!compact ? (
                <span className="ml-auto flex items-center gap-2">
                  {showRuntimeIndicator ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" aria-hidden="true" />
                      <span
                        className="rounded-full border border-red-400/35 bg-red-500/10 px-1.5 py-0 text-[10px] font-semibold leading-none text-red-200"
                        aria-label={`${activeRuntimeCount} active runtimes`}
                      >
                        {activeRuntimeCount}
                      </span>
                    </span>
                  ) : null}
                  {item.badge ? (
                    <Badge
                      variant="secondary"
                      className="border border-white/10 bg-white/5 px-1.5 py-0 text-[10px] text-slate-400"
                    >
                      {item.badge}
                    </Badge>
                  ) : null}
                </span>
              ) : null}
            </span>
          )}
        </NavLink>
        {!compact && item.children?.length ? (
          <div className="ml-6 space-y-1 border-l border-white/[0.08] pl-3">
            {item.children.map((child) => {
              const ChildIcon = child.icon;
              return (
                <NavLink key={child.to} to={child.to}>
                  {({ isActive }) => (
                    <span
                      className={cn(
                        "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                        isActive
                          ? "bg-white/[0.08] text-white"
                          : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <ChildIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        {child.label}
                      </span>
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <aside
      aria-label="Primary sidebar"
      className={cn(
        "hidden shrink-0 border-r border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,10,18,0.97)_0%,rgba(3,5,12,1)_100%)] text-slate-100 transition-[width] duration-200 lg:block",
        collapsed ? "w-20" : "w-72",
      )}
    >
      <div
        className={cn(
          "sticky top-0 flex h-screen flex-col pt-5 pb-20",
          collapsed ? "gap-4 px-2" : "gap-5 px-4",
        )}
      >
        {collapsed ? (
          <div className="space-y-2.5">
            <div className="flex justify-center">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={toggleCollapsed}
                className="h-11 w-11 shrink-0 rounded-2xl border border-white/[0.12] bg-gradient-to-b from-white/[0.08] to-white/[0.02] text-slate-300 shadow-[0_10px_26px_rgba(0,0,0,0.24)] hover:border-white/[0.22] hover:text-white"
                aria-label="Expand navigation menu"
                aria-pressed={collapsed}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={openSwitchboardFromCollapsedLogo}
              aria-label="Open team switchboard"
              className="mx-auto h-14 w-14 rounded-full text-slate-200 hover:bg-white/[0.06] hover:text-white"
            >
              <CodexLogo
                className="block size-10 opacity-95"
                title="recodee.com logo"
              />
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-end gap-3">
              <div className="w-full">
                <div className="flex items-center justify-end gap-2.5">
                  <CodexLogo
                    size={56}
                    className="opacity-95"
                    title="recodee.com logo"
                  />
                  <p className="text-right text-xl font-semibold tracking-tight text-white">
                    recodee.com
                  </p>
                </div>
                <p className="mt-1 text-right text-[11px] uppercase tracking-[0.14em] text-slate-500">
                  Accounts ({accountCountLabel})
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={toggleCollapsed}
                className="h-11 w-11 shrink-0 rounded-2xl border border-white/[0.12] bg-gradient-to-b from-white/[0.06] to-white/[0.02] text-slate-300 shadow-[0_10px_26px_rgba(0,0,0,0.22)] hover:border-white/[0.22] hover:text-white"
                aria-label="Collapse navigation menu"
                aria-pressed={collapsed}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>

            <details
              className="group relative min-w-0 w-full"
              open={switchboardOpen}
              onToggle={(event) => {
                setSwitchboardOpen(event.currentTarget.open);
              }}
            >
              <summary
                aria-label="Toggle switchboards panel"
                className="list-none cursor-pointer [&::-webkit-details-marker]:hidden"
              >
                <div className="relative overflow-hidden rounded-2xl border border-white/[0.12] bg-[linear-gradient(145deg,rgba(255,255,255,0.08),rgba(18,22,35,0.75))] px-3 py-3 shadow-[0_14px_34px_rgba(0,0,0,0.36)] transition-all duration-200 group-hover:border-white/[0.24] group-open:border-white/[0.22] group-open:shadow-[0_16px_38px_rgba(0,0,0,0.42)]">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/55 to-transparent"
                  />
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.14] bg-white/[0.05] text-sm font-semibold tracking-wide text-slate-200">
                      {workspaceMonogram(activeWorkspace?.name ?? "Workspace")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        aria-label="Active workspace name"
                        className="truncate text-sm font-semibold tracking-tight text-slate-100"
                      >
                        {activeWorkspace?.name ?? "Workspace"}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {activeWorkspace?.label ?? "Team"}
                      </p>
                    </div>
                    <span className="inline-flex h-5 items-center rounded-full border border-emerald-300/30 bg-emerald-300/10 px-1.5 text-[10px] font-medium text-emerald-200">
                      Live
                    </span>
                    <ChevronsUpDown
                      className="h-4 w-4 text-slate-400 transition-colors group-open:text-slate-200"
                      aria-hidden="true"
                    />
                  </div>
                </div>
              </summary>

              <div
                aria-label="Switchboards dropdown"
                className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-white/[0.12] bg-[linear-gradient(180deg,rgba(11,14,24,0.96),rgba(4,6,12,0.96))] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_14px_30px_rgba(0,0,0,0.34)]"
              >
                <p className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-[0.14em] text-slate-400">
                  Switchboards
                </p>
                <div className="space-y-2 px-2 pb-2">
                  {workspaces.map((workspace) => {
                    const isSelected = workspace.isActive;
                    return (
                      <button
                        type="button"
                        key={workspace.id}
                        onClick={() => handleSelectWorkspace(workspace.id)}
                        aria-label={`Select workspace ${workspace.name}`}
                        className={cn(
                          "relative flex w-full items-center gap-3 rounded-xl border px-2.5 py-2.5 text-left transition-all",
                          isSelected
                            ? "border-emerald-300/35 bg-[linear-gradient(135deg,rgba(67,56,202,0.12),rgba(16,185,129,0.1))] shadow-[0_8px_18px_rgba(16,185,129,0.12)]"
                            : "border-white/[0.12] bg-white/[0.03] hover:border-white/[0.24] hover:bg-white/[0.07]",
                        )}
                        disabled={selectMutation.isPending}
                      >
                        {isSelected ? (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-emerald-300/80"
                          />
                        ) : null}
                        <span
                          className={cn(
                            "inline-flex h-8 w-8 items-center justify-center rounded-lg border text-sm font-semibold",
                            isSelected
                              ? "border-emerald-200/45 bg-emerald-200/10 text-emerald-100"
                              : "border-white/[0.12] bg-white/[0.03] text-slate-300",
                          )}
                        >
                          {workspaceMonogram(workspace.name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-white">
                            {workspace.name}
                          </p>
                          <p className="truncate text-xs text-slate-400">{workspace.label}</p>
                        </div>
                        {isSelected ? (
                          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300/40 bg-emerald-300/12">
                            <Check
                              className="h-3.5 w-3.5 text-emerald-200"
                              aria-hidden="true"
                            />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                <div className="space-y-2 border-t border-white/[0.08] px-3 py-3">
                  <Button
                    type="button"
                    onClick={() => setWorkspaceOnboardingOpen(true)}
                    variant="ghost"
                    className="h-10 w-full justify-start gap-2 border border-white/[0.1] bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] px-3 text-slate-200 hover:border-white/[0.22] hover:bg-[linear-gradient(135deg,rgba(255,255,255,0.1),rgba(255,255,255,0.04))] hover:text-white"
                    aria-label="Create workspace onboarding"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Create workspace
                  </Button>
                </div>
              </div>
            </details>
          </div>
        )}

        {collapsed ? (
          <nav aria-label="Sidebar" className="space-y-1">
            {COLLAPSED_LINKS.map((item) => renderNavLink(item, true))}
          </nav>
        ) : (
          <nav aria-label="Sidebar" className="space-y-4">
            <div className="space-y-1">
              <p className="px-1 text-[11px] uppercase tracking-[0.12em] text-slate-500">Workspace</p>
              {WORKSPACE_LINKS.map((item) => renderNavLink(item))}
            </div>

            <div className="space-y-1">
              <p className="px-1 text-[11px] uppercase tracking-[0.12em] text-slate-500">Manager</p>
              {MANAGER_LINKS.map((item) => renderNavLink(item))}
            </div>

            <div className="space-y-1">
              <p className="px-1 text-[11px] uppercase tracking-[0.12em] text-slate-500">Configure</p>
              {CONFIGURE_LINKS.map((item) => renderNavLink(item))}
            </div>
          </nav>
        )}

      </div>

      <WorkspaceOnboardingDialog
        open={workspaceOnboardingOpen}
        onOpenChange={setWorkspaceOnboardingOpen}
        createWorkspace={(name, signal) => createMutation.mutateAsync({ name, signal })}
        isCreatingWorkspace={createMutation.isPending}
        accounts={dashboardQuery.data?.accounts ?? []}
      />
    </aside>
  );
}
