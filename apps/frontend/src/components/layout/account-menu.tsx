"use client";

import type { LucideIcon } from "lucide-react";
import {
  Eye,
  EyeOff,
  CreditCard,
  Home,
  KeyRound,
  LayoutDashboard,
  Link2,
  LogOut,
  MonitorSmartphone,
  Moon,
  Settings2,
  Sun,
  UserRound,
  Users,
} from "lucide-react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { NAV_ITEMS } from "@/components/layout/nav-items";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AccountSummary } from "@/features/accounts/schemas";
import { getDashboardOverview } from "@/features/dashboard/api";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { useThemeStore } from "@/hooks/use-theme";
import { useNavigate } from "@/lib/router-compat";
import { cn } from "@/lib/utils";
import { hasActiveCliSessionSignal } from "@/utils/account-working";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/accounts": Users,
  "/billing": CreditCard,
  "/apis": KeyRound,
  "/devices": MonitorSmartphone,
  "/storage": Home,
  "/sessions": Link2,
  "/settings": Settings2,
};

function accountMenuPriorityScore(account: AccountSummary): number {
  let score = 0;
  if (hasActiveCliSessionSignal(account)) score += 1_000;
  if (account.codexAuth?.isActiveSnapshot ?? false) score += 400;
  if (account.status === "active") score += 100;
  score += Math.max(account.codexLiveSessionCount ?? 0, 0) * 10;
  score += Math.max(account.codexTrackedSessionCount ?? 0, 0) * 5;
  score += Math.max(account.codexSessionCount ?? 0, 0);
  return score;
}

export function resolveMenuAccountEmail(accounts: AccountSummary[]): string | null {
  if (accounts.length === 0) {
    return null;
  }

  const ranked = [...accounts].sort((left, right) => {
    const scoreDiff =
      accountMenuPriorityScore(right) - accountMenuPriorityScore(left);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return left.email.localeCompare(right.email);
  });

  return ranked[0]?.email ?? null;
}

type AccountMenuProps = {
  onLogout: () => void;
  showLogout?: boolean;
  className?: string;
};

export function AccountMenu({
  onLogout,
  showLogout = true,
  className,
}: AccountMenuProps) {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const navigate = useNavigate();
  const blurred = usePrivacyStore((state) => state.blurred);
  const togglePrivacy = usePrivacyStore((state) => state.toggle);

  const overviewQuery = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: getDashboardOverview,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const loggedInEmail = useMemo(
    () => resolveMenuAccountEmail(overviewQuery.data?.accounts ?? []),
    [overviewQuery.data?.accounts],
  );
  const triggerLetter = (loggedInEmail?.trim()?.[0] ?? "C").toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn("h-8 gap-1.5 rounded-lg px-2 text-xs", className)}
          aria-label="Open account menu"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-md border border-border/70 bg-muted/40 font-medium">
            {triggerLetter}
          </span>
          <span className="hidden max-w-[9rem] truncate text-muted-foreground lg:inline">
            {loggedInEmail ?? "Profile"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2">
          <UserRound className="h-4 w-4" aria-hidden="true" />
          My profile
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => {
            setTheme(theme === "dark" ? "light" : "dark");
          }}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4" aria-hidden="true" />
          )}
          Toggle theme
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={togglePrivacy}>
          {blurred ? (
            <Eye className="h-4 w-4" aria-hidden="true" />
          ) : (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          )}
          {blurred ? "Show sensitive values" : "Hide sensitive values"}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {NAV_ITEMS.map((item) => {
          const Icon = NAV_ICONS[item.to] ?? Home;
          return (
            <DropdownMenuItem
              key={item.to}
              className="flex w-full items-center gap-2"
              onSelect={() => {
                navigate(item.to);
              }}
            >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
                {item.isComingSoon ? (
                  <Badge
                    variant="secondary"
                    className="ml-auto border border-border/60 bg-muted px-1.5 py-0 text-[10px] text-muted-foreground"
                  >
                    Soon
                  </Badge>
                ) : null}
            </DropdownMenuItem>
          );
        })}

        {showLogout ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                onLogout();
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Log out
            </DropdownMenuItem>
          </>
        ) : null}

        <DropdownMenuSeparator />
        <div className="px-2 py-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Logged in account
          </p>
          <p
            className={cn(
              "truncate text-xs text-foreground/90",
              blurred ? "privacy-blur" : "",
            )}
            title={loggedInEmail ?? "No Codex account detected yet"}
          >
            {loggedInEmail ?? "No Codex account detected yet"}
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
