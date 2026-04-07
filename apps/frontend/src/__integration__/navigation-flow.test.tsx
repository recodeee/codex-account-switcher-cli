import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import App from "@/App";
import { renderWithProviders } from "@/test/utils";

describe("navigation flow integration", () => {
  it("switches route content from the sidebar without tearing down layout chrome", async () => {
    const user = userEvent.setup({ delay: null });

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Monitoring your Codex sessions")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Accounts" }));

    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByText("Monitoring your Codex sessions")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/accounts");

    await user.click(screen.getByRole("link", { name: "Billing" }));
    expect(await screen.findByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/billing");

    await user.click(screen.getByRole("link", { name: /Projects/i }));
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/projects");
  });

  it("switches route content from the account dropdown menu", async () => {
    const user = userEvent.setup({ delay: null });

    window.history.pushState({}, "", "/dashboard");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open account menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Accounts" }));

    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/accounts");

    await user.click(screen.getByRole("button", { name: "Open account menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Billing" }));
    expect(await screen.findByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/billing");
  });
});
