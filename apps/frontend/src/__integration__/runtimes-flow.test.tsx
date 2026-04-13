import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import App from "@/App";
import { createAccountSummary, createDashboardOverview } from "@/test/mocks/factories";
import { server } from "@/test/mocks/server";
import { renderWithProviders } from "@/test/utils";

describe("runtimes flow integration", () => {
  it("renders live codex-auth sessions in the runtimes list automatically", async () => {
    const nowIso = new Date().toISOString();

    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_runtime",
                email: "runtime-live@example.com",
                displayName: "runtime-live@example.com",
                codexLiveSessionCount: 1,
                codexTrackedSessionCount: 1,
                codexSessionCount: 1,
                codexCurrentTaskPreview: "Ship runtimes view from multica design",
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "runtime-live",
                  activeSnapshotName: "runtime-live",
                  isActiveSnapshot: true,
                  hasLiveSession: true,
                },
                requestUsage: {
                  requestCount: 42,
                  totalTokens: 12400,
                  cachedInputTokens: 2100,
                  totalCostUsd: 0.42,
                },
              }),
              createAccountSummary({
                accountId: "acc_openclaw",
                email: "openclaw-live@example.com",
                displayName: "openclaw-live@example.com",
                codexLiveSessionCount: 1,
                codexTrackedSessionCount: 1,
                codexSessionCount: 1,
                codexCurrentTaskPreview: "Monitor openclaw runtime health",
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "openclaw-recodee",
                  activeSnapshotName: "openclaw-recodee",
                  isActiveSnapshot: true,
                  hasLiveSession: true,
                },
                requestUsage: {
                  requestCount: 18,
                  totalTokens: 8200,
                  cachedInputTokens: 1000,
                  totalCostUsd: 0.13,
                },
              }),
            ],
          }),
        ),
      ),
      http.get("/api/sticky-sessions", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("kind") !== "codex_session") {
          return HttpResponse.json({ entries: [], stalePromptCacheCount: 0, total: 0, hasMore: false });
        }
        return HttpResponse.json({
          entries: [
            {
              key: "session-runtime-1",
              accountId: "acc_runtime",
              displayName: "runtime-live@example.com",
              kind: "codex_session",
              createdAt: nowIso,
              updatedAt: nowIso,
              taskPreview: "Ship runtimes view from multica design",
              taskUpdatedAt: nowIso,
              isActive: true,
              expiresAt: null,
              isStale: false,
            },
            {
              key: "session-openclaw-1",
              accountId: "acc_openclaw",
              displayName: "openclaw-live@example.com",
              kind: "codex_session",
              createdAt: nowIso,
              updatedAt: nowIso,
              taskPreview: "Monitor openclaw runtime health",
              taskUpdatedAt: nowIso,
              isActive: true,
              expiresAt: null,
              isStale: false,
            },
          ],
          unmappedCliSessions: [],
          stalePromptCacheCount: 0,
          total: 2,
          hasMore: false,
        });
      }),
      http.get("/api/accounts/:accountId/trends", ({ params }) =>
        HttpResponse.json({
          accountId: String(params.accountId),
          primary: [
            { t: nowIso, v: 1 },
          ],
          secondary: [
            { t: nowIso, v: 2 },
          ],
        }),
      ),
      http.get("/api/request-logs", () =>
        HttpResponse.json({
          requests: [
            {
              requestedAt: nowIso,
              accountId: "acc_runtime",
              apiKeyName: "runtime-key",
              requestId: "req-runtime-1",
              model: "gpt-5.4-mini",
              transport: "responses",
              serviceTier: null,
              requestedServiceTier: null,
              actualServiceTier: null,
              status: "ok",
              errorCode: null,
              errorMessage: null,
              tokens: 1200,
              cachedInputTokens: 200,
              reasoningEffort: "high",
              costUsd: 0.02,
              latencyMs: 120,
            },
          ],
          total: 1,
          hasMore: false,
        }),
      ),
      http.post("http://localhost:9000/store/customers/me", () => HttpResponse.json({ customer: {} })),
    );

    window.history.pushState({}, "", "/runtimes");
    renderWithProviders(<App />);

    expect((await screen.findAllByText("Codex (runtime-live)")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Openclaw (openclaw-recodee)")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("runtime-live@example.com")).length).toBeGreaterThan(0);
    expect(screen.getByText("Live sessions")).toBeInTheDocument();
    expect(screen.getByText("Ship runtimes view from multica design")).toBeInTheDocument();
  });
});
