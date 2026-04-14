import { useQuery } from "@tanstack/react-query";

import { getSourceControlPreview } from "@/features/source-control/api";

export function useSourceControl(projectId: string | null) {
  return useQuery({
    queryKey: ["source-control", "preview", projectId ?? "default"],
    queryFn: () => getSourceControlPreview({ projectId }),
    refetchInterval: 12_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

