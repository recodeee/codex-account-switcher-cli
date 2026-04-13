import { del, get, post, put } from "@/lib/api-client";

import {
  AgentCreateRequestSchema,
  AgentEntrySchema,
  AgentsResponseSchema,
  AgentUpdateRequestSchema,
} from "@/features/agents/schemas";

const AGENTS_BASE_PATH = "/api/agents";

export function listAgents() {
  return get(AGENTS_BASE_PATH, AgentsResponseSchema);
}

export function createAgent(payload: unknown) {
  const validated = AgentCreateRequestSchema.parse(payload);
  return post(AGENTS_BASE_PATH, AgentEntrySchema, { body: validated });
}

export function updateAgent(agentId: string, payload: unknown) {
  const validated = AgentUpdateRequestSchema.parse(payload);
  return put(`${AGENTS_BASE_PATH}/${encodeURIComponent(agentId)}`, AgentEntrySchema, { body: validated });
}

export function deleteAgent(agentId: string) {
  return del(`${AGENTS_BASE_PATH}/${encodeURIComponent(agentId)}`);
}
