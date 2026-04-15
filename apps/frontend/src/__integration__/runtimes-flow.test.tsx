import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import App from "@/App";
import { createAccountSummary, createDashboardOverview } from "@/test/mocks/factories";
import { server } from "@/test/mocks/server";
import { renderWithProviders } from "@/test/utils";

const hasExactTextContent = (expected: string) => (_: string, node: Element | null) =>
  node?.textContent === expected;

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
                  cliVersion: "0.1.28",
                  latestCliVersion: "0.1.32",
                  cliUpdateAvailable: true,
                  daemonId: "recodee",
                  device: "recodee · codex-cli 0.1.28",
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
      http.get("/api/source-control/commit-activity", () =>
        HttpResponse.json({
          repositoryRoot: "/home/deadpool/Documents/recodee",
          projectPath: null,
          commits: [
            {
              hash: "e8c3e759c8f327e9c7f1a8029f2b58b8a1d8b420",
              subject: "feat(agents): auto-ingest GH bot reviews into Codex autofix workflow",
              authoredAt: nowIso,
              url: "https://github.com/NagyVikt/recodee/commit/e8c3e759c8f327e9c7f1a8029f2b58b8a1d8b420",
            },
          ],
        }),
      ),
      http.post("http://localhost:9000/store/customers/me", () => HttpResponse.json({ customer: {} })),
    );

    window.history.pushState({}, "", "/runtimes");
    renderWithProviders(<App />);

    expect((await screen.findAllByText(hasExactTextContent("Codex (runtime-live)"))).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(hasExactTextContent("Openclaw (openclaw-recodee)"))).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("runtime-live@example.com")).length).toBeGreaterThan(0);
    expect(screen.getByText("Live sessions")).toBeInTheDocument();
    expect(screen.getByText("Ship runtimes view from multica design")).toBeInTheDocument();
    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(screen.getByText("0.1.28")).toBeInTheDocument();
    expect(screen.getByText("0.1.32 available")).toBeInTheDocument();
    expect(screen.getByText("Daemon recodee · Device recodee · codex-cli 0.1.28")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Hide sensitive values" }));
    await waitFor(() => {
      expect(
        screen.getAllByText("runtime-live@example.com").some(
          (node) => node.classList.contains("privacy-blur"),
        ),
      ).toBe(true);
    });
    const activeActivityCell = screen.getByRole("button", { name: /1 requests · 1 commits/i });
    await user.hover(activeActivityCell);
    expect((await screen.findAllByText(/GitHub commits/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/auto-ingest GH bot reviews/i).length).toBeGreaterThan(0);
    await user.unhover(activeActivityCell);
    const idleActivityCell = screen.getAllByRole("button", { name: /0 requests · 0 commits/i })[0];
    await user.hover(idleActivityCell);
    expect(await screen.findByText("No GitHub commits created in this hour.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "pnpm" }));
    expect(screen.getByText(/pnpm add -g @openai\/codex@latest/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy update commands" })).toBeInTheDocument();
  });

  it("shows usage limit hit runtime status instead of live badges", async () => {
    const nowIso = new Date().toISOString();

    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_rate_limited_runtime",
                email: "limit-hit@example.com",
                displayName: "limit-hit@example.com",
                status: "rate_limited",
                codexLiveSessionCount: 1,
                codexTrackedSessionCount: 1,
                codexSessionCount: 1,
                codexCurrentTaskPreview: "Retry after reset window",
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "limit-hit-runtime",
                  activeSnapshotName: "limit-hit-runtime",
                  isActiveSnapshot: true,
                  hasLiveSession: true,
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
              key: "session-limit-hit-1",
              accountId: "acc_rate_limited_runtime",
              displayName: "limit-hit@example.com",
              kind: "codex_session",
              createdAt: nowIso,
              updatedAt: nowIso,
              taskPreview: "Retry after reset window",
              taskUpdatedAt: nowIso,
              isActive: true,
              expiresAt: null,
              isStale: false,
            },
          ],
          unmappedCliSessions: [],
          stalePromptCacheCount: 0,
          total: 1,
          hasMore: false,
        });
      }),
      http.get("/api/accounts/:accountId/trends", ({ params }) =>
        HttpResponse.json({
          accountId: String(params.accountId),
          primary: [{ t: nowIso, v: 0 }],
          secondary: [{ t: nowIso, v: 0 }],
        }),
      ),
      http.get("/api/request-logs", () =>
        HttpResponse.json({
          requests: [],
          total: 0,
          hasMore: false,
        }),
      ),
      http.get("/api/source-control/commit-activity", () =>
        HttpResponse.json({
          repositoryRoot: "/home/deadpool/Documents/recodee",
          projectPath: null,
          commits: [],
        }),
      ),
      http.post("http://localhost:9000/store/customers/me", () => HttpResponse.json({ customer: {} })),
    );

    window.history.pushState({}, "", "/runtimes");
    renderWithProviders(<App />);

    const runtimeStatusDot = await screen.findByLabelText("Runtime usage limit hit");
    const runtimeRow = runtimeStatusDot.closest('[role="button"]');
    expect(runtimeRow).not.toBeNull();
    expect(within(runtimeRow as HTMLElement).getByText("Usage limit hit")).toBeInTheDocument();
    expect(within(runtimeRow as HTMLElement).queryByText(/^Live$/)).not.toBeInTheDocument();
    expect(within(runtimeRow as HTMLElement).queryByText(/^\d+\s+live$/i)).not.toBeInTheDocument();
    expect(within(runtimeRow as HTMLElement).getByLabelText("Runtime usage limit hit")).toBeInTheDocument();
    expect(screen.getAllByText("Usage limit hit").length).toBeGreaterThanOrEqual(2);
  });

  it("deletes a runtime from the list after confirmation", async () => {
    const nowIso = new Date().toISOString();
    const deletedAccountIds = new Set<string>();

    const baseAccounts = [
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
      }),
    ];

    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: baseAccounts.filter(
              (account) => !deletedAccountIds.has(account.accountId),
            ),
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
      http.delete("/api/accounts/:accountId", ({ params }) => {
        deletedAccountIds.add(String(params.accountId));
        return HttpResponse.json({ status: "deleted" });
      }),
      http.get("/api/request-logs", () =>
        HttpResponse.json({
          requests: [],
          total: 0,
          hasMore: false,
        }),
      ),
      http.get("/api/source-control/commit-activity", () =>
        HttpResponse.json({
          repositoryRoot: "/home/deadpool/Documents/recodee",
          projectPath: null,
          commits: [],
        }),
      ),
      http.post("http://localhost:9000/store/customers/me", () =>
        HttpResponse.json({ customer: {} }),
      ),
    );

    window.history.pushState({}, "", "/runtimes");
    renderWithProviders(<App />);
    const user = userEvent.setup();

    expect((await screen.findAllByText(hasExactTextContent("Codex (runtime-live)"))).length).toBeGreaterThan(0);
    const deleteButtons = screen.getAllByRole("button", {
      name: "Delete runtime Codex (runtime-live)",
    });
    expect(deleteButtons).toHaveLength(1);
    expect(deleteButtons[0]).toBeEnabled();
    await user.click(deleteButtons[0]);

    const deleteDialog = await screen.findByRole("alertdialog");
    expect(within(deleteDialog).getByText("Delete runtime?")).toBeInTheDocument();
    await user.click(within(deleteDialog).getByRole("button", { name: "Delete runtime" }));

    await waitFor(() => {
      expect(screen.queryByText(hasExactTextContent("Codex (runtime-live)"))).not.toBeInTheDocument();
    });
    expect((await screen.findAllByText(hasExactTextContent("Openclaw (openclaw-recodee)"))).length).toBeGreaterThan(0);
  });
});
