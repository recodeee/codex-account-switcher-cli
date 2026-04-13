import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { createWorkspace, listWorkspaces, selectWorkspace } from "@/features/workspaces/api";
import type {
  WorkspaceCreateRequest,
  WorkspacesResponse,
} from "@/features/workspaces/schemas";

export function useWorkspaces() {
  const queryClient = useQueryClient();
  const queryKey = ["workspaces", "list"] as const;

  const workspacesQuery = useQuery({
    queryKey,
    queryFn: listWorkspaces,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey });
  };

  const createMutation = useMutation({
    mutationFn: (payload: WorkspaceCreateRequest) => createWorkspace(payload),
    onSuccess: (created) => {
      queryClient.setQueryData<WorkspacesResponse | undefined>(queryKey, (current) => {
        if (!current) {
          return current;
        }
        const remaining = current.entries
          .filter((entry) => entry.id !== created.id)
          .map((entry) => ({ ...entry, isActive: false }));
        return {
          entries: [created, ...remaining],
        };
      });
      toast.success("Workspace created");
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create workspace");
    },
  });

  const selectMutation = useMutation({
    mutationFn: (workspaceId: string) => selectWorkspace(workspaceId),
    onSuccess: (selection) => {
      queryClient.setQueryData<WorkspacesResponse | undefined>(queryKey, (current) => {
        if (!current) {
          return current;
        }
        return {
          entries: current.entries.map((entry) => ({
            ...entry,
            isActive: entry.id === selection.activeWorkspaceId,
          })),
        };
      });
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to select workspace");
    },
  });

  return {
    workspacesQuery,
    createMutation,
    selectMutation,
  };
}
