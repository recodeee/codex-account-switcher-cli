import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  resolveAccountsPollInterval,
  useAccounts,
} from "@/features/accounts/hooks/use-accounts";
import { createAccountSummary } from "@/test/mocks/factories";

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useAccounts", () => {
  it("uses fast polling while any account is working now", () => {
    const workingAccounts = [
      createAccountSummary({
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "main",
          activeSnapshotName: "main",
          isActiveSnapshot: true,
          hasLiveSession: true,
        },
        codexSessionCount: 0,
      }),
    ];

    expect(resolveAccountsPollInterval(workingAccounts)).toBe(2_000);
  });

  it("uses default polling when no account is working now", () => {
    const idleAccounts = [
      createAccountSummary({
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "secondary",
          activeSnapshotName: "main",
          isActiveSnapshot: false,
          hasLiveSession: false,
        },
        codexSessionCount: 0,
      }),
    ];

    expect(resolveAccountsPollInterval(idleAccounts)).toBe(30_000);
    expect(resolveAccountsPollInterval(undefined)).toBe(30_000);
  });

  it("loads accounts and invalidates related queries after mutations", async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useAccounts(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.accountsQuery.isSuccess).toBe(true));
    const firstAccountId = result.current.accountsQuery.data?.[0]?.accountId;
    expect(firstAccountId).toBeTruthy();

    await result.current.pauseMutation.mutateAsync(firstAccountId as string);
    await result.current.resumeMutation.mutateAsync(firstAccountId as string);

    const imported = await result.current.importMutation.mutateAsync(
      new File(["{}"], "auth.json", { type: "application/json" }),
    );
    await result.current.deleteMutation.mutateAsync(imported.accountId);

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["accounts", "list"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard", "overview"] });
    });
  });
});
