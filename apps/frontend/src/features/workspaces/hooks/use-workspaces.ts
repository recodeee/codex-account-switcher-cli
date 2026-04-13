import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { createWorkspace, deleteWorkspace, listWorkspaces, selectWorkspace } from "@/features/workspaces/api";
import { ApiError } from "@/lib/api-client";
import type {
  WorkspaceCreateRequest,
  WorkspacesResponse,
} from "@/features/workspaces/schemas";

type WorkspaceCreateMutationInput = WorkspaceCreateRequest & {
  signal?: AbortSignal;
};

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
    mutationFn: ({ signal, ...payload }: WorkspaceCreateMutationInput) =>
      createWorkspace(payload, { signal }),
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
      if (
        error instanceof ApiError &&
        error.code === "network_error" &&
        /aborted/i.test(error.message)
      ) {
        toast.error("Create workspace request timed out. Please retry.");
        return;
      }
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

  const deleteMutation = useMutation({
    mutationFn: ({ workspaceId }: { workspaceId: string; workspaceName: string }) =>
      deleteWorkspace(workspaceId),
    onSuccess: (_, variables) => {
      queryClient.setQueryData<WorkspacesResponse | undefined>(queryKey, (current) => {
        if (!current) {
          return current;
        }
        return {
          entries: current.entries.filter((entry) => entry.id !== variables.workspaceId),
        };
      });
      toast.success(`Workspace removed: ${variables.workspaceName}`);
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete workspace");
    },
  });

  return {
    workspacesQuery,
    createMutation,
    selectMutation,
    deleteMutation,
  };
}
