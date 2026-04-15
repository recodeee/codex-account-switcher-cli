import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/utils";

import { SourceControlPage } from "./source-control-page";

describe("SourceControlPage", () => {
  it("renders branch-focused source control preview with PR actions", async () => {
    renderWithProviders(<SourceControlPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Source Control" })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Select repository scope" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Current repository" })).toBeInTheDocument();
      expect(screen.getByText("Current project branch")).toBeInTheDocument();
      expect(screen.getByText("Current pull requests")).toBeInTheDocument();
      expect(screen.getByText("Current GX bot statuses")).toBeInTheDocument();
      expect(screen.getByText("Pull request status")).toBeInTheDocument();
      expect(screen.getByText("Checks awaiting conflict resolution")).toBeInTheDocument();
      expect(screen.getByText("Previous bot review feedback")).toBeInTheDocument();
    });

    expect(screen.getByText("Master Agent")).toBeInTheDocument();
    expect(screen.getByText("Review Bot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge PR (gh)" })).toBeInTheDocument();
    const snapshotLines = await screen.findAllByText(/snapshot:\s*demo-source-control/i);
    expect(snapshotLines.length).toBeGreaterThan(0);
    expect(screen.getByText("Codex (admin@kozponthiusbolt.hu--dup-2)")).toBeInTheDocument();
    expect(screen.getByText("codex snapshot • live sessions: 1")).toBeInTheDocument();
    expect(screen.getByText("CR review content")).toBeInTheDocument();
    expect(screen.getByText(/Please add guardrails for review-bot branch matching before merge./i)).toBeInTheDocument();
    expect(screen.getByText(/You have reached your Codex usage limits for code reviews./i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /https:\/\/github.com\/NagyVikt\/recodee\/pull\/78/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open PR #128/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Frontend lint \(eslint\)/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Current changes \(/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Current codex branches")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete branch" })).toBeDisabled();
  });
});
