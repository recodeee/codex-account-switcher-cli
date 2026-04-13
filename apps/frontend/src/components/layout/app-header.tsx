import { Eye, EyeOff, LogOut, Menu } from "lucide-react";
import { useState } from "react";
import { NavLink } from "@/lib/router-compat";

import { CodexLogo } from "@/components/brand/codex-logo";
import { AccountMenu } from "@/components/layout/account-menu";
import { flattenNavItems, NAV_ITEMS } from "@/components/layout/nav-items";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { cn } from "@/lib/utils";

export type AppHeaderProps = {
  onLogout: () => void;
  showLogout?: boolean;
  sidebarAware?: boolean;
  pagePath?: string;
  className?: string;
};

type HeaderCopy = {
  title: string;
  description: string;
};

const DEFAULT_HEADER_COPY: HeaderCopy = {
  title: "May your tokens last forever.",
  description: "Live account switchboard. Medicine for your codex accounts.",
};

const HEADER_COPY_BY_PREFIX: Array<{ prefix: string; copy: HeaderCopy }> = [
  {
    prefix: "/runtimes",
    copy: {
      title: "Manage Codex agent runtimes.",
      description: "View active codex-auth sessions, inspect status, and test runtime connectivity.",
    },
  },
  {
    prefix: "/dashboard",
    copy: {
      title: "Watch account health in one place.",
      description: "Track live usage, routing, and current account capacity.",
    },
  },
  {
    prefix: "/accounts",
    copy: {
      title: "Manage your Codex account stack.",
      description: "Switch snapshots, review account health, and keep access aligned.",
    },
  },
  {
    prefix: "/sessions",
    copy: {
      title: "Track active coding sessions.",
      description: "Review live sessions, task progress, and runtime attribution.",
    },
  },
  {
    prefix: "/devices",
    copy: {
      title: "Monitor connected devices.",
      description: "Inspect activity, connectivity, and per-device runtime health.",
    },
  },
  {
    prefix: "/apis",
    copy: {
      title: "Control API keys and access.",
      description: "Create, rotate, and audit keys across your environment.",
    },
  },
  {
    prefix: "/billing",
    copy: {
      title: "Understand token spend and limits.",
      description: "Review billing activity, usage trends, and quota posture.",
    },
  },
  {
    prefix: "/projects/plans",
    copy: {
      title: "Plan project execution clearly.",
      description: "Coordinate project plans, milestones, and rollout readiness.",
    },
  },
  {
    prefix: "/projects",
    copy: {
      title: "Manage projects and delivery flow.",
      description: "Organize project workspaces, progress, and lifecycle status.",
    },
  },
  {
    prefix: "/agents",
    copy: {
      title: "Configure workspace agents.",
      description: "Manage agent instructions, skills, tasks, and runtime defaults.",
    },
  },
  {
    prefix: "/referrals",
    copy: {
      title: "Track referral performance.",
      description: "Review referral activity and growth impact in one view.",
    },
  },
  {
    prefix: "/storage",
    copy: {
      title: "Review storage usage.",
      description: "Check allocation, retention, and storage health signals.",
    },
  },
  {
    prefix: "/settings",
    copy: {
      title: "Tune workspace behavior.",
      description: "Configure routing, defaults, and account-level preferences.",
    },
  },
  {
    prefix: "/skills",
    copy: {
      title: "Manage reusable skills.",
      description: "Create, organize, and edit skill files for your runtime workflows.",
    },
  },
];

function resolveHeaderCopy(pagePath: string | undefined): HeaderCopy {
  if (!pagePath) {
    return DEFAULT_HEADER_COPY;
  }

  const normalizedPath = pagePath.toLowerCase();
  for (const entry of HEADER_COPY_BY_PREFIX) {
    if (normalizedPath === entry.prefix || normalizedPath.startsWith(`${entry.prefix}/`)) {
      return entry.copy;
    }
  }

  return DEFAULT_HEADER_COPY;
}

export function AppHeader({
  onLogout,
  showLogout = true,
  sidebarAware = false,
  pagePath,
  className,
}: AppHeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItems = flattenNavItems(NAV_ITEMS);
  const blurred = usePrivacyStore((s) => s.blurred);
  const togglePrivacy = usePrivacyStore((s) => s.toggle);
  const PrivacyIcon = blurred ? EyeOff : Eye;
  const headerCopy = resolveHeaderCopy(pagePath);

  return (
    <header
      className={cn(
        "sticky top-0 z-20 border-b border-white/[0.08] bg-background/55 px-2 py-2.5 shadow-[0_1px_12px_rgba(0,0,0,0.06)] backdrop-blur-xl backdrop-saturate-[1.8] supports-[backdrop-filter]:bg-background/45 dark:shadow-[0_1px_12px_rgba(0,0,0,0.25)] sm:px-3",
        className,
      )}
    >
      <div className="flex w-full items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-semibold tracking-tight">
              {headerCopy.title}
            </p>
            <p className="hidden truncate text-[11px] text-muted-foreground md:block">
              {headerCopy.description}
            </p>
          </div>
        </div>

        {/* Desktop nav pills */}
        {!sidebarAware ? (
          <nav className="hidden items-center rounded-lg border border-border/50 bg-muted/40 p-0.5 sm:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "relative inline-flex h-7 items-center rounded-md px-3.5 text-xs leading-none font-medium transition-colors duration-200",
                    isActive
                      ? "bg-background text-foreground shadow-[var(--shadow-xs)]"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                <span className={item.depth > 0 ? "pl-2" : undefined}>{item.label}</span>
                {item.isComingSoon ? (
                  <Badge
                    variant="secondary"
                    className="ml-1 border border-border/60 bg-muted px-1.5 py-0 text-[10px] text-muted-foreground"
                  >
                    Coming soon
                  </Badge>
                ) : null}
              </NavLink>
            ))}
          </nav>
        ) : null}

        {/* Actions */}
        <div className="flex flex-1 items-center justify-end gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={togglePrivacy}
            aria-label={
              blurred ? "Show sensitive values" : "Hide sensitive values"
            }
            className="press-scale hidden h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground sm:inline-flex"
          >
            <PrivacyIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <AccountMenu
            onLogout={onLogout}
            showLogout={showLogout}
            className="press-scale hidden sm:inline-flex"
          />

          {/* Mobile menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Open menu"
                className={cn(
                  "h-8 w-8 rounded-lg",
                  sidebarAware ? "lg:hidden" : "sm:hidden",
                )}
              >
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <div className="flex h-8 w-10 items-center justify-center">
                    <CodexLogo size={18} className="text-primary" />
                  </div>
                  <span className="text-sm font-semibold">recodee.com</span>
                </SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-0.5 px-4 pt-2">
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                  >
                    {({ isActive }) => (
                      <span
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <span className={item.depth > 0 ? "pl-4" : undefined}>{item.label}</span>
                        {item.isComingSoon ? (
                          <Badge
                            variant="secondary"
                            className="border border-border/60 bg-muted px-1.5 py-0 text-[10px] text-muted-foreground"
                          >
                            Coming soon
                          </Badge>
                        ) : null}
                      </span>
                    )}
                  </NavLink>
                ))}
                <div className="my-2 h-px bg-border" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={togglePrivacy}
                >
                  <PrivacyIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  {blurred ? "Show Sensitive Values" : "Hide Sensitive Values"}
                </button>
                {showLogout && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      setMobileOpen(false);
                      onLogout();
                    }}
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    Logout
                  </button>
                )}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
