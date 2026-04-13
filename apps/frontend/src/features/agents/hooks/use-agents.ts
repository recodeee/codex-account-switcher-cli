import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { createAgent, deleteAgent, listAgents, updateAgent } from "@/features/agents/api";
import type {
  AgentCreateRequest,
  AgentEntry,
  AgentUpdateRequest,
  AgentsResponse,
} from "@/features/agents/schemas";

export function useAgents() {
  const queryClient = useQueryClient();
  const queryKey = ["agents", "list"] as const;

  const agentsQuery = useQuery({
    queryKey,
    queryFn: listAgents,
    refetchOnWindowFocus: true,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey });
  };

  const createMutation = useMutation({
    mutationFn: (payload: AgentCreateRequest) => createAgent(payload),
    onSuccess: (created) => {
      queryClient.setQueryData<AgentsResponse | undefined>(queryKey, (current) => {
        if (!current) {
          return current;
        }
        return {
          entries: [created, ...current.entries.filter((entry) => entry.id !== created.id)],
        };
      });
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create agent");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ agentId, payload }: { agentId: string; payload: AgentUpdateRequest }) =>
      updateAgent(agentId, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData<AgentsResponse | undefined>(queryKey, (current) => {
        if (!current) {
          return current;
        }
        return {
          entries: current.entries.map((entry) => (entry.id === updated.id ? updated : entry)),
        };
      });
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to save agent");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (variables: { agentId: string; agentName: string }) => deleteAgent(variables.agentId),
    onSuccess: (_, variables) => {
      queryClient.setQueryData<AgentsResponse | undefined>(queryKey, (current) => {
        if (!current) {
          return current;
        }
        return {
          entries: current.entries.filter((entry) => entry.id !== variables.agentId),
        };
      });
      toast.success(`Removed agent: ${variables.agentName}`);
      invalidate();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to remove agent");
    },
  });

  return {
    agentsQuery,
    createMutation,
    updateMutation,
    deleteMutation,
  };
}

export type { AgentEntry };
