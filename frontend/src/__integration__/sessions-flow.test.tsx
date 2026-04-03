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
    expect(screen.getByText("Investigate alpha session stream retry bug")).toBeInTheDocument();
    expect(screen.getByText("Review beta account quota depletion warnings")).toBeInTheDocument();
    expect(requestUrl).toContain("activeOnly=true");
  });

  it("navigates to sessions from header tab", async () => {
    const user = userEvent.setup({ delay: null });

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Sessions" }));
    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
  });

  it("falls back to dashboard codex session counters when sticky mappings are empty", async () => {
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
                codexSessionCount: 6,
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "zeus",
                  activeSnapshotName: "zeus",
                  isActiveSnapshot: true,
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
    expect(await screen.findByText("Live Codex session counters")).toBeInTheDocument();
    expect(screen.getByText("zeus@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("6").length).toBeGreaterThan(0);
  });

  it("fallback counters include runtime-live accounts even when persisted session count is zero", async () => {
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
                codexSessionCount: 0,
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "runtime",
                  activeSnapshotName: "main",
                  isActiveSnapshot: false,
                  hasLiveSession: true,
                },
              }),
            ],
          }),
        ),
      ),
    );

    window.history.pushState({}, "", "/sessions?accountId=acc_runtime");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(await screen.findByText("Live Codex session counters")).toBeInTheDocument();
    expect(screen.getByText("runtime@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });
});
