import { describe, expect, it } from "vitest";

import { createAccountSummary } from "@/test/mocks/factories";
import {
  WAITING_FOR_RUNTIME_TASK_LABEL,
  normalizeRuntimeTaskPreview,
  resolveRuntimeTaskPreviews,
} from "./runtime-task-previews";

describe("normalizeRuntimeTaskPreview", () => {
  it("returns null for waiting and terminal status previews", () => {
    expect(normalizeRuntimeTaskPreview("Waiting for new task")).toBeNull();
    expect(normalizeRuntimeTaskPreview("done")).toBeNull();
    expect(normalizeRuntimeTaskPreview("completed")).toBeNull();
    expect(normalizeRuntimeTaskPreview("finished")).toBeNull();
  });

  it("keeps actionable previews", () => {
    expect(normalizeRuntimeTaskPreview("  Build PR merge flow  ")).toBe(
      "Build PR merge flow",
    );
  });
});

describe("resolveRuntimeTaskPreviews", () => {
  it("returns one preview per live session when multiple session previews exist", () => {
    const account = createAccountSummary({
      codexCurrentTaskPreview: "Merge dev branch cleanup",
      codexSessionTaskPreviews: [
        {
          sessionKey: "session-a",
          taskPreview: "Merge dev branch cleanup",
          taskUpdatedAt: "2026-04-13T17:25:00.000Z",
        },
        {
          sessionKey: "session-b",
          taskPreview: "Run final verification and pull dev",
          taskUpdatedAt: "2026-04-13T17:26:00.000Z",
        },
      ],
    });

    expect(resolveRuntimeTaskPreviews(account, 2)).toEqual([
      "Run final verification and pull dev",
      "Merge dev branch cleanup",
    ]);
  });

  it("fills missing live-session rows with waiting placeholders", () => {
    const account = createAccountSummary({
      codexCurrentTaskPreview: "Prepare PR details",
      codexSessionTaskPreviews: [
        {
          sessionKey: "session-a",
          taskPreview: "Prepare PR details",
          taskUpdatedAt: "2026-04-13T17:26:00.000Z",
        },
      ],
    });

    expect(resolveRuntimeTaskPreviews(account, 2)).toEqual([
      "Prepare PR details",
      WAITING_FOR_RUNTIME_TASK_LABEL,
    ]);
  });

  it("prefers the newest preview for duplicate session keys", () => {
    const account = createAccountSummary({
      codexCurrentTaskPreview: null,
      codexSessionTaskPreviews: [
        {
          sessionKey: "session-a",
          taskPreview: "Old preview",
          taskUpdatedAt: "2026-04-13T17:20:00.000Z",
        },
        {
          sessionKey: "session-a",
          taskPreview: "Newest preview",
          taskUpdatedAt: "2026-04-13T17:30:00.000Z",
        },
      ],
    });

    expect(resolveRuntimeTaskPreviews(account, 1)).toEqual(["Newest preview"]);
  });

  it("falls back to account preview when per-session previews are missing", () => {
    const account = createAccountSummary({
      codexCurrentTaskPreview: "Review merged dev branch",
      codexSessionTaskPreviews: [],
    });

    expect(resolveRuntimeTaskPreviews(account, 2)).toEqual([
      "Review merged dev branch",
      WAITING_FOR_RUNTIME_TASK_LABEL,
    ]);
  });
});
