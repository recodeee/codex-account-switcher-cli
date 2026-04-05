import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  Link2,
  MonitorSmartphone,
  Settings2,
  Users,
} from "lucide-react";
import { NavLink } from "@/lib/router-compat";

import { CodexLogo } from "@/components/brand/codex-logo";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/accounts": Users,
  "/apis": KeyRound,
  "/devices": MonitorSmartphone,
  "/storage": HardDrive,
  "/sessions": Link2,
  "/settings": Settings2,
};

export function AppSidebar() {
  return (
    <aside className="hidden w-72 shrink-0 border-r border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,10,18,0.97)_0%,rgba(3,5,12,1)_100%)] text-slate-100 lg:block">
      <div className="sticky top-0 flex h-screen flex-col gap-7 px-4 py-5">
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/45 via-primary/30 to-primary/5 text-white">
            <CodexLogo size={18} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-white">
              Codexina
            </p>
            <p className="truncate text-xs text-slate-400">Account switchboard</p>
          </div>
        </div>

        <nav aria-label="Sidebar" className="space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = NAV_ICONS[item.to] ?? BarChart3;
            return (
              <NavLink key={item.to} to={item.to}>
                {({ isActive }) => (
                  <span
                    className={cn(
                      "flex items-center justify-between rounded-2xl px-3.5 py-3 text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                        : "text-slate-300 hover:bg-white/[0.05] hover:text-white",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>{item.label}</span>
                    </span>
                    {item.isComingSoon ? (
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

        <div className="mt-auto rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
          <p className="text-xs text-slate-400">Monitoring your Codex sessions</p>
        </div>
      </div>
    </aside>
  );
}
