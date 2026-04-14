import { z } from "zod";

export const PROJECT_SANDBOX_MODES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export const ProjectSandboxModeSchema = z.enum(PROJECT_SANDBOX_MODES);

export const ProjectEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  projectUrl: z.string().nullable(),
<<<<<<< Updated upstream
  githubRepoUrl: z.string().nullable().default(null),
=======
  githubRepoUrl: z.string().nullable(),
>>>>>>> Stashed changes
  projectPath: z.string().nullable(),
  sandboxMode: ProjectSandboxModeSchema,
  gitBranch: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const ProjectsResponseSchema = z.object({
  entries: z.array(ProjectEntrySchema).default([]),
});

export const ProjectCreateRequestSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).nullable().optional(),
  projectUrl: z.string().max(2048).nullable().optional(),
  githubRepoUrl: z.string().max(2048).nullable().optional(),
  projectPath: z.string().max(1024).nullable().optional(),
  sandboxMode: ProjectSandboxModeSchema.default("workspace-write"),
  gitBranch: z.string().max(255).nullable().optional(),
});

export const ProjectUpdateRequestSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).nullable().optional(),
  projectUrl: z.string().max(2048).nullable().optional(),
  githubRepoUrl: z.string().max(2048).nullable().optional(),
  projectPath: z.string().max(1024).nullable().optional(),
  sandboxMode: ProjectSandboxModeSchema.default("workspace-write"),
  gitBranch: z.string().max(255).nullable().optional(),
});

export const ProjectDeleteResponseSchema = z.object({
  status: z.string().min(1),
});

export const ProjectOpenFolderResponseSchema = z.object({
  status: z.string().min(1),
  projectPath: z.string().min(1),
  editor: z.string().nullable().optional(),
});

export const ProjectPlanLinkEntrySchema = z.object({
  projectId: z.string().min(1),
  planCount: z.number().int().min(0),
  latestPlanSlug: z.string().nullable(),
  latestPlanUpdatedAt: z.string().datetime({ offset: true }).nullable(),
});

export const ProjectPlanLinksResponseSchema = z.object({
  entries: z.array(ProjectPlanLinkEntrySchema).default([]),
});

export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;
export type ProjectsResponse = z.infer<typeof ProjectsResponseSchema>;
export type ProjectCreateRequest = z.input<typeof ProjectCreateRequestSchema>;
export type ProjectUpdateRequest = z.input<typeof ProjectUpdateRequestSchema>;
export type ProjectDeleteResponse = z.infer<typeof ProjectDeleteResponseSchema>;
export type ProjectOpenFolderResponse = z.infer<typeof ProjectOpenFolderResponseSchema>;
export type ProjectSandboxMode = z.infer<typeof ProjectSandboxModeSchema>;
export type ProjectPlanLinkEntry = z.infer<typeof ProjectPlanLinkEntrySchema>;
export type ProjectPlanLinksResponse = z.infer<typeof ProjectPlanLinksResponseSchema>;
