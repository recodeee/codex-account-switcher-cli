import { get } from "@/lib/api-client";

import {
  OpenSpecPlanDetailSchema,
  OpenSpecPlanRuntimeSchema,
  OpenSpecPlansResponseSchema,
} from "@/features/plans/schemas";

const OPEN_SPEC_PLANS_PATH = "/api/projects/plans";

export function listOpenSpecPlans() {
  return get(OPEN_SPEC_PLANS_PATH, OpenSpecPlansResponseSchema);
}

export function getOpenSpecPlan(planSlug: string) {
  return get(`${OPEN_SPEC_PLANS_PATH}/${encodeURIComponent(planSlug)}`, OpenSpecPlanDetailSchema);
}

export function getOpenSpecPlanRuntime(planSlug: string) {
  return get(
    `${OPEN_SPEC_PLANS_PATH}/${encodeURIComponent(planSlug)}/runtime`,
    OpenSpecPlanRuntimeSchema,
  );
}
