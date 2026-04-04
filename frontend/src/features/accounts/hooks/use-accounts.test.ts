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
    const nowIso = new Date().toISOString();
    const workingAccounts = [
      createAccountSummary({
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "main",
          activeSnapshotName: "main",
          isActiveSnapshot: true,
          hasLiveSession: true,
        },
        lastUsageRecordedAtPrimary: nowIso,
        lastUsageRecordedAtSecondary: nowIso,
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

  it("uses fast polling when tracked sessions are present without live telemetry", () => {
    const trackedAccounts = [
      createAccountSummary({
        codexLiveSessionCount: 0,
        codexTrackedSessionCount: 3,
        codexSessionCount: 0,
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "secondary",
          activeSnapshotName: "main",
          isActiveSnapshot: false,
          hasLiveSession: false,
        },
        lastUsageRecordedAtPrimary: null,
        lastUsageRecordedAtSecondary: null,
      }),
    ];

    expect(resolveAccountsPollInterval(trackedAccounts)).toBe(2_000);
  });

  it("uses fast polling when fresh debug raw samples are present", () => {
    const sampledAccounts = [
      createAccountSummary({
        codexLiveSessionCount: 0,
        codexTrackedSessionCount: 0,
        codexSessionCount: 0,
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "viktor",
          activeSnapshotName: "viktor",
          isActiveSnapshot: true,
          hasLiveSession: false,
        },
        lastUsageRecordedAtPrimary: null,
        lastUsageRecordedAtSecondary: null,
        liveQuotaDebug: {
          snapshotsConsidered: ["viktor"],
          overrideApplied: false,
          overrideReason: "deferred_active_snapshot_mixed_default_sessions",
          merged: null,
          rawSamples: [
            {
              source: "/tmp/rollout-a.jsonl",
              snapshotName: "viktor",
              recordedAt: new Date().toISOString(),
              stale: false,
              primary: { usedPercent: 56, remainingPercent: 44, resetAt: 1760000000, windowMinutes: 300 },
              secondary: { usedPercent: 32, remainingPercent: 68, resetAt: 1760600000, windowMinutes: 10080 },
            },
          ],
        },
      }),
    ];

    expect(resolveAccountsPollInterval(sampledAccounts)).toBe(2_000);
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
