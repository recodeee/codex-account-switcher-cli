import { z } from "zod";

export const SourceControlMergeStateSchema = z.enum([
  "merged",
  "ready",
  "diverged",
  "behind",
  "unknown",
]);

export const SourceControlChangedFileSchema = z.object({
  path: z.string().min(1),
  code: z.string().min(1),
  staged: z.boolean().default(false),
  unstaged: z.boolean().default(false),
});

export const SourceControlCommitPreviewSchema = z.object({
  hash: z.string().nullable().optional(),
  subject: z.string().min(1),
  body: z.string().nullable().optional(),
  authorName: z.string().nullable().optional(),
  authoredAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const SourceControlBranchPreviewSchema = z.object({
  name: z.string().min(1),
  isActive: z.boolean().default(false),
  ahead: z.number().int().min(0).default(0),
  behind: z.number().int().min(0).default(0),
  mergedIntoBase: z.boolean().nullable().optional(),
  mergeState: SourceControlMergeStateSchema,
});

export const SourceControlMergePreviewEntrySchema = z.object({
  branch: z.string().min(1),
  mergeState: SourceControlMergeStateSchema,
  ahead: z.number().int().min(0).default(0),
  behind: z.number().int().min(0).default(0),
});

export const SourceControlWorktreeEntrySchema = z.object({
  path: z.string().min(1),
  branch: z.string().nullable().optional(),
  isCurrent: z.boolean().default(false),
});

export const SourceControlBotSyncEntrySchema = z.object({
  botName: z.string().min(1),
  botStatus: z.enum(["idle", "active"]),
  runtime: z.string().min(1),
  matchedBranch: z.string().nullable().optional(),
  inSync: z.boolean().default(false),
  branchCandidates: z.array(z.string()).default([]),
});

export const SourceControlPreviewResponseSchema = z.object({
  repositoryRoot: z.string().min(1),
  projectPath: z.string().nullable().optional(),
  activeBranch: z.string().min(1),
  baseBranch: z.string().min(1),
  dirty: z.boolean(),
  refreshedAt: z.string().datetime({ offset: true }),
  changedFiles: z.array(SourceControlChangedFileSchema).default([]),
  commitPreview: SourceControlCommitPreviewSchema,
  branches: z.array(SourceControlBranchPreviewSchema).default([]),
  mergePreview: z.array(SourceControlMergePreviewEntrySchema).default([]),
  worktrees: z.array(SourceControlWorktreeEntrySchema).default([]),
  gxBots: z.array(SourceControlBotSyncEntrySchema).default([]),
  quickActions: z.array(z.string()).default([]),
});

export type SourceControlPreviewResponse = z.infer<typeof SourceControlPreviewResponseSchema>;
export type SourceControlMergeState = z.infer<typeof SourceControlMergeStateSchema>;

