import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGate } from "@/features/auth/components/auth-gate";
import { useAuthStore } from "@/features/auth/hooks/use-auth";
import { AccountsPage } from "@/features/accounts/components/accounts-page";
import { ApisPage } from "@/features/apis/components/apis-page";
import { BillingPage } from "@/features/billing/components/billing-page";
import { DashboardPage } from "@/features/dashboard/components/dashboard-page";
import { DevicesPage } from "@/features/devices/components/devices-page";
import { SessionsPage } from "@/features/sessions/components/sessions-page";
import { SettingsPage } from "@/features/settings/components/settings-page";
import { StoragePage } from "@/features/storage/components/storage-page";

function AppLayout() {
  const logout = useAuthStore((state) => state.logout);
  const passwordRequired = useAuthStore((state) => state.passwordRequired);

  return (
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
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/apis" element={<ApisPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/storage" element={<StoragePage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/firewall" element={<Navigate to="/settings" replace />} />
          </Route>
        </Routes>
      </AuthGate>
    </TooltipProvider>
  );
}
