import type { AccountSummary } from "@/features/accounts/schemas";

export const WAITING_FOR_RUNTIME_TASK_LABEL = "Waiting for new task";

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function normalizeRuntimeTaskPreview(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.toLowerCase();
  if (
    normalized === WAITING_FOR_RUNTIME_TASK_LABEL.toLowerCase() ||
    normalized === "done" ||
    normalized === "completed" ||
    normalized === "finished"
  ) {
    return null;
  }
  return trimmed;
}

export function resolveRuntimeTaskPreviews(
  account: AccountSummary,
  liveSessionCount: number,
): string[] {
  const sessionTaskByKey = new Map<
    string,
    {
      sessionKey: string;
      taskPreview: string | null;
      taskUpdatedAt: string | null;
      sourceIndex: number;
    }
  >();

  for (const [sourceIndex, preview] of (
    account.codexSessionTaskPreviews ?? []
  ).entries()) {
    const sessionKey = preview.sessionKey?.trim();
    if (!sessionKey) {
      continue;
    }

    const candidate = {
      sessionKey,
      taskPreview: preview.taskPreview ?? null,
      taskUpdatedAt: preview.taskUpdatedAt ?? null,
      sourceIndex,
    };
    const existing = sessionTaskByKey.get(sessionKey);
    if (!existing) {
      sessionTaskByKey.set(sessionKey, candidate);
      continue;
    }

    const existingTimestamp = parseTimestamp(existing.taskUpdatedAt);
    const candidateTimestamp = parseTimestamp(candidate.taskUpdatedAt);
    const shouldReplace =
      candidateTimestamp > existingTimestamp ||
      (candidateTimestamp === existingTimestamp &&
        candidate.sourceIndex > existing.sourceIndex);

    if (shouldReplace) {
      sessionTaskByKey.set(sessionKey, candidate);
    }
  }

  const sessionTaskPreviews = Array.from(sessionTaskByKey.values())
    .sort((left, right) => {
      const timestampDelta =
        parseTimestamp(right.taskUpdatedAt) - parseTimestamp(left.taskUpdatedAt);
      if (timestampDelta !== 0) {
        return timestampDelta;
      }
      return left.sessionKey.localeCompare(right.sessionKey);
    })
    .map((preview) =>
      normalizeRuntimeTaskPreview(preview.taskPreview) ??
      WAITING_FOR_RUNTIME_TASK_LABEL,
    );

  const accountTaskPreview = normalizeRuntimeTaskPreview(
    account.codexCurrentTaskPreview,
  );
  const taskPreviews = [...sessionTaskPreviews];

  if (accountTaskPreview && !taskPreviews.includes(accountTaskPreview)) {
    taskPreviews.unshift(accountTaskPreview);
  }

  if (taskPreviews.length === 0) {
    if (accountTaskPreview) {
      taskPreviews.push(accountTaskPreview);
    } else if (liveSessionCount > 0) {
      taskPreviews.push(WAITING_FOR_RUNTIME_TASK_LABEL);
    }
  }

  if (liveSessionCount <= 0) {
    return taskPreviews;
  }

  while (taskPreviews.length < liveSessionCount) {
    taskPreviews.push(WAITING_FOR_RUNTIME_TASK_LABEL);
  }

  return taskPreviews;
}
