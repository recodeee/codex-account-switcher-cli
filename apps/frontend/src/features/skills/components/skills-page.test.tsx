import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/utils";

import { SkillsPage } from "./skills-page";

const SKILLS_STORAGE_KEY = "recodee.skills.v1";

describe("SkillsPage", () => {
  beforeEach(() => {
    window.localStorage.removeItem(SKILLS_STORAGE_KEY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the empty state by default", () => {
    renderWithProviders(<SkillsPage />);

    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
    expect(screen.getByText("Select a skill to view details")).toBeInTheDocument();
    expect(screen.queryByText("Files")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Create Skill" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Delete skill" })).not.toBeInTheDocument();
  });

  it("creates a skill via Add Skill dialog, adds a file, and edits content", async () => {
    const user = userEvent.setup({ delay: null });

    renderWithProviders(<SkillsPage />);

    await user.click(screen.getByRole("button", { name: "Add Skill" }));

    const nameInput = screen.getByPlaceholderText("e.g. Code Review, Bug Triage");
    const descriptionInput = screen.getByPlaceholderText(
      "Brief description of what this skill does",
    );

    await user.type(nameInput, "Deploy to staging");
    await user.type(descriptionInput, "Pipeline and verification");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByDisplayValue("Deploy to staging")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pipeline and verification")).toBeInTheDocument();
    expect(screen.getByText("Files")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create file" }));
    await user.click(screen.getByRole("button", { name: "new-file.md" }));

    const textboxes = screen.getAllByRole("textbox");
    const editor = textboxes[textboxes.length - 1];
    expect(editor).toBeDefined();
    if (!editor) {
      throw new Error("Editor textarea not found");
    }

    await user.type(editor, "# Deploy\nRun staging deploy and smoke checks.");

    expect((editor as HTMLTextAreaElement).value).toContain(
      "Run staging deploy and smoke checks.",
    );
  });

  it("imports a skill from a direct SKILL.md URL", async () => {
    const user = userEvent.setup({ delay: null });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://example.com/SKILL.md") {
        return new Response(
          `---\nname: Imported URL Skill\ndescription: Imported from URL\n---\n# Skill\nBody`,
          {
            status: 200,
            headers: {
              "Content-Type": "text/markdown",
            },
          },
        );
      }
      return new Response("Not found", { status: 404 });
    });

    renderWithProviders(<SkillsPage />);

    await user.click(screen.getByRole("button", { name: "Add Skill" }));
    await user.click(screen.getByRole("tab", { name: "Import" }));

    const urlInput = screen.getByPlaceholderText("Paste a skill URL...");
    await user.type(urlInput, "https://example.com/SKILL.md");

    await user.click(screen.getByRole("button", { name: /^Import$/ }));

    expect(screen.getByDisplayValue("Imported URL Skill")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Imported from URL")).toBeInTheDocument();

    const textboxes = screen.getAllByRole("textbox");
    const editor = textboxes[textboxes.length - 1] as HTMLTextAreaElement;
    expect(editor.value).toContain("# Skill");
  });

  it("deletes a selected skill via the confirmation dialog", async () => {
    const user = userEvent.setup({ delay: null });

    renderWithProviders(<SkillsPage />);

    await user.click(screen.getByRole("button", { name: "Add Skill" }));
    await user.type(
      screen.getByPlaceholderText("e.g. Code Review, Bug Triage"),
      "Delete me",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByDisplayValue("Delete me")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete skill" }));

    expect(
      await screen.findByRole("dialog", { name: "Delete skill?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.queryByDisplayValue("Delete me")).not.toBeInTheDocument();
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
    expect(screen.getByText("Select a skill to view details")).toBeInTheDocument();
    expect(screen.queryByText("Files")).not.toBeInTheDocument();
  });
});
