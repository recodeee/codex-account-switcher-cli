import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import App from "@/App";
import {
  createAccountSummary,
  createDashboardOverview,
  createDefaultRequestLogs,
  createRequestLogFilterOptions,
  createRequestLogUsageSummary,
  createRequestLogsResponse,
} from "@/test/mocks/factories";
import { server } from "@/test/mocks/server";
import { renderWithProviders } from "@/test/utils";

describe("dashboard flow integration", () => {
  it("loads dashboard, refetches request logs on filter/pagination, and avoids overview refetch", async () => {
    const user = userEvent.setup({ delay: null });
    const logs = createDefaultRequestLogs();

    let overviewCalls = 0;
    let requestLogCalls = 0;

    server.use(
      http.get("/api/dashboard/overview", () => {
        overviewCalls += 1;
        return HttpResponse.json(createDashboardOverview());
      }),
      http.get("/api/request-logs", ({ request }) => {
        requestLogCalls += 1;
        const url = new URL(request.url);
        const limit = Number(url.searchParams.get("limit") ?? "25");
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const page = logs.slice(offset, Math.min(logs.length, offset + limit));
        return HttpResponse.json(createRequestLogsResponse(page, 100, true));
      }),
      http.get("/api/request-logs/options", () =>
        HttpResponse.json(createRequestLogFilterOptions()),
      ),
    );

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("Request Logs")).toBeInTheDocument();
    expect(await screen.findByText("5h Consumed")).toBeInTheDocument();
    expect(await screen.findByText("Weekly Consumed")).toBeInTheDocument();
    expect(screen.queryByText("Requests (7d)")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(overviewCalls).toBeGreaterThan(0);
      expect(requestLogCalls).toBeGreaterThan(0);
    });

    const overviewAfterLoad = overviewCalls;
    const logsAfterLoad = requestLogCalls;

    await user.type(
      screen.getByPlaceholderText("Search request id, account, model, error..."),
      "quota",
    );

    await waitFor(() => {
      expect(requestLogCalls).toBeGreaterThan(logsAfterLoad);
    });
    expect(overviewCalls).toBe(overviewAfterLoad);

    const logsAfterFilter = requestLogCalls;
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => {
      expect(requestLogCalls).toBeGreaterThan(logsAfterFilter);
    });
    expect(overviewCalls).toBe(overviewAfterLoad);
  });

  it("uses live usage fallback for consumed donuts when request-log usage summary is empty", async () => {
    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_fallback",
                email: "fallback@example.com",
                displayName: "fallback@example.com",
              }),
            ],
            windows: {
              primary: {
                windowKey: "primary",
                windowMinutes: 300,
                accounts: [
                  {
                    accountId: "acc_fallback",
                    remainingPercentAvg: 10,
                    capacityCredits: 1000,
                    remainingCredits: 100,
                  },
                ],
              },
              secondary: {
                windowKey: "secondary",
                windowMinutes: 10_080,
                accounts: [
                  {
                    accountId: "acc_fallback",
                    remainingPercentAvg: 70,
                    capacityCredits: 5000,
                    remainingCredits: 3500,
                  },
                ],
              },
            },
          }),
        ),
      ),
      http.get("/api/request-logs/usage-summary", () =>
        HttpResponse.json(
          createRequestLogUsageSummary({
            last5h: { totalTokens: 0, totalCostUsd: 0, totalCostEur: 0, accounts: [] },
            last7d: { totalTokens: 0, totalCostUsd: 0, totalCostEur: 0, accounts: [] },
          }),
        ),
      ),
    );

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("5h Consumed")).toBeInTheDocument();
    expect(await screen.findByText("Weekly Consumed")).toBeInTheDocument();

    expect(
      await screen.findByText("Using live usage fallback because recent request logs are empty."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("900K").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1.5M").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Top: fallback@example.com · 100%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("fallback@example.com").length).toBeGreaterThanOrEqual(2);
  });

  it("switches local codex account from dashboard account card without forcing a working badge", async () => {
    const user = userEvent.setup({ delay: null });

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    const useButtons = await screen.findAllByRole("button", { name: "Use this account" });
    const targetButton = useButtons.find((button) => !button.hasAttribute("disabled"));
    if (!targetButton) {
      throw new Error("Expected an enabled account switch target");
    }
    const targetCard = targetButton.closest(".card-hover");
    if (!(targetCard instanceof HTMLElement)) {
      throw new Error("Expected target account card");
    }

    await user.click(targetButton);
    expect(await screen.findByText(/Switched to/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(within(targetCard).queryByText("Working now")).not.toBeInTheDocument();
    });
  });

  it("shows snapshot names on dashboard account cards", async () => {
    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_snapshot",
                email: "snapshot@example.com",
                displayName: "snapshot@example.com",
                planType: "team",
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

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("Team · zeus")).toBeInTheDocument();
  });

  it("shows Working now when runtime telemetry marks account as live", async () => {
    const nowIso = new Date().toISOString();
    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_runtime_live",
                email: "runtime-live@example.com",
                displayName: "runtime-live@example.com",
                codexSessionCount: 0,
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "runtime-live",
                  activeSnapshotName: "different-snapshot",
                  isActiveSnapshot: false,
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

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Working now" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Sessions" })).toBeInTheDocument();
  });

  it("routes to account details when local snapshot is missing", async () => {
    const user = userEvent.setup({ delay: null });

    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_no_snapshot",
                status: "active",
                usage: {
                  primaryRemainingPercent: 44,
                  secondaryRemainingPercent: 73,
                },
                codexAuth: {
                  hasSnapshot: false,
                  snapshotName: null,
                  activeSnapshotName: null,
                  isActiveSnapshot: false,
                },
              }),
            ],
          }),
        ),
      ),
      http.post("/api/accounts/:accountId/use-local", ({ params }) => {
        if (params.accountId === "acc_no_snapshot") {
          return HttpResponse.json(
            {
              error: {
                code: "codex_auth_snapshot_not_found",
                message: "No codex-auth snapshot found for this account.",
              },
            },
            { status: 400 },
          );
        }
        return HttpResponse.json({ status: "switched", accountId: String(params.accountId), snapshotName: "main" });
      }),
    );

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    const useButton = await screen.findByRole("button", { name: "Use this account" }) as HTMLButtonElement;
    expect(useButton).toBeEnabled();

    await user.click(useButton);
    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/accounts");
    expect(window.location.search).toContain("selected=acc_no_snapshot");
  });

  it("routes to accounts and opens OAuth method chooser when unlock is clicked", async () => {
    const user = userEvent.setup({ delay: null });

    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_reauth_success",
                status: "active",
                usage: {
                  primaryRemainingPercent: 44,
                  secondaryRemainingPercent: 73,
                },
                codexAuth: {
                  hasSnapshot: false,
                  snapshotName: null,
                  activeSnapshotName: null,
                  isActiveSnapshot: false,
                  hasLiveSession: false,
                },
              }),
            ],
          }),
        ),
      ),
    );

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Unlock" }));

    expect(await screen.findByRole("heading", { name: "Add account with OAuth" })).toBeInTheDocument();
    expect(await screen.findByText("Browser (PKCE)")).toBeInTheDocument();
    expect(await screen.findByText("Device code")).toBeInTheDocument();
    expect(screen.queryByText("User code")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/accounts");
    expect(window.location.search).toContain("selected=acc_reauth_success");
    expect(window.location.search).not.toContain("oauth=");
  });

  it("opens sessions page from account card when codex sessions are present", async () => {
    const user = userEvent.setup({ delay: null });
    const nowIso = new Date().toISOString();

    server.use(
      http.get("/api/dashboard/overview", () =>
        HttpResponse.json(
          createDashboardOverview({
            accounts: [
              createAccountSummary({
                accountId: "acc_with_sessions",
                email: "sessions@example.com",
                displayName: "sessions@example.com",
                codexSessionCount: 6,
                codexAuth: {
                  hasSnapshot: true,
                  snapshotName: "sessions",
                  activeSnapshotName: "sessions",
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

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Sessions" }));

    expect(await screen.findByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/sessions");
    expect(window.location.search).toContain("accountId=acc_with_sessions");
  });

  it("opens a host terminal by calling the launch endpoint", async () => {
    const user = userEvent.setup({ delay: null });
    let openTerminalEndpointCalls = 0;

    server.use(
      http.post("/api/accounts/:accountId/open-terminal", () => {
        openTerminalEndpointCalls += 1;
        return HttpResponse.json({
          status: "opened",
          accountId: "acc_primary",
          snapshotName: "acc_primary",
        });
      }),
    );

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    const terminalButtons = await screen.findAllByRole("button", { name: "Terminal" });
    const targetButton = terminalButtons.find((button) => !button.hasAttribute("disabled"));
    if (!targetButton) {
      throw new Error("Expected an enabled terminal action button");
    }

    await user.click(targetButton);

    expect(await screen.findByText(/Opened terminal for acc_primary/i)).toBeInTheDocument();
    expect(openTerminalEndpointCalls).toBe(1);
    expect(screen.queryByTestId("terminal-window-acc_primary")).not.toBeInTheDocument();
  });

  it("shows an error and does not open in-app terminal when host launch is unavailable", async () => {
    const user = userEvent.setup({ delay: null });
    let openTerminalEndpointCalls = 0;

    server.use(
      http.post("/api/accounts/:accountId/open-terminal", () => {
        openTerminalEndpointCalls += 1;
        return HttpResponse.json(
          {
            error: {
              code: "terminal_launch_failed",
              message: "Failed to open host terminal. No supported terminal app found in PATH.",
            },
          },
          { status: 400 },
        );
      }),
    );

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    const terminalButtons = await screen.findAllByRole("button", { name: "Terminal" });
    const targetButton = terminalButtons.find((button) => !button.hasAttribute("disabled"));
    if (!targetButton) {
      throw new Error("Expected an enabled terminal action button");
    }

    await user.click(targetButton);

    expect(await screen.findByText(/Failed to open host terminal/i)).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-window-acc_primary")).not.toBeInTheDocument();
    expect(openTerminalEndpointCalls).toBe(1);
  });
});
