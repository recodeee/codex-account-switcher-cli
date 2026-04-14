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

type UseOpenSpecPlansOptions = {
  projectId: string | null;
  showCompleted: boolean;
};

export function useOpenSpecPlans(selectedSlug: string | null, options: UseOpenSpecPlansOptions) {
  const { projectId, showCompleted } = options;
  const plansQuery = useQuery({
    queryKey: ["projects", "plans", "list", projectId ?? "current"],
    queryFn: () => listOpenSpecPlans(projectId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const sortedEntries = useMemo(() => {
    const entries = plansQuery.data?.entries ?? [];
    return sortPlansNewestFirst(entries);
  }, [plansQuery.data?.entries]);

  const visibleEntries = useMemo(
    () => (showCompleted ? sortedEntries : sortedEntries.filter((entry) => !isPlanFinished(entry.roles))),
    [showCompleted, sortedEntries],
  );

  const effectiveSelectedSlug = useMemo(() => {
    if (visibleEntries.length === 0) {
      return null;
    }

    if (selectedSlug && visibleEntries.some((entry) => entry.slug === selectedSlug)) {
      return selectedSlug;
    }

    return visibleEntries[0].slug;
  }, [selectedSlug, visibleEntries]);

  const planDetailQuery = useQuery({
    queryKey: ["projects", "plans", "detail", projectId ?? "current", effectiveSelectedSlug],
    queryFn: () => getOpenSpecPlan(effectiveSelectedSlug ?? "", projectId),
    enabled: Boolean(effectiveSelectedSlug),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  return {
    plansQuery,
    planDetailQuery,
    effectiveSelectedSlug,
    allEntries: sortedEntries,
    entries: visibleEntries,
  };
}
