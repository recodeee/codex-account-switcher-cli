import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getOpenSpecPlan, getOpenSpecPlanRuntime, listOpenSpecPlans } from "@/features/plans/api";

function isPlanFinished(roles: { doneCheckpoints: number; totalCheckpoints: number }[]): boolean {
  const done = roles.reduce((acc, role) => acc + role.doneCheckpoints, 0);
  const total = roles.reduce((acc, role) => acc + role.totalCheckpoints, 0);
  return total > 0 && done >= total;
}

export function useOpenSpecPlans(selectedSlug: string | null) {
  const plansQuery = useQuery({
    queryKey: ["projects", "plans", "list"],
    queryFn: listOpenSpecPlans,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const effectiveSelectedSlug = useMemo(() => {
    const entries = plansQuery.data?.entries ?? [];
    const firstInteractiveEntry = entries.find((entry) => !isPlanFinished(entry.roles)) ?? null;

    if (entries.length === 0) {
      return null;
    }

    if (
      selectedSlug &&
      entries.some((entry) => entry.slug === selectedSlug && !isPlanFinished(entry.roles))
    ) {
      return selectedSlug;
    }

    return firstInteractiveEntry?.slug ?? entries[0].slug;
  }, [plansQuery.data?.entries, selectedSlug]);

  const planDetailQuery = useQuery({
    queryKey: ["projects", "plans", "detail", effectiveSelectedSlug],
    queryFn: () => getOpenSpecPlan(effectiveSelectedSlug ?? ""),
    enabled: Boolean(effectiveSelectedSlug),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const planRuntimeQuery = useQuery({
    queryKey: ["projects", "plans", "runtime", effectiveSelectedSlug],
    queryFn: () => getOpenSpecPlanRuntime(effectiveSelectedSlug ?? ""),
    enabled: Boolean(effectiveSelectedSlug),
    refetchInterval: (query) => {
      const runtime = query.state.data;
      if (runtime?.active) {
        return 5_000;
      }
      if (runtime?.available === false) {
        return false;
      }
      return 30_000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  return {
    plansQuery,
    planDetailQuery,
    planRuntimeQuery,
    effectiveSelectedSlug,
  };
}
