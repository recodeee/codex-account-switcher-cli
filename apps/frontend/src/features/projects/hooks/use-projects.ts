import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { createProject, deleteProject, listProjects, updateProject } from "@/features/projects/api";
import type { ProjectCreateRequest, ProjectUpdateRequest } from "@/features/projects/schemas";

export function useProjects() {
  const queryClient = useQueryClient();

  const projectsQuery = useQuery({
    queryKey: ["projects", "list"],
    queryFn: listProjects,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: ProjectCreateRequest) => createProject(payload),
    onSuccess: () => {
      toast.success("Project created");
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create project");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ projectId, payload }: { projectId: string; payload: ProjectUpdateRequest }) =>
      updateProject(projectId, payload),
    onSuccess: () => {
      toast.success("Project updated");
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update project");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (projectId: string) => deleteProject(projectId),
    onSuccess: () => {
      toast.success("Project deleted");
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete project");
    },
  });

  return {
    projectsQuery,
    createMutation,
    updateMutation,
    deleteMutation,
  };
}
