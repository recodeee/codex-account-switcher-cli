import { del, get, post, put } from "@/lib/api-client";

import {
  ProjectCreateRequestSchema,
  ProjectDeleteResponseSchema,
  ProjectEntrySchema,
  ProjectsResponseSchema,
  ProjectUpdateRequestSchema,
} from "@/features/projects/schemas";

const PROJECTS_BASE_PATH = "/api/projects";

export function listProjects() {
  return get(PROJECTS_BASE_PATH, ProjectsResponseSchema);
}

export function createProject(payload: unknown) {
  const validated = ProjectCreateRequestSchema.parse(payload);
  return post(PROJECTS_BASE_PATH, ProjectEntrySchema, { body: validated });
}

export function updateProject(projectId: string, payload: unknown) {
  const validated = ProjectUpdateRequestSchema.parse(payload);
  return put(`${PROJECTS_BASE_PATH}/${encodeURIComponent(projectId)}`, ProjectEntrySchema, {
    body: validated,
  });
}

export function deleteProject(projectId: string) {
  return del(`${PROJECTS_BASE_PATH}/${encodeURIComponent(projectId)}`, ProjectDeleteResponseSchema);
}
