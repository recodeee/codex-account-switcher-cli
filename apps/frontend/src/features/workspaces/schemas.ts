import { z } from "zod";

export const WorkspaceEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  label: z.string().min(1),
  isActive: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const WorkspacesResponseSchema = z.object({
  entries: z.array(WorkspaceEntrySchema).default([]),
});

export const WorkspaceCreateRequestSchema = z.object({
  name: z.string().min(1).max(128),
  label: z.string().max(64).optional(),
});

export const WorkspaceSelectionResponseSchema = z.object({
  activeWorkspaceId: z.string().min(1),
});

export type WorkspaceEntry = z.infer<typeof WorkspaceEntrySchema>;
export type WorkspacesResponse = z.infer<typeof WorkspacesResponseSchema>;
export type WorkspaceCreateRequest = z.input<typeof WorkspaceCreateRequestSchema>;
export type WorkspaceSelectionResponse = z.infer<typeof WorkspaceSelectionResponseSchema>;

