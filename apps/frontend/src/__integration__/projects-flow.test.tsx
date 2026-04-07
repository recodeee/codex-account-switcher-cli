import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import App from "@/App";
import { renderWithProviders } from "@/test/utils";

describe("projects flow integration", () => {
  it("loads projects page and supports add/edit/delete", async () => {
    const user = userEvent.setup({ delay: null });

    window.history.pushState({}, "", "/projects");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Project name (e.g. recodee-core)"), "recodee-core");
    await user.type(
      screen.getByPlaceholderText("Optional description (max 512 characters)"),
      "Main dashboard project",
    );
    await user.click(screen.getByRole("button", { name: "Add project" }));

    expect(await screen.findByText("recodee-core")).toBeInTheDocument();
    expect(screen.getByText("Main dashboard project")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Edit project name for recodee-core"));
    await user.type(screen.getByLabelText("Edit project name for recodee-core"), "recodee-core-v2");
    await user.clear(screen.getByLabelText("Edit project description for recodee-core"));
    await user.type(
      screen.getByLabelText("Edit project description for recodee-core"),
      "Updated project details",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("recodee-core-v2")).toBeInTheDocument();
    expect(screen.getByText("Updated project details")).toBeInTheDocument();
    expect(screen.queryByText("recodee-core")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("recodee-core-v2")).not.toBeInTheDocument();
    });
  });
});
