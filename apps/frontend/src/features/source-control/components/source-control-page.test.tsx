import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/utils";

import { SourceControlPage } from "./source-control-page";

describe("SourceControlPage", () => {
  it("renders branch-focused source control preview with PR actions", async () => {
    renderWithProviders(<SourceControlPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Source Control" })).toBeInTheDocument();
      expect(screen.getByText("Current codex branches")).toBeInTheDocument();
      expect(screen.getByText("Current GX bot statuses")).toBeInTheDocument();
      expect(screen.getByText("Pull request status")).toBeInTheDocument();
    });

    expect(screen.getByText("Master Agent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge PR (gh)" })).toBeInTheDocument();
    const snapshotLines = await screen.findAllByText(/snapshot:\s*demo-source-control/i);
    expect(snapshotLines.length).toBeGreaterThan(0);
    expect(screen.getByText(/working now/i)).toBeInTheDocument();
    expect(screen.getByText("Codex (admin@kozponthiusbolt.hu--dup-2)")).toBeInTheDocument();
    expect(screen.getByText("codex snapshot • live sessions: 1")).toBeInTheDocument();
    expect(screen.getByText("Current changes (agent/demo-source-control)")).toBeInTheDocument();
  });

  it("hides current changes when selected branch has no open PR", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SourceControlPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Source Control" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /agent\/fix-auth-refresh/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Current changes are shown only for agent branches with an open pull request."),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Current changes (agent/fix-auth-refresh)")).not.toBeInTheDocument();
  });
});
