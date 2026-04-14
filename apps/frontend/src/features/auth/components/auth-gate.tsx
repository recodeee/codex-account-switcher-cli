import { useEffect, useState } from "react";
import type { PropsWithChildren } from "react";

import { Spinner } from "@/components/ui/spinner";
import { MedusaCustomerAuthPage } from "@/features/medusa-customer-auth/components/medusa-customer-auth-page";
import { useMedusaCustomerAuthStore } from "@/features/medusa-customer-auth/hooks/use-medusa-customer-auth";
import { isNavigationLoaderSuppressed } from "@/lib/navigation-loader";

function resolveInitialMode(): "login" | "register" {
  if (typeof window === "undefined") {
    return "login";
  }

  return window.location.pathname.toLowerCase().includes("register")
    ? "register"
    : "login";
}

function isSameOriginReferrerNavigation(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const referrer = window.document.referrer;
  if (!referrer) {
    return false;
  }

  try {
    return new URL(referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function AuthGate({ children }: PropsWithChildren) {
  const initialize = useMedusaCustomerAuthStore((state) => state.initialize);
  const initialized = useMedusaCustomerAuthStore((state) => state.initialized);
  const customer = useMedusaCustomerAuthStore((state) => state.customer);
  const [hideLoaderForNavigation, setHideLoaderForNavigation] = useState(false);

  useEffect(() => {
    if (isNavigationLoaderSuppressed() || isSameOriginReferrerNavigation()) {
      setHideLoaderForNavigation(true);
    }
  }, []);

  useEffect(() => {
    void initialize().catch(() => {
      // Initial auth refresh errors are already reflected in auth store state.
      // Swallow here to avoid unhandled promise rejections in React effects.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!initialized && hideLoaderForNavigation) {
    return <>{children}</>;
  }

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020308]">
        <div role="status" className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!customer) {
    return <MedusaCustomerAuthPage initialMode={resolveInitialMode()} />;
  }

  // Keep the authenticated shell visible while auth refresh/login state is busy.
  // Individual pages can render their own skeletons without hiding sidebar/header.
  return <>{children}</>;
}
