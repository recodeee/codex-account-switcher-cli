import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";

import App from "@/App";
import { server } from "@/test/mocks/server";
import { renderWithProviders } from "@/test/utils";

const elementPrototype = HTMLElement.prototype as unknown as Record<string, unknown>;
if (typeof elementPrototype.scrollIntoView !== "function") {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: vi.fn(),
    writable: true,
  });
}
if (typeof elementPrototype.hasPointerCapture !== "function") {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    value: vi.fn(() => false),
    writable: true,
  });
}
if (typeof elementPrototype.setPointerCapture !== "function") {
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    value: vi.fn(),
    writable: true,
  });
}
if (typeof elementPrototype.releasePointerCapture !== "function") {
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    value: vi.fn(),
    writable: true,
  });
}

describe("projects flow integration", () => {
  it("loads projects page and supports add/edit/delete", async () => {
    const user = userEvent.setup({ delay: null });
    server.use(
      http.post("http://localhost:9000/store/customers/me", () => HttpResponse.json({ customer: {} })),
    );

    window.history.pushState({}, "", "/projects");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New project" }));
    const createDialog = await screen.findByRole("dialog", { name: "New project" });
    expect(within(createDialog).getByText("recodee.com")).toBeInTheDocument();
    await user.type(within(createDialog).getByPlaceholderText("Project title"), "recodee-core");
    await user.type(
      within(createDialog).getByPlaceholderText("Add description..."),
      "Main dashboard project",
    );
    await user.click(within(createDialog).getByRole("button", { name: "Create Project" }));

    expect(await screen.findByText("recodee-core")).toBeInTheDocument();
    expect(screen.getByText("Main dashboard project")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getAllByText("workspace-write").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editDialog = await screen.findByRole("dialog", { name: "Edit project" });
    await user.clear(within(editDialog).getByPlaceholderText("Project name (e.g. recodee-core)"));
    await user.type(within(editDialog).getByPlaceholderText("Project name (e.g. recodee-core)"), "recodee-core-v2");
    await user.clear(within(editDialog).getByPlaceholderText("Optional description (max 512 characters)"));
    await user.type(
      within(editDialog).getByPlaceholderText("Optional description (max 512 characters)"),
      "Updated project details",
    );
    await user.clear(within(editDialog).getByPlaceholderText("Absolute project path (optional)"));
    await user.type(
      within(editDialog).getByPlaceholderText("Absolute project path (optional)"),
      "/home/deadpool/projects/recodee-core-v2",
    );
    await user.clear(within(editDialog).getByPlaceholderText("Git branch (optional)"));
    await user.type(
      within(editDialog).getByPlaceholderText("Git branch (optional)"),
      "feature/recodee-core-v2",
    );
    await user.click(within(editDialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("recodee-core-v2")).toBeInTheDocument();
    expect(screen.getByText("Updated project details")).toBeInTheDocument();
    expect(screen.getByText("/home/deadpool/projects/recodee-core-v2")).toBeInTheDocument();
    expect(screen.getByText("feature/recodee-core-v2")).toBeInTheDocument();
    expect(screen.queryByText("recodee-core")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("recodee-core-v2")).not.toBeInTheDocument();
    });
  });

});
