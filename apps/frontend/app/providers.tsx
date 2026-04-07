"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { useThemeStore } from "@/hooks/use-theme";
import { createQueryClient } from "@/lib/query-client";

function ThemeBootstrap() {
  useEffect(() => {
    useThemeStore.getState().initializeTheme();
    usePrivacyStore.getState().initialize();
  }, []);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeBootstrap />
      <TooltipProvider>
        <Toaster richColors />
        {children}
      </TooltipProvider>
    </QueryClientProvider>
  );
}
