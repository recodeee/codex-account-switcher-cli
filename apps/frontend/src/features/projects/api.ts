import { del, get, post, put } from "@/lib/api-client";

import {
  ProjectCreateRequestSchema,
  ProjectDeleteResponseSchema,
  ProjectEntrySchema,
  ProjectOpenFolderRequestSchema,
  ProjectPlanLinksResponseSchema,
  ProjectOpenFolderResponseSchema,
  ProjectsResponseSchema,
  ProjectUpdateRequestSchema,
} from "@/features/projects/schemas";

const PROJECTS_BASE_PATH = "/api/projects";

export function listProjects() {
  return get(PROJECTS_BASE_PATH, ProjectsResponseSchema);
}

export function listProjectPlanLinks() {
  return get(`${PROJECTS_BASE_PATH}/plan-links`, ProjectPlanLinksResponseSchema);
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

export function openProjectFolder(projectId: string, target: "vscode" | "file-manager" = "vscode") {
  const validated = ProjectOpenFolderRequestSchema.parse({ target });
  return post(
    `${PROJECTS_BASE_PATH}/${encodeURIComponent(projectId)}/open-folder`,
    ProjectOpenFolderResponseSchema,
    { body: validated },
  );
}
