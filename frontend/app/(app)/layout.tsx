"use client";

import type { ReactNode } from "react";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { AuthGate } from "@/features/auth/components/auth-gate";
import { useAuthStore } from "@/features/auth/hooks/use-auth";

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const logout = useAuthStore((state) => state.logout);
  const passwordRequired = useAuthStore((state) => state.passwordRequired);

  return (
    <AuthGate>
      <div className="flex min-h-screen bg-background pb-10">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            onLogout={() => {
              void logout();
            }}
            showLogout={passwordRequired}
            sidebarAware
          />
          <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
            {children}
          </main>
          <StatusBar />
        </div>
      </div>
    </AuthGate>
  );
}
