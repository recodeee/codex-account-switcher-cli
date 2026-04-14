"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { AuthGate } from "@/features/auth/components/auth-gate";
import { useMedusaCustomerAuthStore } from "@/features/medusa-customer-auth/hooks/use-medusa-customer-auth";
import { cn } from "@/lib/utils";

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const logout = useMedusaCustomerAuthStore((state) => state.logout);
  const customer = useMedusaCustomerAuthStore((state) => state.customer);
  const pathname = usePathname();
  const isPlansRoute = pathname === "/projects/plans";
  const isProjectsRoute = pathname === "/projects";
  const isAccountsRoute = pathname === "/accounts";
  const isAgentsRoute = pathname === "/agents";
  const isRuntimesRoute = pathname === "/runtimes";
  const isSkillsRoute = pathname === "/skills";
  const isSettingsRoute = pathname === "/settings";
  const isFullBleedRoute = isPlansRoute || isRuntimesRoute || isSkillsRoute || isAgentsRoute || isSettingsRoute;

  return (
    <AuthGate>
      <div className="flex min-h-screen bg-background pb-10">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            onLogout={() => {
              void logout();
            }}
            showLogout={Boolean(customer)}
            sidebarAware
            pagePath={pathname}
          />
          <main
            className={cn(
              "w-full flex-1",
              isRuntimesRoute
                || isSkillsRoute
                || isAgentsRoute
                ? "max-w-none overflow-hidden p-0"
                : isSettingsRoute
                  ? "max-w-none px-0 py-5"
                : isProjectsRoute || isAccountsRoute || isPlansRoute
                  ? "px-2 py-5 sm:px-3 lg:px-4"
                  : "px-4 py-8 sm:px-6 lg:px-8",
              !isFullBleedRoute
                ? isProjectsRoute || isAccountsRoute
                  ? "mx-auto max-w-[1900px]"
                  : "mx-auto max-w-[1500px]"
                : null,
            )}
          >
            {children}
          </main>
          <StatusBar />
        </div>
      </div>
    </AuthGate>
  );
}
