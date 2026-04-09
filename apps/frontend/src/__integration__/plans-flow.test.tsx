import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import App from "@/App";
import { server } from "@/test/mocks/server";
import { renderWithProviders } from "@/test/utils";

describe("plans flow integration", () => {
  it("renders plan progress percent, checkpoint resume card, and designer role", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/projects/plans");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Plans" })).toBeInTheDocument();
    expect(await screen.findByTestId("plan-initial-prompt")).toHaveTextContent(
      "Initial prompt: Create a Projects -> Plans page (/projects/plans) with visualized OpenSpec plan data.",
    );
    expect(await screen.findByTestId("plan-initial-prompt-images")).toHaveTextContent("[Image #1]");
    expect(await screen.findByRole("img", { name: "Initial prompt attachment 1" })).toBeInTheDocument();
    expect(await screen.findByTestId("plan-row-initial-prompt-projects-plans-page")).toHaveTextContent(
      "Initial prompt: Create a Projects -> Plans page (/projects/plans) with visualized OpenSpec plan data.",
    );
    expect(
      await screen.findByTestId("plan-row-initial-prompt-attachments-projects-plans-page"),
    ).toHaveTextContent("2 attachments");

    expect(await screen.findByTestId("plan-progress-percent")).toHaveTextContent("43%");
    const currentCheckpoint = await screen.findByTestId("plan-current-checkpoint");
    expect(currentCheckpoint).toHaveTextContent(/executor/i);
    expect(currentCheckpoint).toHaveTextContent(/E1/);
    expect(screen.getAllByText("Designer").length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByTestId("plan-left-off-card")).toHaveClass("border-red-500/40");
    expect(await screen.findByTestId("plan-step-timeline")).toHaveTextContent("Plan steps");
    expect(screen.getByTestId("plan-step-timeline")).toHaveTextContent("Planner");
    expect(await screen.findByTestId("plan-included-prompts")).toHaveTextContent("Included AI prompts");
    expect(await screen.findByRole("button", { name: /copy prompt a/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /copy prompt b/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /copy prompt c/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /copy prompt d/i })).toBeInTheDocument();
    expect(screen.queryByTestId("plan-summary-content")).not.toBeInTheDocument();
    expect(screen.queryByTestId("plan-checkpoints-content")).not.toBeInTheDocument();
    expect(screen.queryByTestId("plan-runtime-observer")).not.toBeInTheDocument();

    const plannerToggle = within(screen.getByTestId("plan-step-timeline")).getByRole("button", {
      name: /planner/i,
    });
    expect(screen.getByText(/draft completed/i)).toHaveClass("line-through");
    expect(plannerToggle).toHaveAttribute("aria-expanded", "true");
    await user.click(plannerToggle);
    expect(plannerToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("shows fallback when no current checkpoint exists", async () => {
    server.use(
      http.get("/api/projects/plans", () =>
        HttpResponse.json({
          entries: [
            {
              slug: "plan-no-checkpoint",
              title: "plan-no-checkpoint",
              status: "draft",
              createdAt: new Date("2026-04-08T09:20:00Z").toISOString(),
              updatedAt: new Date("2026-04-08T10:20:00Z").toISOString(),
              summaryMarkdown: "# Plan Summary: plan-no-checkpoint",
              roles: [
                { role: "planner", totalCheckpoints: 1, doneCheckpoints: 0 },
                { role: "architect", totalCheckpoints: 1, doneCheckpoints: 0 },
                { role: "critic", totalCheckpoints: 1, doneCheckpoints: 0 },
                { role: "executor", totalCheckpoints: 1, doneCheckpoints: 0 },
                { role: "writer", totalCheckpoints: 1, doneCheckpoints: 0 },
                { role: "verifier", totalCheckpoints: 1, doneCheckpoints: 0 },
                { role: "designer", totalCheckpoints: 1, doneCheckpoints: 0 },
              ],
              overallProgress: {
                totalCheckpoints: 7,
                doneCheckpoints: 0,
                percentComplete: 0,
              },
              currentCheckpoint: null,
            },
          ],
        }),
      ),
      http.get("/api/projects/plans/:planSlug", () =>
        HttpResponse.json({
          slug: "plan-no-checkpoint",
          title: "plan-no-checkpoint",
          status: "draft",
          createdAt: new Date("2026-04-08T09:20:00Z").toISOString(),
          updatedAt: new Date("2026-04-08T10:20:00Z").toISOString(),
          summaryMarkdown: "# Plan Summary: plan-no-checkpoint",
          checkpointsMarkdown: "# Plan Checkpoints: plan-no-checkpoint",
          roles: [
            {
              role: "planner",
              totalCheckpoints: 1,
              doneCheckpoints: 0,
              tasksMarkdown: "# planner tasks",
              checkpointsMarkdown: null,
            },
            {
              role: "architect",
              totalCheckpoints: 1,
              doneCheckpoints: 0,
              tasksMarkdown: "# architect tasks",
              checkpointsMarkdown: null,
            },
            {
              role: "critic",
              totalCheckpoints: 1,
              doneCheckpoints: 0,
              tasksMarkdown: "# critic tasks",
              checkpointsMarkdown: null,
            },
            {
              role: "executor",
              totalCheckpoints: 1,
              doneCheckpoints: 0,
              tasksMarkdown: "# executor tasks",
              checkpointsMarkdown: null,
            },
            {
              role: "writer",
              totalCheckpoints: 1,
              doneCheckpoints: 0,
              tasksMarkdown: "# writer tasks",
              checkpointsMarkdown: null,
            },
            {
              role: "verifier",
              totalCheckpoints: 1,
              doneCheckpoints: 0,
              tasksMarkdown: "# verifier tasks",
              checkpointsMarkdown: null,
            },
            {
              role: "designer",
              totalCheckpoints: 1,
              doneCheckpoints: 0,
              tasksMarkdown: "# designer tasks",
              checkpointsMarkdown: null,
            },
          ],
          overallProgress: {
            totalCheckpoints: 7,
            doneCheckpoints: 0,
            percentComplete: 0,
          },
          currentCheckpoint: null,
        }),
      ),
      http.get("/api/projects/plans/:planSlug/runtime", () =>
        HttpResponse.json({
          available: false,
          sessionId: "019d6cae-f82e-7670-a403-b5fae5c6e85c",
          correlationConfidence: "medium",
          mode: "ralplan",
          phase: "planning",
          active: false,
          updatedAt: new Date("2026-04-08T10:20:00Z").toISOString(),
          agents: [],
          events: [],
          lastCheckpoint: null,
          lastError: {
            timestamp: "2026-04-08T10:19:58Z",
            code: "agent_events_missing",
            message: "Agent telemetry missing",
            source: "runtime",
            recoverable: true,
          },
          canResume: true,
          partial: true,
          staleAfterSeconds: 30,
          reasons: ["agent_events_missing"],
          unavailableReason: "agent_events_missing",
        }),
      ),
    );

    window.history.pushState({}, "", "/projects/plans");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Plans" })).toBeInTheDocument();
    expect(await screen.findByTestId("plan-left-off-card")).toHaveClass("border-red-500/40");
    expect(await screen.findByText("No checkpoint activity recorded yet.")).toBeInTheDocument();
    expect(await screen.findByTestId("plan-step-timeline")).toHaveTextContent("Plan steps");
    expect(screen.queryByTestId("plan-runtime-observer")).not.toBeInTheDocument();
  });

  it("shows a copy starter prompt action for the selected plan", async () => {
    window.history.pushState({}, "", "/projects/plans");
    renderWithProviders(<App />);

    expect(await screen.findByRole("button", { name: /copy starter prompt/i })).toBeInTheDocument();
  });
});
