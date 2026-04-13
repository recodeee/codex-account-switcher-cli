import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/utils";

import { SkillsPage } from "./skills-page";

const SKILLS_STORAGE_KEY = "recodee.skills.v1";

describe("SkillsPage", () => {
  beforeEach(() => {
    window.localStorage.removeItem(SKILLS_STORAGE_KEY);
  });

  it("renders with a default skill and file", () => {
    renderWithProviders(<SkillsPage />);

    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Code review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SKILL.md" })).toBeInTheDocument();
    expect(screen.getByText("No content yet")).toBeInTheDocument();
  });

  it("creates a skill, adds a file, and edits content", async () => {
    const user = userEvent.setup({ delay: null });

    renderWithProviders(<SkillsPage />);

    await user.click(screen.getByRole("button", { name: "Create skill" }));

    const nameInput = screen.getByPlaceholderText("Skill name");
    const descriptionInput = screen.getByPlaceholderText("Description");

    await user.clear(nameInput);
    await user.type(nameInput, "Deploy to staging");
    await user.type(descriptionInput, "Pipeline and verification");

    await user.click(screen.getByRole("button", { name: "Create file" }));
    await user.click(screen.getByRole("button", { name: "new-file.md" }));

    const textboxes = screen.getAllByRole("textbox");
    const editor = textboxes[textboxes.length - 1];
    expect(editor).toBeDefined();
    if (!editor) {
      throw new Error("Editor textarea not found");
    }
    await user.type(editor, "# Deploy\nRun staging deploy and smoke checks.");

    expect(screen.getByDisplayValue("Deploy to staging")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Pipeline and verification")).toBeInTheDocument();
    expect((editor as HTMLTextAreaElement).value).toContain("Run staging deploy and smoke checks.");
  });
});
