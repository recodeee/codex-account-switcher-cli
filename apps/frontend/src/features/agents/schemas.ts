import { z } from "zod";

export const AgentStatusSchema = z.enum(["idle", "active"]);
export const AgentVisibilitySchema = z.enum(["workspace", "private"]);

export const AgentEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: AgentStatusSchema,
  description: z.string().nullable().optional(),
  visibility: AgentVisibilitySchema,
  runtime: z.string().min(1),
  instructions: z.string(),
  maxConcurrentTasks: z.number().int().min(1).max(50),
  avatarDataUrl: z.string().nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const AgentsResponseSchema = z.object({
  entries: z.array(AgentEntrySchema).default([]),
});

export const AgentCreateRequestSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).nullable().optional(),
  visibility: AgentVisibilitySchema.optional(),
  runtime: z.string().max(255).optional(),
  instructions: z.string().max(50_000).optional(),
  maxConcurrentTasks: z.number().int().min(1).max(50).optional(),
  avatarDataUrl: z.string().nullable().optional(),
});

export const AgentUpdateRequestSchema = z.object({
  name: z.string().min(1).max(128),
  status: AgentStatusSchema.optional(),
  description: z.string().max(512).nullable().optional(),
  visibility: AgentVisibilitySchema.optional(),
  runtime: z.string().max(255).optional(),
  instructions: z.string().max(50_000).optional(),
  maxConcurrentTasks: z.number().int().min(1).max(50).optional(),
  avatarDataUrl: z.string().nullable().optional(),
});

export type AgentEntry = z.infer<typeof AgentEntrySchema>;
export type AgentsResponse = z.infer<typeof AgentsResponseSchema>;
export type AgentCreateRequest = z.input<typeof AgentCreateRequestSchema>;
export type AgentUpdateRequest = z.input<typeof AgentUpdateRequestSchema>;
