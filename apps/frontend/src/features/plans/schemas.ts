import { z } from "zod";

export const PlanRoleProgressSchema = z.object({
  role: z.string().min(1),
  totalCheckpoints: z.number().int().min(0),
  doneCheckpoints: z.number().int().min(0),
});

export const PlanOverallProgressSchema = z.object({
  totalCheckpoints: z.number().int().min(0),
  doneCheckpoints: z.number().int().min(0),
  percentComplete: z.number().int().min(0).max(100),
});

export const PlanCheckpointSchema = z.object({
  timestamp: z.string().min(1),
  role: z.string().min(1),
  checkpointId: z.string().min(1),
  state: z.string().min(1),
  message: z.string(),
});

export const OpenSpecPlanSummarySchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  updatedAt: z.string().datetime({ offset: true }),
  roles: z.array(PlanRoleProgressSchema).default([]),
  overallProgress: PlanOverallProgressSchema,
  currentCheckpoint: PlanCheckpointSchema.nullable(),
});

export const OpenSpecPlansResponseSchema = z.object({
  entries: z.array(OpenSpecPlanSummarySchema).default([]),
});

export const OpenSpecPlanRoleDetailSchema = z.object({
  role: z.string().min(1),
  totalCheckpoints: z.number().int().min(0),
  doneCheckpoints: z.number().int().min(0),
  tasksMarkdown: z.string(),
  checkpointsMarkdown: z.string().nullable(),
});

export const OpenSpecPlanDetailSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  updatedAt: z.string().datetime({ offset: true }),
  summaryMarkdown: z.string(),
  checkpointsMarkdown: z.string(),
  roles: z.array(OpenSpecPlanRoleDetailSchema).default([]),
  overallProgress: PlanOverallProgressSchema,
  currentCheckpoint: PlanCheckpointSchema.nullable(),
});

export const PlanRuntimeAgentSchema = z.object({
  name: z.string().min(1),
  role: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string().nullable(),
  startedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  source: z.string().min(1),
  authoritative: z.boolean(),
});

export const PlanRuntimeEventSchema = z.object({
  ts: z.string().min(1),
  kind: z.string().min(1),
  message: z.string(),
  agentName: z.string().nullable(),
  role: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string().nullable(),
  source: z.string().min(1),
  authoritative: z.boolean(),
});

export const PlanRuntimeErrorSchema = z.object({
  timestamp: z.string().min(1),
  code: z.string().nullable(),
  message: z.string(),
  source: z.string().nullable(),
  recoverable: z.boolean().nullable(),
});

export const OpenSpecPlanRuntimeSchema = z.object({
  available: z.boolean(),
  sessionId: z.string().nullable(),
  correlationConfidence: z.string().nullable(),
  mode: z.string().nullable(),
  phase: z.string().nullable(),
  active: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }).nullable(),
  agents: z.array(PlanRuntimeAgentSchema).default([]),
  events: z.array(PlanRuntimeEventSchema).default([]),
  lastCheckpoint: PlanCheckpointSchema.nullable(),
  lastError: PlanRuntimeErrorSchema.nullable(),
  canResume: z.boolean(),
  partial: z.boolean(),
  staleAfterSeconds: z.number().int().positive().nullable(),
  reasons: z.array(z.string()).default([]),
  unavailableReason: z.string().nullable(),
});

export type OpenSpecPlanSummary = z.infer<typeof OpenSpecPlanSummarySchema>;
export type OpenSpecPlansResponse = z.infer<typeof OpenSpecPlansResponseSchema>;
export type OpenSpecPlanDetail = z.infer<typeof OpenSpecPlanDetailSchema>;
export type OpenSpecPlanRuntime = z.infer<typeof OpenSpecPlanRuntimeSchema>;
