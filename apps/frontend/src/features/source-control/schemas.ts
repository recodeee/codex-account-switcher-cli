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

export const SourceControlCommitActivityEntrySchema = z.object({
  hash: z.string().min(1),
  subject: z.string().min(1),
  authoredAt: z.string().datetime({ offset: true }),
  url: z.string().url().nullable().optional(),
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
  source: z.enum(["agent", "snapshot"]).default("agent"),
  snapshotName: z.string().nullable().optional(),
  sessionCount: z.number().int().min(0).default(0),
});

export const SourceControlPullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  state: z.enum(["open", "merged", "closed"]).default("open"),
  headBranch: z.string().min(1),
  baseBranch: z.string().min(1),
  url: z.string().url().nullable().optional(),
  author: z.string().nullable().optional(),
  isDraft: z.boolean().default(false),
});

export const SourceControlFailedCheckSchema = z.object({
  name: z.string().min(1),
  workflowName: z.string().nullable().optional(),
  conclusion: z.string().min(1).default("unknown"),
  detailsUrl: z.string().url().nullable().optional(),
});

export const SourceControlReviewFeedbackEntrySchema = z.object({
  source: z.enum(["issue_comment", "review", "review_comment"]).default("review"),
  content: z.string().min(1),
  state: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  filePath: z.string().nullable().optional(),
  submittedAt: z.string().datetime({ offset: true }).nullable().optional(),
  url: z.string().url().nullable().optional(),
});

export const SourceControlPullRequestDiagnosticsSchema = z.object({
  pullRequest: SourceControlPullRequestSchema,
  mergeable: z.string().nullable().optional(),
  mergeStateStatus: z.string().nullable().optional(),
  hasMergeConflicts: z.boolean().default(false),
  failedChecks: z.array(SourceControlFailedCheckSchema).default([]),
  feedback: z.array(SourceControlReviewFeedbackEntrySchema).default([]),
});

export const SourceControlReviewContentSchema = z.object({
  kind: z.enum(["review", "comment", "decision"]),
  content: z.string().min(1),
  state: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  submittedAt: z.string().datetime({ offset: true }).nullable().optional(),
  url: z.string().url().nullable().optional(),
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
  pullRequests: z.array(SourceControlPullRequestSchema).default([]),
  conflictedPullRequests: z.array(SourceControlPullRequestDiagnosticsSchema).default([]),
  botFeedbackPullRequests: z.array(SourceControlPullRequestDiagnosticsSchema).default([]),
  quickActions: z.array(z.string()).default([]),
});

export const SourceControlCommitActivityResponseSchema = z.object({
  repositoryRoot: z.string().min(1),
  projectPath: z.string().nullable().optional(),
  commits: z.array(SourceControlCommitActivityEntrySchema).default([]),
});

export const SourceControlBranchDetailsResponseSchema = z.object({
  repositoryRoot: z.string().min(1),
  projectPath: z.string().nullable().optional(),
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  mergeState: SourceControlMergeStateSchema,
  ahead: z.number().int().min(0).default(0),
  behind: z.number().int().min(0).default(0),
  changedFiles: z.array(SourceControlChangedFileSchema).default([]),
  linkedBots: z.array(z.string()).default([]),
  pullRequest: SourceControlPullRequestSchema.nullable().optional(),
  reviewContent: SourceControlReviewContentSchema.nullable().optional(),
});

export const SourceControlCreatePullRequestResponseSchema = z.object({
  status: z.literal("created"),
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  pullRequest: SourceControlPullRequestSchema.nullable().optional(),
  message: z.string().min(1),
});

export const SourceControlMergePullRequestResponseSchema = z.object({
  status: z.literal("merged"),
  branch: z.string().min(1),
  pullRequestNumber: z.number().int().positive().nullable().optional(),
  message: z.string().min(1),
});

export const SourceControlDeleteBranchResponseSchema = z.object({
  status: z.literal("deleted"),
  branch: z.string().min(1),
  message: z.string().min(1),
});

export type SourceControlPreviewResponse = z.infer<typeof SourceControlPreviewResponseSchema>;
export type SourceControlCommitActivityResponse = z.infer<typeof SourceControlCommitActivityResponseSchema>;
export type SourceControlCommitActivityEntry = z.infer<typeof SourceControlCommitActivityEntrySchema>;
export type SourceControlMergeState = z.infer<typeof SourceControlMergeStateSchema>;
export type SourceControlBranchDetailsResponse = z.infer<typeof SourceControlBranchDetailsResponseSchema>;
