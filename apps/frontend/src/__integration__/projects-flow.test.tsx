import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import App from "@/App";
import { sendPromptToAccountTerminal } from "@/features/sessions/terminal-dispatch";
import { renderWithProviders } from "@/test/utils";

vi.mock("@/features/sessions/terminal-dispatch", () => ({
  sendPromptToAccountTerminal: vi.fn().mockResolvedValue(undefined),
}));

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

    window.history.pushState({}, "", "/projects");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Project name (e.g. recodee-core)"), "recodee-core");
    await user.type(
      screen.getByPlaceholderText("Absolute project path (optional)"),
      "/home/deadpool/projects/recodee-core",
    );
    await user.type(screen.getByPlaceholderText("Git branch (optional)"), "feature/recodee-core");
    await user.type(
      screen.getByPlaceholderText("Optional description (max 512 characters)"),
      "Main dashboard project",
    );
    await user.click(screen.getByRole("button", { name: "Add project" }));

    expect(await screen.findByText("recodee-core")).toBeInTheDocument();
    expect(screen.getByText("Main dashboard project")).toBeInTheDocument();
    expect(screen.getByText("/home/deadpool/projects/recodee-core")).toBeInTheDocument();
    expect(screen.getByText("feature/recodee-core")).toBeInTheDocument();
    expect(screen.getAllByText("workspace-write").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Edit project name for recodee-core"));
    await user.type(screen.getByLabelText("Edit project name for recodee-core"), "recodee-core-v2");
    await user.clear(screen.getByLabelText("Edit project description for recodee-core"));
    await user.type(
      screen.getByLabelText("Edit project description for recodee-core"),
      "Updated project details",
    );
    await user.clear(screen.getByLabelText("Edit project path for recodee-core"));
    await user.type(
      screen.getByLabelText("Edit project path for recodee-core"),
      "/home/deadpool/projects/recodee-core-v2",
    );
    await user.clear(screen.getByLabelText("Edit git branch for recodee-core"));
    await user.type(
      screen.getByLabelText("Edit git branch for recodee-core"),
      "feature/recodee-core-v2",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

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

  it("dispatches a Codex prompt from projects control center", async () => {
    const user = userEvent.setup({ delay: null });
    const sendPromptMock = vi.mocked(sendPromptToAccountTerminal);

    sendPromptMock.mockClear();
    window.history.pushState({}, "", "/projects");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();

    const promptInput = screen.getByPlaceholderText(
      "Describe exactly what this Codex account should implement next...",
    );
    await user.type(promptInput, "Implement project control panel refinements");
    await user.click(screen.getByRole("button", { name: "Send to Codex" }));

    await waitFor(() => {
      expect(sendPromptMock).toHaveBeenCalledTimes(1);
    });

    expect(sendPromptMock).toHaveBeenCalledWith({
      accountId: expect.any(String),
      prompt: "Implement project control panel refinements",
    });
  });

  it("inserts saved project context into prompt composer", async () => {
    const user = userEvent.setup({ delay: null });

    window.history.pushState({}, "", "/projects");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Project name (e.g. recodee-core)"), "alpha-sandbox");
    await user.click(screen.getByRole("button", { name: "Add project" }));

    expect(await screen.findByText("alpha-sandbox")).toBeInTheDocument();

    const selectTriggers = screen.getAllByRole("combobox");
    await user.click(selectTriggers[1]);
    await user.click(await screen.findByRole("option", { name: "alpha-sandbox" }));
    await user.click(screen.getByRole("button", { name: "Insert project context" }));

    expect(
      (
        screen.getByPlaceholderText(
          "Describe exactly what this Codex account should implement next...",
        ) as HTMLTextAreaElement
      ).value,
    ).toContain("- Name: alpha-sandbox");
  });
});
