import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import App from "@/App";
import { createAccountSummary, createDashboardOverview } from "@/test/mocks/factories";
import { server } from "@/test/mocks/server";
import { renderWithProviders } from "@/test/utils";

describe("sessions flow integration", () => {
  it("loads sessions page and renders codex sessions grouped by account", async () => {
    let requestUrl = "";
    server.use(
      http.get("/api/sticky-sessions", ({ request }) => {
        requestUrl = request.url;
        const url = new URL(request.url);
        if (url.searchParams.get("kind") !== "codex_session") {
          return HttpResponse.json({ entries: [], stalePromptCacheCount: 0, total: 0, hasMore: false });
        }
        return HttpResponse.json({
          entries: [
            {
              key: "session-beta",
              accountId: "acc_beta",
              displayName: "beta@example.com",
              kind: "codex_session",
              createdAt: "2026-03-10T13:00:00Z",
              updatedAt: "2026-03-10T13:02:00Z",
              taskPreview: "Review beta account quota depletion warnings",
              taskUpdatedAt: "2026-03-10T13:02:00Z",
              isActive: true,
              expiresAt: null,
              isStale: false,
            },
            {
              key: "session-alpha",
              accountId: "acc_alpha",
              displayName: "alpha@example.com",
              kind: "codex_session",
              createdAt: "2026-03-10T12:00:00Z",
              updatedAt: "2026-03-10T12:05:00Z",
              taskPreview: "Investigate alpha session stream retry bug",
              taskUpdatedAt: "2026-03-10T12:05:00Z",
              isActive: true,
              expiresAt: null,
              isStale: false,
            },
          ],
          stalePromptCacheCount: 0,
          total: 2,
          hasMore: false,
        });
      }),
    );

    window.history.pushState({}, "", "/sessions");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(await screen.findByText("alpha@example.com")).toBeInTheDocument();
    expect(await screen.findByText("beta@example.com")).toBeInTheDocument();
    expect(screen.getByText("session-alpha")).toBeInTheDocument();
    expect(screen.getByText("session-beta")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Session / source" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Progress" })).toBeInTheDocument();
    expect(screen.getAllByText("Sticky mapping").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Live").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Up to date").length).toBeGreaterThan(0);
    expect(screen.getByText("Investigate alpha session stream retry bug")).toBeInTheDocument();
    expect(screen.getByText("Review beta account quota depletion warnings")).toBeInTheDocument();
    const alphaAccount = screen.getByText("alpha@example.com");
    const betaAccount = screen.getByText("beta@example.com");
    expect(alphaAccount.compareDocumentPosition(betaAccount) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(requestUrl).toContain("activeOnly=false");
  });

  it("does not render prompt button in session rows", async () => {
    server.use(
      http.get("/api/sticky-sessions", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("kind") !== "codex_session") {
          return HttpResponse.json({ entries: [], stalePromptCacheCount: 0, total: 0, hasMore: false });
        }
        return HttpResponse.json({
          entries: [
            {
              key: "session-alpha",
              accountId: "acc_alpha",
              displayName: "alpha@example.com",
              kind: "codex_session",
              createdAt: "2026-03-10T12:00:00Z",
              updatedAt: "2026-03-10T12:05:00Z",
              taskPreview: "Investigate alpha session stream retry bug",
              taskUpdatedAt: "2026-03-10T12:05:00Z",
              isActive: true,
              expiresAt: null,
              isStale: false,
            },
          ],
          stalePromptCacheCount: 0,
          total: 1,
          hasMore: false,
        });
      }),
    );

    window.history.pushState({}, "", "/sessions");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Action" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prompt" })).not.toBeInTheDocument();
  });

  it("highlights and announces a focused session when sessionKey query is present", async () => {
    server.use(
      http.get("/api/sticky-sessions", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("kind") !== "codex_session") {
          return HttpResponse.json({ entries: [], stalePromptCacheCount: 0, total: 0, hasMore: false });
        }
        return HttpResponse.json({
          entries: [
            {
              key: "session-focus-me",
              accountId: "acc_alpha",
              displayName: "alpha@example.com",
              kind: "codex_session",
              createdAt: "2026-03-10T12:00:00Z",
              updatedAt: "2026-03-10T12:05:00Z",
              taskPreview: "Investigate alpha session stream retry bug",
              taskUpdatedAt: "2026-03-10T12:05:00Z",
              isActive: true,
              expiresAt: null,
              isStale: false,
            },
          ],
          stalePromptCacheCount: 0,
          total: 1,
          hasMore: false,
        });
      }),
    );

    window.history.pushState({}, "", "/sessions?accountId=acc_alpha&sessionKey=session-focus-me");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(await screen.findByText(/Focused session:/i)).toBeInTheDocument();
    expect(screen.getAllByText("session-focus-me").length).toBeGreaterThan(0);
  });

  it("renders a session-only watch logs view with 5h and weekly status", async () => {
    const nowIso = new Date().toISOString();
    const resetPrimary = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const resetSecondary = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();

    server.use(
      http.get("/api/sticky-sessions", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("kind") !== "codex_session") {
          return HttpResponse.json({ entries: [], stalePromptCacheCount: 0, total: 0, hasMore: false });
        }
        return HttpResponse.json({
          entries: [
            {
              key: "session-watch-logs",
              accountId: "acc_watch",
              displayName: "watch@example.com",
              kind: "codex_session",
              createdAt: nowIso,
              updatedAt: nowIso,
              taskPreview: "Collect per-session watch logs",
              taskUpdatedAt: nowIso,
              isActive: true,
              expiresAt: null,
              isStale: false,
            },
          ],
          stalePromptCacheCount: 0,
          total: 1,
          hasMore: false,
        });
      }),
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_watch",
                email: "watch@example.com",
                displayName: "watch@example.com",
                usage: {
                  primaryRemainingPercent: 19,
                  secondaryRemainingPercent: 87,
                },
                resetAtPrimary: resetPrimary,
                resetAtSecondary: resetSecondary,
                codexSessionCount: 1,
                codexTrackedSessionCount: 1,
                codexLiveSessionCount: 1,
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "watch",
                  activeSnapshotName: "watch",
                  isActiveSnapshot: true,
                  hasLiveSession: true,
                },
              }),
            ],
          }),
        ),
      ),
      http.get("/api/sticky-sessions/session-events", () =>
        HttpResponse.json({
          sessionKey: "session-watch-logs",
          resolvedSessionId: "session-watch-logs",
          sourceFile: "/tmp/rollout-session-watch-logs.jsonl",
          truncated: false,
          events: [
            {
              timestamp: nowIso,
              kind: "prompt",
              title: "Prompt",
              text: "Collect per-session watch logs",
              role: "user",
              rawType: "response_item:message:user",
            },
            {
              timestamp: nowIso,
              kind: "answer",
              title: "Assistant answer",
              text: "Loaded session logs and summarized active quotas.",
              role: "assistant",
              rawType: "response_item:message:assistant",
            },
          ],
        }),
      ),
    );

    window.history.pushState(
      {},
      "",
      "/sessions?accountId=acc_watch&sessionKey=session-watch-logs&view=watch",
    );
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(await screen.findByText("Session watch logs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prompt this session" })).toBeInTheDocument();
    expect(screen.getAllByText("5h").length).toBeGreaterThan(0);
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    expect(screen.getAllByText("Collect per-session watch logs").length).toBeGreaterThan(0);
    expect(screen.getByText("AI timeline")).toBeInTheDocument();
    expect(
      await screen.findByText("Loaded session logs and summarized active quotas."),
    ).toBeInTheDocument();
    expect(screen.getByText(/\$ session=session-watch-logs/i)).toBeInTheDocument();
  });

  it("keeps watch timeline graceful when fallback sessions have no sticky mapping", async () => {
    let sessionEventsRequests = 0;

    server.use(
      http.get("/api/sticky-sessions", () =>
        HttpResponse.json({
          entries: [],
          stalePromptCacheCount: 0,
          total: 0,
          hasMore: false,
        }),
      ),
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_watch_fallback",
                email: "watch-fallback@example.com",
                displayName: "watch-fallback@example.com",
                codexLiveSessionCount: 1,
                codexTrackedSessionCount: 1,
                codexSessionCount: 0,
                codexCurrentTaskPreview: "Waiting for new task",
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "watch-fallback",
                  activeSnapshotName: "watch-fallback",
                  isActiveSnapshot: true,
                  hasLiveSession: true,
                },
              }),
            ],
          }),
        ),
      ),
      http.get("/api/sticky-sessions/session-events", () => {
        sessionEventsRequests += 1;
        return HttpResponse.json(
          {
            error: {
              code: "sticky_session_not_found",
              message: "Sticky session not found",
            },
          },
          { status: 404 },
        );
      }),
    );

    window.history.pushState(
      {},
      "",
      "/sessions?accountId=acc_watch_fallback&sessionKey=pid%3A2716527&view=watch",
    );
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(await screen.findByText("Session watch logs")).toBeInTheDocument();
    expect(screen.getByText("AI timeline")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load session timeline:/i)).not.toBeInTheDocument();
    expect(
      screen.getByText("No prompt/answer timeline was captured for this session yet."),
    ).toBeInTheDocument();
    expect(sessionEventsRequests).toBe(0);
  });

  it("navigates to sessions from header tab", async () => {
    const user = userEvent.setup({ delay: null });

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Sessions" }));
    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
  });

  it("shows unmapped cli sessions when sticky mappings are empty", async () => {
    server.use(
      http.get("/api/sticky-sessions", () =>
        HttpResponse.json({
          entries: [],
          unmappedCliSessions: [
            {
              snapshotName: "edixai",
              processSessionCount: 3,
              runtimeSessionCount: 2,
              totalSessionCount: 3,
              reason: "No account matched this snapshot.",
            },
          ],
          stalePromptCacheCount: 0,
          total: 0,
          hasMore: false,
        }),
      ),
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(createDashboardOverview({ accounts: [] })),
      ),
    );

    window.history.pushState({}, "", "/sessions");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect((await screen.findAllByText("Unmapped CLI sessions")).length).toBeGreaterThan(0);
    expect(screen.getByText("edixai")).toBeInTheDocument();
    expect(screen.getByText("No account matched this snapshot.")).toBeInTheDocument();
  });

  it("fallback mode renders account-level live status, task preview, and recency from overview telemetry", async () => {
    const now = Date.now();
    server.use(
      http.get("/api/sticky-sessions", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("kind") !== "codex_session") {
          return HttpResponse.json({ entries: [], stalePromptCacheCount: 0, total: 0, hasMore: false });
        }
        return HttpResponse.json({
          entries: [],
          stalePromptCacheCount: 0,
          total: 0,
          hasMore: false,
        });
      }),
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_zeus",
                email: "zeus@example.com",
                displayName: "zeus@example.com",
                codexLiveSessionCount: 0,
                codexTrackedSessionCount: 6,
                codexSessionCount: 0,
                codexCurrentTaskPreview: "Prepare release checklist for Zeus account",
                lastUsageRecordedAtPrimary: new Date(now - 30 * 60_000).toISOString(),
                lastUsageRecordedAtSecondary: new Date(now - 2 * 60 * 60_000).toISOString(),
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "zeus",
                  activeSnapshotName: "zeus",
                  isActiveSnapshot: true,
                  hasLiveSession: false,
                },
              }),
            ],
          }),
        ),
      ),
    );

    window.history.pushState({}, "", "/sessions?accountId=acc_zeus");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(await screen.findByText("Session activity")).toBeInTheDocument();
    expect(screen.getAllByText("zeus@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Dashboard overview")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.getByText("Prepare release checklist for Zeus account")).toBeInTheDocument();
    expect(screen.getByText(/last seen/i)).toBeInTheDocument();
    expect(screen.getAllByText("6").length).toBeGreaterThan(0);
  });

  it("fallback mode keeps waiting label and shows last task context from overview telemetry", async () => {
    server.use(
      http.get("/api/sticky-sessions", () =>
        HttpResponse.json({
          entries: [],
          stalePromptCacheCount: 0,
          total: 0,
          hasMore: false,
        }),
      ),
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_waiting",
                email: "waiting@example.com",
                displayName: "waiting@example.com",
                codexLiveSessionCount: 1,
                codexTrackedSessionCount: 1,
                codexSessionCount: 0,
                codexCurrentTaskPreview: "Waiting for new task",
                codexLastTaskPreview: "Capture the waiting session last task preview",
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "waiting",
                  activeSnapshotName: "waiting",
                  isActiveSnapshot: true,
                  hasLiveSession: true,
                },
                lastUsageRecordedAtPrimary: new Date().toISOString(),
              }),
            ],
          }),
        ),
      ),
    );

    window.history.pushState({}, "", "/sessions?accountId=acc_waiting");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(await screen.findByText("waiting@example.com")).toBeInTheDocument();
    expect(screen.getByText("Waiting for new task")).toBeInTheDocument();
    expect(screen.getByText("Last task:")).toBeInTheDocument();
    expect(
      screen.getByText("Capture the waiting session last task preview"),
    ).toBeInTheDocument();
  });

  it("fallback counters use tracked inventory while live badge follows live status", async () => {
    server.use(
      http.get("/api/sticky-sessions", () =>
        HttpResponse.json({
          entries: [],
          stalePromptCacheCount: 0,
          total: 0,
          hasMore: false,
        }),
      ),
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_runtime",
                email: "runtime@example.com",
                displayName: "runtime@example.com",
                codexLiveSessionCount: 0,
                codexTrackedSessionCount: 1,
                codexSessionCount: 0,
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "runtime",
                  activeSnapshotName: "main",
                  isActiveSnapshot: false,
                  hasLiveSession: true,
                },
                lastUsageRecordedAtPrimary: new Date().toISOString(),
              }),
            ],
          }),
        ),
      ),
    );

    window.history.pushState({}, "", "/sessions?accountId=acc_runtime");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(await screen.findByText("Session activity")).toBeInTheDocument();
    expect(screen.getAllByText("runtime@example.com").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Live").length).toBeGreaterThan(0);
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.getByText("1 tracked session")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("fallback mode handles missing task preview and usage timestamps with safe placeholders", async () => {
    server.use(
      http.get("/api/sticky-sessions", () =>
        HttpResponse.json({
          entries: [],
          stalePromptCacheCount: 0,
          total: 0,
          hasMore: false,
        }),
      ),
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_pending",
                email: "pending@example.com",
                displayName: "pending@example.com",
                codexLiveSessionCount: 0,
                codexTrackedSessionCount: 2,
                codexSessionCount: 0,
                codexCurrentTaskPreview: null,
                lastUsageRecordedAtPrimary: null,
                lastUsageRecordedAtSecondary: null,
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "pending",
                  activeSnapshotName: "pending",
                  isActiveSnapshot: false,
                  hasLiveSession: false,
                },
              }),
            ],
          }),
        ),
      ),
    );

    window.history.pushState({}, "", "/sessions?accountId=acc_pending");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(await screen.findByText("pending@example.com")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.getByText("telemetry pending")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("fallback mode detects fresh live quota samples without tracked sessions", async () => {
    const nowIso = new Date().toISOString();
    server.use(
      http.get("/api/sticky-sessions", () =>
        HttpResponse.json({
          entries: [],
          stalePromptCacheCount: 0,
          total: 0,
          hasMore: false,
        }),
      ),
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_sample",
                email: "sample@example.com",
                displayName: "sample@example.com",
                codexLiveSessionCount: 0,
                codexTrackedSessionCount: 0,
                codexSessionCount: 0,
                codexCurrentTaskPreview: "Investigate sample attribution",
                lastUsageRecordedAtPrimary: nowIso,
                lastUsageRecordedAtSecondary: nowIso,
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "sample",
                  activeSnapshotName: "sample",
                  isActiveSnapshot: true,
                  hasLiveSession: false,
                },
                liveQuotaDebug: {
                  snapshotsConsidered: ["sample"],
                  overrideApplied: false,
                  overrideReason: "deferred_active_snapshot_mixed_default_sessions",
                  merged: null,
                  rawSamples: [
                    {
                      source: "/tmp/rollout-sample.jsonl",
                      snapshotName: "sample",
                      recordedAt: nowIso,
                      stale: false,
                      primary: { usedPercent: 41, remainingPercent: 59, resetAt: 1760000000, windowMinutes: 300 },
                      secondary: { usedPercent: 25, remainingPercent: 75, resetAt: 1760600000, windowMinutes: 10080 },
                    },
                  ],
                },
              }),
            ],
          }),
        ),
      ),
    );

    window.history.pushState({}, "", "/sessions?accountId=acc_sample");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(await screen.findByText("sample@example.com")).toBeInTheDocument();
    expect(screen.getByText("1 fresh sample")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.getByText("Investigate sample attribution")).toBeInTheDocument();
  });
});
