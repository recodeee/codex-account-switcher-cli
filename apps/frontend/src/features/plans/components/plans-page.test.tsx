import { describe, expect, it } from "vitest";

import { buildPlanStarterPrompt } from "@/features/plans/components/plans-page";
import type { OpenSpecPlanDetail } from "@/features/plans/schemas";

const planDetail: OpenSpecPlanDetail = {
  slug: "plans-live-execution-observer",
  title: "plans-live-execution-observer",
  status: "approved",
  updatedAt: "2026-04-08T12:44:08.000Z",
  summaryMarkdown: "# Plan Summary: plans-live-execution-observer",
  checkpointsMarkdown: "# Plan Checkpoints: plans-live-execution-observer",
  roles: [
    {
      role: "planner",
      totalCheckpoints: 1,
      doneCheckpoints: 1,
      tasksMarkdown: "# planner tasks",
      checkpointsMarkdown: null,
    },
    {
      role: "architect",
      totalCheckpoints: 1,
      doneCheckpoints: 1,
      tasksMarkdown: "# architect tasks",
      checkpointsMarkdown: null,
    },
    {
      role: "critic",
      totalCheckpoints: 1,
      doneCheckpoints: 1,
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
  ],
  overallProgress: {
    totalCheckpoints: 6,
    doneCheckpoints: 3,
    percentComplete: 50,
  },
  currentCheckpoint: {
    timestamp: "2026-04-08T12:16:01Z",
    role: "planner",
    checkpointId: "P1",
    state: "IN_PROGRESS",
    message: "Initial RALPLAN-DR draft captured; requesting architect review",
  },
};

describe("buildPlanStarterPrompt", () => {
  it("includes the plan path, current checkpoint, and remaining roles", () => {
    const prompt = buildPlanStarterPrompt(planDetail, "Approved", [
      "Plan Summary: plans-live-execution-observer",
      "Mode: ralplan",
      "Status: approved",
    ]);

    expect(prompt.startsWith("$ralph")).toBe(true);
    expect(prompt).toContain("openspec/plan/plans-live-execution-observer");
    expect(prompt).toContain("Current checkpoint: Planner · P1 · in progress");
    expect(prompt).toContain("Current checkpoint note: Initial RALPLAN-DR draft captured; requesting architect review");
    expect(prompt).toContain("Remaining role checkpoints:");
    expect(prompt).toContain("- Executor 0/1");
    expect(prompt).toContain("Continue implementation from the current checkpoint or the next unfinished role.");
  });
});
