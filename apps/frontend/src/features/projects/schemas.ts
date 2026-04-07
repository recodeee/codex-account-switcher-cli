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
  projectPath: z.string().max(1024).nullable().optional(),
  sandboxMode: ProjectSandboxModeSchema.default("workspace-write"),
  gitBranch: z.string().max(255).nullable().optional(),
});

export const ProjectUpdateRequestSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).nullable().optional(),
  projectPath: z.string().max(1024).nullable().optional(),
  sandboxMode: ProjectSandboxModeSchema.default("workspace-write"),
  gitBranch: z.string().max(255).nullable().optional(),
});

export const ProjectDeleteResponseSchema = z.object({
  status: z.string().min(1),
});

export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;
export type ProjectsResponse = z.infer<typeof ProjectsResponseSchema>;
export type ProjectCreateRequest = z.input<typeof ProjectCreateRequestSchema>;
export type ProjectUpdateRequest = z.input<typeof ProjectUpdateRequestSchema>;
export type ProjectDeleteResponse = z.infer<typeof ProjectDeleteResponseSchema>;
export type ProjectSandboxMode = z.infer<typeof ProjectSandboxModeSchema>;
