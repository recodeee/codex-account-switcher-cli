import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CreditCard,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  Link2,
  MonitorSmartphone,
  Settings2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink } from "@/lib/router-compat";

import { CodexLogo } from "@/components/brand/codex-logo";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/accounts": Users,
  "/billing": CreditCard,
  "/apis": KeyRound,
  "/devices": MonitorSmartphone,
  "/storage": HardDrive,
  "/sessions": Link2,
  "/settings": Settings2,
};

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
  const dashboardQuery = useDashboard();

  const accountCountLabel = useMemo(() => {
    const count =
      dashboardQuery.data?.windows.primary.accounts.length ??
      dashboardQuery.data?.accounts.length ??
      0;
    return String(count);
  }, [dashboardQuery.data]);

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
          collapsed ? "gap-4 px-2" : "gap-7 px-4",
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
              className="group min-w-0 w-full"
              open={switchboardOpen}
              onToggle={(event) => {
                setSwitchboardOpen(event.currentTarget.open);
              }}
            >
              <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
                <div className="relative overflow-hidden rounded-2xl border border-white/[0.12] bg-gradient-to-br from-white/[0.08] via-white/[0.03] to-transparent px-3 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.28)] transition-all duration-200 group-hover:border-white/[0.2] group-open:from-white/[0.1] group-open:via-white/[0.05]">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent"
                  />
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold tracking-tight text-white">
                        recodee.com
                      </p>
                      <p className="truncate text-xs text-slate-400">Team</p>
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

              <div className="mt-2 overflow-hidden rounded-2xl border border-white/[0.12] bg-gradient-to-b from-black/25 to-black/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <p className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-[0.14em] text-slate-400">
                  Switchboards
                </p>
                <div className="px-2 pb-2">
                  <div className="flex items-center gap-3 rounded-xl border border-white/[0.12] bg-white/[0.04] px-2.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">
                        recodee.com
                      </p>
                      <p className="truncate text-xs text-slate-400">Team</p>
                    </div>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300/40 bg-emerald-300/12">
                      <Check
                        className="h-3.5 w-3.5 text-emerald-200"
                        aria-hidden="true"
                      />
                    </span>
                  </div>
                </div>
              </div>
            </details>
          </div>
        )}

        <nav aria-label="Sidebar" className="space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = NAV_ICONS[item.to] ?? BarChart3;
            return (
              <NavLink key={item.to} to={item.to}>
                {({ isActive }) => (
                  <span
                    className={cn(
                      "flex items-center rounded-2xl px-3.5 py-3 text-sm font-medium transition-all duration-200",
                      collapsed ? "justify-center px-2.5" : "justify-between",
                      isActive
                        ? "bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                        : "text-slate-300 hover:bg-white/[0.05] hover:text-white",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span className={collapsed ? "sr-only" : undefined}>
                        {item.label}
                      </span>
                    </span>
                    {item.isComingSoon && !collapsed ? (
                      <Badge
                        variant="secondary"
                        className="border border-white/10 bg-white/5 px-1.5 py-0 text-[10px] text-slate-400"
                      >
                        Soon
                      </Badge>
                    ) : null}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {collapsed ? (
          <div className="mt-auto flex items-center justify-center">
            <span
              className="h-2 w-2 rounded-full bg-emerald-300/90"
              aria-hidden="true"
            />
            <span className="sr-only">Monitoring your Codex sessions</span>
          </div>
        ) : (
          <div className="mt-auto rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
            <p className="text-xs text-slate-400">
              Monitoring your Codex sessions
            </p>
            <NavLink
              to="/coming-soon"
              className="mt-1 inline-flex text-xs font-medium text-slate-300 transition-colors hover:text-white"
            >
              Coming soon page
            </NavLink>
          </div>
        )}
      </div>
    </aside>
  );
}
