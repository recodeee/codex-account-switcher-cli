import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/utils";

import { AgentsPage } from "./agents-page";

const AGENTS_STORAGE_KEY = "recodee.agents.v1";

describe("AgentsPage", () => {
  beforeEach(() => {
    window.localStorage.removeItem(AGENTS_STORAGE_KEY);
  });

  it("renders default agent with tabs", () => {
    renderWithProviders(<AgentsPage />);

    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Master Agent/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Instructions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Settings" })).toBeInTheDocument();
  });

  it("creates a new agent from popup", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<AgentsPage />);

    await user.click(screen.getByRole("button", { name: "Create agent" }));

    expect(screen.getByRole("dialog", { name: "Create Agent" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("e.g. Deep Research Agent"), "Deep Research Agent");
    await user.type(screen.getByPlaceholderText("What does this agent do?"), "Investigates and synthesizes docs");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByRole("button", { name: /Deep Research Agent/i })).toBeInTheDocument();
    expect(screen.getAllByText("Deep Research Agent").length).toBeGreaterThanOrEqual(1);
  });
});
