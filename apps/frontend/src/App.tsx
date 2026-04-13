import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGate } from "@/features/auth/components/auth-gate";
import { useMedusaCustomerAuthStore } from "@/features/medusa-customer-auth/hooks/use-medusa-customer-auth";
import { AccountsPage } from "@/features/accounts/components/accounts-page";
import { AgentsPage } from "@/features/agents/components/agents-page";
import { ApisPage } from "@/features/apis/components/apis-page";
import { BillingPage } from "@/features/billing/components/billing-page";
import { DashboardPage } from "@/features/dashboard/components/dashboard-page";
import { DevicesPage } from "@/features/devices/components/devices-page";
import { ProjectsPage } from "@/features/projects/components/projects-page";
import { PlansPage } from "@/features/plans/components/plans-page";
import { ReferralsPage } from "@/features/referrals/components/referrals-page";
import { RuntimesPage } from "@/features/runtimes/components/runtimes-page";
import { SessionsPage } from "@/features/sessions/components/sessions-page";
import { SkillsPage } from "@/features/skills/components/skills-page";
import { SettingsPage } from "@/features/settings/components/settings-page";
import { StoragePage } from "@/features/storage/components/storage-page";
import { cn } from "@/lib/utils";

function AppLayout() {
  const logout = useMedusaCustomerAuthStore((state) => state.logout);
  const customer = useMedusaCustomerAuthStore((state) => state.customer);
  const location = useLocation();
  const isDashboardRoute = location.pathname === "/dashboard";
  const isProjectsRoute = location.pathname === "/projects";
  const isAccountsRoute = location.pathname === "/accounts";
  const isPlansRoute = location.pathname === "/projects/plans";
  const isAgentsRoute = location.pathname === "/agents";
  const isRuntimesRoute = location.pathname === "/runtimes";
  const isSkillsRoute = location.pathname === "/skills";
  const isBillingRoute = location.pathname === "/billing";

  return (
    <div className="flex min-h-screen bg-background pb-10">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          onLogout={() => {
            void logout();
          }}
          showLogout={Boolean(customer)}
          sidebarAware
          pagePath={location.pathname}
        />
        <main
          className={cn(
            "w-full flex-1",
            isRuntimesRoute
              || isSkillsRoute
              || isAgentsRoute
              ? "max-w-none overflow-hidden p-0"
              : isDashboardRoute
                ? "px-0 py-8"
              : isProjectsRoute || isAccountsRoute || isPlansRoute || isBillingRoute
                ? "px-2 py-5 sm:px-3 lg:px-4"
                : "px-4 py-8 sm:px-6 lg:px-8",
            isPlansRoute ||
            isRuntimesRoute ||
            isSkillsRoute ||
            isAgentsRoute ||
            isBillingRoute ||
            isDashboardRoute
              ? "max-w-none"
              : isProjectsRoute || isAccountsRoute
                  ? "mx-auto max-w-[1900px]"
                  : "mx-auto max-w-[1500px]",
          )}
        >
          <Outlet />
        </main>
        <StatusBar />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <Toaster richColors />
      <AuthGate>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/referrals" element={<ReferralsPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/plans" element={<PlansPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/apis" element={<ApisPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/storage" element={<StoragePage />} />
            <Route path="/runtimes" element={<RuntimesPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/firewall" element={<Navigate to="/settings" replace />} />
          </Route>
        </Routes>
      </AuthGate>
    </TooltipProvider>
  );
}
