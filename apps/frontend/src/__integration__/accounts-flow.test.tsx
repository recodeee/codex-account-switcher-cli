import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import App from "@/App";
import { createAccountSummary } from "@/test/mocks/factories";
import { server } from "@/test/mocks/server";
import { renderWithProviders } from "@/test/utils";

describe("accounts flow integration", () => {
  it("supports account selection and pause/resume actions", async () => {
    const user = userEvent.setup({ delay: null });

    window.history.pushState({}, "", "/accounts");
    renderWithProviders(<App />);

    expect(await screen.findByPlaceholderText("Search accounts...")).toBeInTheDocument();
    expect((await screen.findAllByText("primary@example.com")).length).toBeGreaterThan(0);
    expect(screen.getByText("secondary@example.com")).toBeInTheDocument();

    await user.click(screen.getByText("secondary@example.com"));
    expect(await screen.findByText("Token Status")).toBeInTheDocument();

    const resumeButton = screen.queryByRole("button", { name: "Resume" });
    if (resumeButton) {
      await user.click(resumeButton);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
      });
    } else {
      await user.click(screen.getByRole("button", { name: "Pause" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
      });
    }
  });

  it("switches local codex account from use button", async () => {
    const user = userEvent.setup({ delay: null });

    window.history.pushState({}, "", "/accounts");
    renderWithProviders(<App />);

    expect(await screen.findByPlaceholderText("Search accounts...")).toBeInTheDocument();
    const buttons = await screen.findAllByRole("button", { name: "Use this" });
    const enabledButton = buttons.find((button) => !button.hasAttribute("disabled"));
    expect(enabledButton).toBeDefined();

    await user.click(enabledButton!);
    expect(await screen.findByText(/Switched to/i)).toBeInTheDocument();
  });

  it("selects account details when local snapshot is missing on accounts page", async () => {
    const user = userEvent.setup({ delay: null });

    server.use(
      http.get("/api/accounts", () =>
        HttpResponse.json({
          accounts: [
            createAccountSummary({
              accountId: "acc_no_snapshot",
              email: "nosnapshot@example.com",
              displayName: "nosnapshot@example.com",
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
      http.post("/api/accounts/:accountId/use-local", () =>
        HttpResponse.json(
          {
            error: {
              code: "codex_auth_snapshot_not_found",
              message: "No codex-auth snapshot found for this account.",
            },
          },
          { status: 400 },
        ),
      ),
    );

    window.history.pushState({}, "", "/accounts");
    renderWithProviders(<App />);

    expect(await screen.findByPlaceholderText("Search accounts...")).toBeInTheDocument();
    expect(
      await screen.findByText("No codex-auth snapshot is linked to this account yet."),
    ).toBeInTheDocument();
    const useButtons = await screen.findAllByRole("button", { name: "Use this" });
    if (useButtons.length === 0) {
      throw new Error("Expected at least one use button");
    }
    await user.click(useButtons[0]!);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/accounts");
      expect(window.location.search).toContain("selected=acc_no_snapshot");
    });
  });

  it("starts device OAuth immediately when re-authenticate is clicked on accounts page", async () => {
    const user = userEvent.setup({ delay: null });
    let refreshCalls = 0;

    server.use(
      http.get("/api/accounts", () =>
        HttpResponse.json({
          accounts: [
            createAccountSummary({
              accountId: "acc_reauth_accounts",
              email: "reauth-accounts@example.com",
              displayName: "reauth-accounts@example.com",
              status: "deactivated",
              usage: {
                primaryRemainingPercent: 44,
                secondaryRemainingPercent: 73,
              },
              codexAuth: {
                hasSnapshot: true,
                snapshotName: "reauth-accounts",
                activeSnapshotName: "other",
                isActiveSnapshot: false,
                hasLiveSession: false,
              },
            }),
          ],
        }),
      ),
      http.post("/api/accounts/:accountId/refresh-auth", () => {
        refreshCalls += 1;
        return HttpResponse.json({ status: "refreshed" });
      }),
    );

    window.history.pushState({}, "", "/accounts");
    renderWithProviders(<App />);

    expect(await screen.findByPlaceholderText("Search accounts...")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Re-authenticate" }));

    expect(await screen.findByRole("heading", { name: "Add account with OAuth" })).toBeInTheDocument();
    expect(await screen.findByText("User code")).toBeInTheDocument();
    expect(refreshCalls).toBe(0);
  });
});
