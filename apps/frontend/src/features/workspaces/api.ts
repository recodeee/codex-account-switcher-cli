import { del, get, post } from "@/lib/api-client";

import {
  WorkspaceCreateRequestSchema,
  WorkspaceEntrySchema,
  WorkspacesResponseSchema,
  WorkspaceSelectionResponseSchema,
} from "@/features/workspaces/schemas";

const WORKSPACES_BASE_PATH = "/api/workspaces";

export function listWorkspaces() {
  return get(WORKSPACES_BASE_PATH, WorkspacesResponseSchema);
}

export function createWorkspace(payload: unknown, options?: { signal?: AbortSignal }) {
  const validated = WorkspaceCreateRequestSchema.parse(payload);
  return post(WORKSPACES_BASE_PATH, WorkspaceEntrySchema, { body: validated, signal: options?.signal });
}

export function selectWorkspace(workspaceId: string) {
  return post(
    `${WORKSPACES_BASE_PATH}/${encodeURIComponent(workspaceId)}/select`,
    WorkspaceSelectionResponseSchema,
  );
}

export function deleteWorkspace(workspaceId: string) {
  return del(`${WORKSPACES_BASE_PATH}/${encodeURIComponent(workspaceId)}`);
}
