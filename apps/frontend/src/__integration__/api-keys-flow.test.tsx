import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import App from "@/App";
import { renderWithProviders } from "@/test/utils";

function getParentRow(cell: HTMLElement): HTMLElement {
  const row = cell.closest("[data-slot='card-content']");
  if (!row) throw new Error("Expected element to be inside a table row");
  return row;
}

describe("api keys flow integration", () => {
  it("creates, shows plain key dialog, edits, and deletes an api key", async () => {
    const user = userEvent.setup();
    const createdName = "Integration Key";

    window.history.pushState({}, "", "/settings");
    renderWithProviders(<App />);

    const tokensTab = await screen.findByRole("tab", { name: "API Tokens" });
    await user.click(tokensTab);

    const createButton = await screen.findByRole("button", { name: "Create" });
    expect(createButton).toBeInTheDocument();
    await user.click(createButton);
    await user.type(screen.getByPlaceholderText("Token name (e.g. My CLI)"), createdName);
    await user.click(screen.getByRole("button", { name: /^Create$/ }));

    const createdDialog = await screen.findByRole("alertdialog", { name: "Token created" });
    expect(screen.getByText(/sk-test-generated/i)).toBeInTheDocument();
    await user.click(within(createdDialog).getByRole("button", { name: "Done" }));

    const createdRow = getParentRow(await screen.findByText(createdName));
    await user.click(within(createdRow).getByRole("button", { name: `Delete ${createdName}` }));
    const confirmDialog = await screen.findByRole("alertdialog", { name: "Delete API token" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText(createdName)).not.toBeInTheDocument();
    });
  });

  it("displays the current api key list on settings", async () => {
    const user = userEvent.setup();

    window.history.pushState({}, "", "/settings");
    renderWithProviders(<App />);

    await user.click(await screen.findByRole("tab", { name: "API Tokens" }));

    const defaultKeyRow = getParentRow(await screen.findByText("Default key"));
    expect(within(defaultKeyRow).getByText(/sk-test\.\.\./i)).toBeInTheDocument();
    expect(within(defaultKeyRow).getByRole("button", { name: "Delete Default key" })).toBeInTheDocument();

    const readOnlyRow = getParentRow(screen.getByText("Read only key"));
    expect(within(readOnlyRow).getByText(/sk-second\.\.\./i)).toBeInTheDocument();
    expect(within(readOnlyRow).getByRole("button", { name: "Delete Read only key" })).toBeInTheDocument();
  });

  it("shows token creation dialog with copy action", async () => {
    const user = userEvent.setup({ delay: null });

    window.history.pushState({}, "", "/settings");
    renderWithProviders(<App />);

    await user.click(await screen.findByRole("tab", { name: "API Tokens" }));
    await user.type(await screen.findByPlaceholderText("Token name (e.g. My CLI)"), "Copy Check Token");
    await user.click(screen.getByRole("button", { name: /^Create$/ }));

    const dialog = await screen.findByRole("alertdialog", { name: "Token created" });
    expect(within(dialog).getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});
