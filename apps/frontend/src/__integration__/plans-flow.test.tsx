import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";

import App from "@/App";
import { server } from "@/test/mocks/server";
import { renderWithProviders } from "@/test/utils";

const elementPrototype = HTMLElement.prototype as HTMLElement & {
  scrollIntoView?: () => void;
  hasPointerCapture?: (pointerId: number) => boolean;
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
};

if (typeof elementPrototype.scrollIntoView !== "function") {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
}

if (typeof elementPrototype.hasPointerCapture !== "function") {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
}

if (typeof elementPrototype.setPointerCapture !== "function") {
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
}

if (typeof elementPrototype.releasePointerCapture !== "function") {
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
}

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
    expect(
      screen.queryByText(
        "You own Wave-7A for full Python->Rust replacement in /home/deadpool/Documents/codex-lb.",
      ),
    ).not.toBeInTheDocument();
    const promptACard = await screen.findByTestId("plan-included-prompt-card-prompt-a-wave-7a-schedulers-jobs");
    const promptAToggle = within(promptACard).getByRole("button", { expanded: false });
    expect(promptAToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(promptAToggle);
    expect(promptAToggle).toHaveAttribute("aria-expanded", "true");
    expect(
      await within(promptACard).findByText(
        "You own Wave-7A for full Python->Rust replacement in /home/deadpool/Documents/codex-lb.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("plan-included-prompt-status-prompt-a-wave-7a-schedulers-jobs")).toHaveTextContent(
      /in progress/i,
    );
    expect(screen.queryByTestId("plan-included-prompt-status-prompt-b-wave-7b-cache-invalidation-poller")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /zoom prompt a/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /zoom prompt a/i }));
    const promptDialog = await screen.findByRole("dialog");
    expect(promptDialog).toBeInTheDocument();
    expect(within(promptDialog).getByText("Prompt A — Wave-7A (Schedulers / Jobs)")).toBeInTheDocument();
    expect(
      within(promptDialog).getByText(
        "You own Wave-7A for full Python->Rust replacement in /home/deadpool/Documents/codex-lb.",
      ),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

  it("filters plans by selected project and hides completed plans by default", async () => {
    const user = userEvent.setup();
    const projectEntries = [
      {
        id: "project-alpha",
        name: "Project Alpha",
        description: null,
        projectUrl: null,
        projectPath: "/workspace/project-alpha",
        sandboxMode: "workspace-write",
        gitBranch: "dev",
        createdAt: "2026-04-08T08:00:00Z",
        updatedAt: "2026-04-08T08:00:00Z",
      },
      {
        id: "project-beta",
        name: "Project Beta",
        description: null,
        projectUrl: null,
        projectPath: "/workspace/project-beta",
        sandboxMode: "workspace-write",
        gitBranch: "dev",
        createdAt: "2026-04-08T08:00:00Z",
        updatedAt: "2026-04-08T08:00:00Z",
      },
    ];

    const planListByProject: Record<string, unknown[]> = {
      "project-alpha": [
        {
          slug: "alpha-inprogress",
          title: "alpha-inprogress",
          status: "running",
          createdAt: "2026-04-08T09:20:00Z",
          updatedAt: "2026-04-08T10:20:00Z",
          summaryMarkdown: "# Plan Summary: alpha-inprogress",
          roles: [{ role: "executor", totalCheckpoints: 2, doneCheckpoints: 1 }],
          overallProgress: { totalCheckpoints: 2, doneCheckpoints: 1, percentComplete: 50 },
          currentCheckpoint: null,
        },
        {
          slug: "alpha-completed",
          title: "alpha-completed",
          status: "completed",
          createdAt: "2026-04-07T09:20:00Z",
          updatedAt: "2026-04-07T10:20:00Z",
          summaryMarkdown: "# Plan Summary: alpha-completed",
          roles: [{ role: "executor", totalCheckpoints: 1, doneCheckpoints: 1 }],
          overallProgress: { totalCheckpoints: 1, doneCheckpoints: 1, percentComplete: 100 },
          currentCheckpoint: null,
        },
      ],
      "project-beta": [
        {
          slug: "beta-inprogress",
          title: "beta-inprogress",
          status: "draft",
          createdAt: "2026-04-09T09:20:00Z",
          updatedAt: "2026-04-09T10:20:00Z",
          summaryMarkdown: "# Plan Summary: beta-inprogress",
          roles: [{ role: "executor", totalCheckpoints: 3, doneCheckpoints: 1 }],
          overallProgress: { totalCheckpoints: 3, doneCheckpoints: 1, percentComplete: 33 },
          currentCheckpoint: null,
        },
      ],
    };

    const planDetailBySlug = {
      "alpha-inprogress": {
        slug: "alpha-inprogress",
        title: "alpha-inprogress",
        status: "running",
        createdAt: "2026-04-08T09:20:00Z",
        updatedAt: "2026-04-08T10:20:00Z",
        summaryMarkdown: "# Plan Summary: alpha-inprogress",
        checkpointsMarkdown: "# Plan Checkpoints: alpha-inprogress",
        roles: [
          {
            role: "executor",
            totalCheckpoints: 2,
            doneCheckpoints: 1,
            tasksMarkdown: "# executor tasks",
            checkpointsMarkdown: null,
          },
        ],
        overallProgress: { totalCheckpoints: 2, doneCheckpoints: 1, percentComplete: 50 },
        currentCheckpoint: null,
        promptBundles: [],
      },
      "beta-inprogress": {
        slug: "beta-inprogress",
        title: "beta-inprogress",
        status: "draft",
        createdAt: "2026-04-09T09:20:00Z",
        updatedAt: "2026-04-09T10:20:00Z",
        summaryMarkdown: "# Plan Summary: beta-inprogress",
        checkpointsMarkdown: "# Plan Checkpoints: beta-inprogress",
        roles: [
          {
            role: "executor",
            totalCheckpoints: 3,
            doneCheckpoints: 1,
            tasksMarkdown: "# executor tasks",
            checkpointsMarkdown: null,
          },
        ],
        overallProgress: { totalCheckpoints: 3, doneCheckpoints: 1, percentComplete: 33 },
        currentCheckpoint: null,
        promptBundles: [],
      },
    } satisfies Record<string, unknown>;

    server.use(
      http.get("/api/projects", () => HttpResponse.json({ entries: projectEntries })),
      http.get("/api/projects/plans", ({ request }) => {
        const url = new URL(request.url);
        const projectId = url.searchParams.get("projectId") ?? "project-alpha";
        return HttpResponse.json({
          entries: planListByProject[projectId] ?? [],
        });
      }),
      http.get("/api/projects/plans/:planSlug", ({ params }) => {
        const planSlug = String(params.planSlug);
        const detail = planDetailBySlug[planSlug as keyof typeof planDetailBySlug];
        if (!detail) {
          return HttpResponse.json(
            {
              error: {
                code: "plan_not_found",
                message: "Plan not found",
              },
            },
            { status: 404 },
          );
        }
        return HttpResponse.json(detail);
      }),
      http.get("/api/projects/plans/:planSlug/runtime", () =>
        HttpResponse.json({
          available: false,
          sessionId: null,
          correlationConfidence: null,
          mode: null,
          phase: null,
          active: false,
          updatedAt: null,
          agents: [],
          events: [],
          lastCheckpoint: null,
          lastError: null,
          canResume: false,
          partial: false,
          staleAfterSeconds: 30,
          reasons: ["correlation_unresolved"],
          unavailableReason: "correlation_unresolved",
        }),
      ),
    );

    window.history.pushState({}, "", "/projects/plans");
    renderWithProviders(<App />);

    expect(await screen.findByRole("heading", { name: "Plans" })).toBeInTheDocument();
    expect(await screen.findByTestId("plan-row-alpha-inprogress")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-row-alpha-completed")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("plans-project-select"));
    await user.click(await screen.findByRole("option", { name: "Project Beta" }));

    expect(await screen.findByTestId("plan-row-beta-inprogress")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId("plan-row-alpha-inprogress")).not.toBeInTheDocument();
    });
  });

  it("shows a copy starter prompt action for the selected plan", async () => {
    window.history.pushState({}, "", "/projects/plans");
    renderWithProviders(<App />);

    expect(await screen.findByRole("button", { name: /copy starter prompt/i })).toBeInTheDocument();
  });
});
