import { get } from "@/lib/api-client";

import {
  OpenSpecPlanDetailSchema,
  OpenSpecPlanRuntimeSchema,
  OpenSpecPlansResponseSchema,
} from "@/features/plans/schemas";

const OPEN_SPEC_PLANS_PATH = "/api/projects/plans";

function withProjectFilter(path: string, projectId: string | null | undefined): string {
  if (!projectId) {
    return path;
  }
  const query = new URLSearchParams({ projectId });
  return `${path}?${query.toString()}`;
}

export function listOpenSpecPlans(projectId: string | null = null) {
  return get(withProjectFilter(OPEN_SPEC_PLANS_PATH, projectId), OpenSpecPlansResponseSchema);
}

export function getOpenSpecPlan(planSlug: string, projectId: string | null = null) {
  return get(
    withProjectFilter(`${OPEN_SPEC_PLANS_PATH}/${encodeURIComponent(planSlug)}`, projectId),
    OpenSpecPlanDetailSchema,
  );
}

export function getOpenSpecPlanRuntime(planSlug: string, projectId: string | null = null) {
  return get(
    withProjectFilter(`${OPEN_SPEC_PLANS_PATH}/${encodeURIComponent(planSlug)}/runtime`, projectId),
    OpenSpecPlanRuntimeSchema,
  );
}
