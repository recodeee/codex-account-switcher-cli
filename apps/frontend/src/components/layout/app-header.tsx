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
  className?: string;
};

export function AppHeader({
  onLogout,
  showLogout = true,
  sidebarAware = false,
  className,
}: AppHeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItems = flattenNavItems(NAV_ITEMS);
  const blurred = usePrivacyStore((s) => s.blurred);
  const togglePrivacy = usePrivacyStore((s) => s.toggle);
  const PrivacyIcon = blurred ? EyeOff : Eye;

  return (
    <header
      className={cn(
        "sticky top-0 z-20 border-b border-white/[0.08] bg-background/55 px-4 py-2.5 shadow-[0_1px_12px_rgba(0,0,0,0.06)] backdrop-blur-xl backdrop-saturate-[1.8] supports-[backdrop-filter]:bg-background/45 dark:shadow-[0_1px_12px_rgba(0,0,0,0.25)]",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-semibold tracking-tight">
              May your tokens last forever.
            </p>
            <p className="hidden truncate text-[11px] text-muted-foreground md:block">
              Live account switchboard. Medicine for you codex accounts.
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
