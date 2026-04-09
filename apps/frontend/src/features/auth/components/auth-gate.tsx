import { useEffect } from "react";
import type { PropsWithChildren } from "react";

import { SpinnerBlock } from "@/components/ui/spinner";
import { MedusaCustomerAuthPage } from "@/features/medusa-customer-auth/components/medusa-customer-auth-page";
import { useMedusaCustomerAuthStore } from "@/features/medusa-customer-auth/hooks/use-medusa-customer-auth";

function resolveInitialMode(): "login" | "register" {
  if (typeof window === "undefined") {
    return "login";
  }

  return window.location.pathname.toLowerCase().includes("register")
    ? "register"
    : "login";
}

export function AuthGate({ children }: PropsWithChildren) {
  const initialize = useMedusaCustomerAuthStore((state) => state.initialize);
  const initialized = useMedusaCustomerAuthStore((state) => state.initialized);
  const loading = useMedusaCustomerAuthStore((state) => state.loading);
  const customer = useMedusaCustomerAuthStore((state) => state.customer);

  useEffect(() => {
    void initialize().catch(() => {
      // Initial auth refresh errors are already reflected in auth store state.
      // Swallow here to avoid unhandled promise rejections in React effects.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020308]">
        <SpinnerBlock />
      </div>
    );
  }

  if (!customer) {
    return <MedusaCustomerAuthPage initialMode={resolveInitialMode()} />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020308]">
        <SpinnerBlock />
      </div>
    );
  }

  return <>{children}</>;
}
