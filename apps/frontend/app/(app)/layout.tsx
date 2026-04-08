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
          />
          <main
            className={cn(
              "w-full flex-1 px-4 py-8 sm:px-6 lg:px-8",
              isPlansRoute ? "max-w-none" : "mx-auto max-w-[1500px]",
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
