import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { server } from "@/test/mocks/server";
import { createAccountSummary, createDashboardOverview } from "@/test/mocks/factories";

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

describe("useDashboard", () => {
  it("loads dashboard overview via MSW and configures fast polling for working accounts", async () => {
    const nowIso = new Date().toISOString();
    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_live",
                email: "live@example.com",
                displayName: "live@example.com",
                codexSessionCount: 0,
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
            ],
          }),
        ),
      ),
    );

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useDashboard(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.isLoading || result.current.isPending).toBe(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.accounts.length).toBeGreaterThan(0);

    const query = queryClient.getQueryCache().find({ queryKey: ["dashboard", "overview"] });
    expect(query).toBeDefined();
    const refetchInterval = (query?.options as { refetchInterval?: unknown } | undefined)
      ?.refetchInterval;
    if (typeof refetchInterval === "function") {
      expect(refetchInterval(query as never)).toBe(2_000);
    } else {
      expect(refetchInterval).toBe(2_000);
    }
  });

  it("uses default polling when no account is currently working", async () => {
    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_idle",
                email: "idle@example.com",
                displayName: "idle@example.com",
                codexSessionCount: 0,
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "idle",
                  activeSnapshotName: "different",
                  isActiveSnapshot: false,
                  hasLiveSession: false,
                },
              }),
            ],
          }),
        ),
      ),
    );

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useDashboard(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queryClient.getQueryCache().find({ queryKey: ["dashboard", "overview"] });
    expect(query).toBeDefined();
    const refetchInterval = (query?.options as { refetchInterval?: unknown } | undefined)
      ?.refetchInterval;
    if (typeof refetchInterval === "function") {
      expect(refetchInterval(query as never)).toBe(30_000);
    } else {
      expect(refetchInterval).toBe(30_000);
    }
  });

  it("uses fast polling when tracked sessions exist without live telemetry", async () => {
    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_tracked_only",
                email: "tracked-only@example.com",
                displayName: "tracked-only@example.com",
                codexLiveSessionCount: 0,
                codexTrackedSessionCount: 2,
                codexSessionCount: 0,
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "tracked-only",
                  activeSnapshotName: "different",
                  isActiveSnapshot: false,
                  hasLiveSession: false,
                },
                lastUsageRecordedAtPrimary: null,
                lastUsageRecordedAtSecondary: null,
              }),
            ],
          }),
        ),
      ),
    );

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useDashboard(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queryClient.getQueryCache().find({ queryKey: ["dashboard", "overview"] });
    expect(query).toBeDefined();
    const refetchInterval = (query?.options as { refetchInterval?: unknown } | undefined)
      ?.refetchInterval;
    if (typeof refetchInterval === "function") {
      expect(refetchInterval(query as never)).toBe(2_000);
    } else {
      expect(refetchInterval).toBe(2_000);
    }
  });

  it("uses fast polling when fresh debug samples exist without live/tracked sessions", async () => {
    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_debug_samples",
                email: "debug-samples@example.com",
                displayName: "debug-samples@example.com",
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
            ],
          }),
        ),
      ),
    );

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useDashboard(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = queryClient.getQueryCache().find({ queryKey: ["dashboard", "overview"] });
    expect(query).toBeDefined();
    const refetchInterval = (query?.options as { refetchInterval?: unknown } | undefined)
      ?.refetchInterval;
    if (typeof refetchInterval === "function") {
      expect(refetchInterval(query as never)).toBe(2_000);
    } else {
      expect(refetchInterval).toBe(2_000);
    }
  });

  it("exposes error state on request failure", async () => {
    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          {
            error: {
              code: "overview_failed",
              message: "overview failed",
            },
          },
          { status: 500 },
        ),
      ),
    );

    const queryClient = createTestQueryClient();
    const { result } = renderHook(() => useDashboard(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
