import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/utils";

import { SourceControlPage } from "./source-control-page";

describe("SourceControlPage", () => {
  it("renders commit, merge, and gx bot sync previews", async () => {
    renderWithProviders(<SourceControlPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Source Control" })).toBeInTheDocument();
      expect(screen.getByText("Commit preview")).toBeInTheDocument();
      expect(screen.getByText("Merge preview")).toBeInTheDocument();
      expect(screen.getByText("GX bot sync")).toBeInTheDocument();
    });

    expect(screen.getByText("feat(source-control): add gx bot commit + merge preview panel")).toBeInTheDocument();
    expect(screen.getByText("Master Agent")).toBeInTheDocument();
    expect(screen.getByText("Runtime Guardrail Bot")).toBeInTheDocument();
    expect(screen.getByText("git checkout agent/demo-source-control")).toBeInTheDocument();
  });
});
