import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getOpenSpecPlan, listOpenSpecPlans } from "@/features/plans/api";

function isPlanFinished(roles: { doneCheckpoints: number; totalCheckpoints: number }[]): boolean {
  const done = roles.reduce((acc, role) => acc + role.doneCheckpoints, 0);
  const total = roles.reduce((acc, role) => acc + role.totalCheckpoints, 0);
  return total > 0 && done >= total;
}

function parseTimestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortPlansNewestFirst<T extends { slug: string; createdAt: string; updatedAt: string }>(
  entries: T[],
): T[] {
  return [...entries].sort((left, right) => {
    const createdDelta = parseTimestampMs(right.createdAt) - parseTimestampMs(left.createdAt);
    if (createdDelta !== 0) {
      return createdDelta;
    }

    const updatedDelta = parseTimestampMs(right.updatedAt) - parseTimestampMs(left.updatedAt);
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    return left.slug.localeCompare(right.slug);
  });
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
    const sortedEntries = sortPlansNewestFirst(entries);
    const firstInteractiveEntry = sortedEntries.find((entry) => !isPlanFinished(entry.roles)) ?? null;

    if (sortedEntries.length === 0) {
      return null;
    }

    if (
      selectedSlug &&
      sortedEntries.some((entry) => entry.slug === selectedSlug && !isPlanFinished(entry.roles))
    ) {
      return selectedSlug;
    }

    return firstInteractiveEntry?.slug ?? sortedEntries[0].slug;
  }, [plansQuery.data?.entries, selectedSlug]);

  const planDetailQuery = useQuery({
    queryKey: ["projects", "plans", "detail", effectiveSelectedSlug],
    queryFn: () => getOpenSpecPlan(effectiveSelectedSlug ?? ""),
    enabled: Boolean(effectiveSelectedSlug),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  return {
    plansQuery,
    planDetailQuery,
    effectiveSelectedSlug,
  };
}
