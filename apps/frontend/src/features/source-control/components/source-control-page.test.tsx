import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/test/utils";

import { SourceControlPage } from "./source-control-page";

describe("SourceControlPage", () => {
  it("renders branch-focused source control preview with PR actions", async () => {
    const user = userEvent.setup();
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
    expect(screen.getByText("Codex (admin@kozponthiusbolt.hu--dup-2)")).toBeInTheDocument();
    expect(screen.getByText("codex snapshot • live sessions: 1")).toBeInTheDocument();
    expect(screen.queryByText(/Current changes \(/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete branch" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /agent\/fix-auth-refresh/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete branch" })).toBeEnabled();
    });
  });
});
