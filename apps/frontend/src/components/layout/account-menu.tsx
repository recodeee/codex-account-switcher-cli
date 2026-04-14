"use client";

import {
  Eye,
  EyeOff,
  LogOut,
  Moon,
  Sun,
  UserRound,
} from "lucide-react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

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
import { useMedusaCustomerAuthStore } from "@/features/medusa-customer-auth/hooks/use-medusa-customer-auth";
import { useMedusaAdminAuthStore } from "@/features/medusa-auth/hooks/use-medusa-admin-auth";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { useThemeStore } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { hasActiveCliSessionSignal } from "@/utils/account-working";

function accountMenuPriorityScore(account: AccountSummary): number {
  let score = 0;
  if (account.codexAuth?.isActiveSnapshot ?? false) score += 10_000;
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
  const blurred = usePrivacyStore((state) => state.blurred);
  const togglePrivacy = usePrivacyStore((state) => state.toggle);
  const medusaCustomer = useMedusaCustomerAuthStore((state) => state.customer);
  const medusaUser = useMedusaAdminAuthStore((state) => state.user);
  const medusaLastAuthenticatedEmail = useMedusaAdminAuthStore(
    (state) => state.lastAuthenticatedEmail,
  );

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
  const medusaCustomerEmail = medusaCustomer?.email ?? null;
  const medusaAdminEmail = medusaUser?.email ?? null;
  const dashboardLoginEmail = medusaCustomerEmail ?? medusaAdminEmail ?? null;
  const displayedLoginEmail = dashboardLoginEmail;
  const normalizedLoggedInEmail = loggedInEmail?.trim().toLowerCase() ?? null;
  const normalizedDisplayedLoginEmail =
    displayedLoginEmail?.trim().toLowerCase() ?? null;
  const triggerEmail = displayedLoginEmail;
  const showTriggerCodexEmail =
    Boolean(loggedInEmail) &&
    normalizedLoggedInEmail !== normalizedDisplayedLoginEmail;
  const showCodexAccountDetails =
    Boolean(loggedInEmail) &&
    normalizedLoggedInEmail !== normalizedDisplayedLoginEmail;
  const showLastMedusaAdminLogin =
    Boolean(medusaAdminEmail) &&
    Boolean(medusaLastAuthenticatedEmail) &&
    medusaLastAuthenticatedEmail !== medusaAdminEmail;
  const triggerLetter = (triggerEmail?.trim()?.[0] ?? "C").toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn("h-10 gap-1.5 rounded-lg px-2 text-xs", className)}
          aria-label="Open account menu"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-md border border-border/70 bg-muted/40 font-medium">
            {triggerLetter}
          </span>
          <span className="hidden min-w-0 sm:flex sm:max-w-[16rem] sm:flex-col sm:items-start sm:leading-tight">
            <span
              className="max-w-[16rem] truncate text-xs text-muted-foreground"
              title={triggerEmail ?? "No dashboard login recorded yet"}
            >
              {triggerEmail ?? "No dashboard login recorded yet"}
            </span>
            {showTriggerCodexEmail ? (
              <span
                className="max-w-[16rem] truncate text-[10px] text-muted-foreground/80"
                title={loggedInEmail ?? undefined}
              >
                Active Codex account: {loggedInEmail}
              </span>
            ) : null}
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
            title={displayedLoginEmail ?? "No dashboard login recorded yet"}
          >
            {displayedLoginEmail ?? "No dashboard login recorded yet"}
          </p>

          {showCodexAccountDetails && loggedInEmail ? (
            <>
              <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Active Codex account
              </p>
              <p
                className={cn(
                  "truncate text-xs text-foreground/90",
                  blurred ? "privacy-blur" : "",
                )}
                title={loggedInEmail ?? undefined}
              >
                {loggedInEmail}
              </p>
            </>
          ) : null}

          {medusaAdminEmail ? (
            <>
              <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Medusa admin
              </p>
              <p
                className={cn(
                  "truncate text-xs text-foreground/90",
                  blurred ? "privacy-blur" : "",
                )}
                title={medusaAdminEmail}
              >
                {medusaAdminEmail}
              </p>
            </>
          ) : null}

          {showLastMedusaAdminLogin && medusaLastAuthenticatedEmail ? (
            <>
              <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Last Medusa admin login
              </p>
              <p
                className={cn(
                  "truncate text-xs text-foreground/90",
                  blurred ? "privacy-blur" : "",
                )}
                title={medusaLastAuthenticatedEmail}
              >
                {medusaLastAuthenticatedEmail}
              </p>
            </>
          ) : null}
        </div>
      </DropdownMenuContent>

    </DropdownMenu>
  );
}
