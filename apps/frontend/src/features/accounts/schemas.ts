import { z } from "zod";

export const UsageTrendPointSchema = z.object({
  t: z.string().datetime({ offset: true }),
  v: z.number(),
});

export const AccountUsageTrendSchema = z.object({
  primary: z.array(UsageTrendPointSchema),
  secondary: z.array(UsageTrendPointSchema),
});

export const AccountUsageSchema = z.object({
  primaryRemainingPercent: z.number().nullable(),
  secondaryRemainingPercent: z.number().nullable(),
});

export const AccountRequestUsageSchema = z.object({
  requestCount: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative().optional(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  totalCostUsd: z.number().nonnegative(),
});

export const AccountTokenStatusSchema = z.object({
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  state: z.string().nullable().optional(),
});

export const AccountAuthSchema = z.object({
  access: AccountTokenStatusSchema.nullable().optional(),
  refresh: AccountTokenStatusSchema.nullable().optional(),
  idToken: AccountTokenStatusSchema.nullable().optional(),
});

export const AccountCodexAuthSchema = z.object({
  hasSnapshot: z.boolean(),
  snapshotName: z.string().nullable().optional(),
  activeSnapshotName: z.string().nullable().optional(),
  isActiveSnapshot: z.boolean().optional(),
  hasLiveSession: z.boolean().optional(),
  liveUsageConfidence: z.enum(["high", "low"]).nullable().optional(),
  expectedSnapshotName: z.string().nullable().optional(),
  snapshotNameMatchesEmail: z.boolean().optional(),
  runtimeReady: z.boolean().optional(),
  runtimeReadySource: z.enum(["validated_snapshot_email_match"]).nullable().optional(),
  isOmxBoosted: z.boolean().optional(),
});

export const AccountAdditionalWindowSchema = z.object({
  usedPercent: z.number(),
  resetAt: z.number().nullable().optional(),
  windowMinutes: z.number().nullable().optional(),
});

export const AccountAdditionalQuotaSchema = z.object({
  quotaKey: z.string().nullable().optional(),
  limitName: z.string(),
  meteredFeature: z.string(),
  displayLabel: z.string().nullable().optional(),
  primaryWindow: AccountAdditionalWindowSchema.nullable().optional(),
  secondaryWindow: AccountAdditionalWindowSchema.nullable().optional(),
});

export const AccountLiveQuotaDebugWindowSchema = z.object({
  usedPercent: z.number(),
  remainingPercent: z.number(),
  resetAt: z.number().nullable().optional(),
  windowMinutes: z.number().nullable().optional(),
});

export const AccountLiveQuotaDebugSampleSchema = z.object({
  source: z.string(),
  snapshotName: z.string().nullable().optional(),
  recordedAt: z.string().datetime({ offset: true }),
  stale: z.boolean().optional(),
  primary: AccountLiveQuotaDebugWindowSchema.nullable().optional(),
  secondary: AccountLiveQuotaDebugWindowSchema.nullable().optional(),
});

export const AccountLiveQuotaDebugSchema = z.object({
  snapshotsConsidered: z.array(z.string()).default([]),
  rawSamples: z.array(AccountLiveQuotaDebugSampleSchema).default([]),
  merged: AccountLiveQuotaDebugSampleSchema.nullable().optional(),
  overrideApplied: z.boolean().optional(),
  overrideReason: z.string().nullable().optional(),
});

export const AccountSessionTaskPreviewSchema = z.object({
  sessionKey: z.string(),
  taskPreview: z.string().nullable().optional().default(null),
  taskUpdatedAt: z.string().datetime({ offset: true }).nullable().optional().default(null),
});

export const AccountSummarySchema = z.object({
  accountId: z.string(),
  email: z.string(),
  displayName: z.string(),
  planType: z.string(),
  status: z.string(),
  deactivationReason: z.string().nullable().optional(),
  usage: AccountUsageSchema.nullable().optional(),
  resetAtPrimary: z.string().datetime({ offset: true }).nullable().optional(),
  resetAtSecondary: z.string().datetime({ offset: true }).nullable().optional(),
  lastUsageRecordedAtPrimary: z.string().datetime({ offset: true }).nullable().optional(),
  lastUsageRecordedAtSecondary: z.string().datetime({ offset: true }).nullable().optional(),
  windowMinutesPrimary: z.number().nullable().optional(),
  windowMinutesSecondary: z.number().nullable().optional(),
  requestUsage: AccountRequestUsageSchema.nullable().optional(),
  codexLiveSessionCount: z.number().int().nonnegative().optional(),
  codexTrackedSessionCount: z.number().int().nonnegative().optional(),
  codexSessionCount: z.number().int().nonnegative().optional(),
  codexCurrentTaskPreview: z.string().nullable().optional(),
  codexLastTaskPreview: z.string().nullable().optional(),
  codexSessionTaskPreviews: z.array(AccountSessionTaskPreviewSchema).optional(),
  liveQuotaDebug: AccountLiveQuotaDebugSchema.nullable().optional(),
  auth: AccountAuthSchema.nullable().optional(),
  codexAuth: AccountCodexAuthSchema.nullable().optional(),
  additionalQuotas: z.array(AccountAdditionalQuotaSchema).default([]),
});

export const AccountTrendsResponseSchema = z.object({
  accountId: z.string(),
  primary: z.array(UsageTrendPointSchema),
  secondary: z.array(UsageTrendPointSchema),
});

export const AccountsResponseSchema = z.object({
  accounts: z.array(AccountSummarySchema),
});

export const AccountImportResponseSchema = z.object({
  accountId: z.string(),
  email: z.string(),
  planType: z.string(),
  status: z.string(),
});

export const AccountActionResponseSchema = z.object({
  status: z.string(),
});

export const AccountUseLocalResponseSchema = z.object({
  status: z.string(),
  accountId: z.string(),
  snapshotName: z.string(),
});

export const AccountRefreshAuthResponseSchema = z.object({
  status: z.string(),
  accountId: z.string(),
  email: z.string(),
  planType: z.string(),
});

export const AccountOpenTerminalResponseSchema = z.object({
  status: z.string(),
  accountId: z.string(),
  snapshotName: z.string(),
});

export const AccountTerminateCliSessionsResponseSchema = z.object({
  status: z.string(),
  accountId: z.string(),
  snapshotName: z.string(),
  terminatedSessionCount: z.number().int().nonnegative(),
});

export const AccountSnapshotRepairResponseSchema = z.object({
  status: z.string(),
  accountId: z.string(),
  previousSnapshotName: z.string(),
  snapshotName: z.string(),
  mode: z.enum(["readd", "rename"]),
  changed: z.boolean(),
});

export const OauthStartRequestSchema = z.object({
  forceMethod: z.string().optional(),
});

export const OauthStartResponseSchema = z.object({
  method: z.string(),
  authorizationUrl: z.string().nullable(),
  callbackUrl: z.string().nullable(),
  verificationUrl: z.string().nullable(),
  userCode: z.string().nullable(),
  deviceAuthId: z.string().nullable(),
  intervalSeconds: z.number().nullable(),
  expiresInSeconds: z.number().nullable(),
});

export const OauthStatusResponseSchema = z.object({
  status: z.string(),
  errorMessage: z.string().nullable(),
});

export const OauthCompleteRequestSchema = z.object({
  deviceAuthId: z.string().optional(),
  userCode: z.string().optional(),
});

export const OauthCompleteResponseSchema = z.object({
  status: z.string(),
});

export const ManualOauthCallbackRequestSchema = z.object({
  callbackUrl: z.string(),
});

export const ManualOauthCallbackResponseSchema = z.object({
  status: z.string(),
  errorMessage: z.string().nullable(),
});

export const RuntimeConnectAddressResponseSchema = z.object({
  connectAddress: z.string(),
});

export const OAuthStateSchema = z.object({
  status: z.enum(["idle", "starting", "pending", "success", "error"]),
  method: z.enum(["browser", "device"]).nullable(),
  authorizationUrl: z.string().nullable(),
  callbackUrl: z.string().nullable(),
  verificationUrl: z.string().nullable(),
  userCode: z.string().nullable(),
  deviceAuthId: z.string().nullable(),
  intervalSeconds: z.number().nullable(),
  expiresInSeconds: z.number().nullable(),
  errorMessage: z.string().nullable(),
});

export const ImportStateSchema = z.object({
  status: z.enum(["idle", "uploading", "success", "error"]),
  message: z.string().nullable(),
});

export type UsageTrendPoint = z.infer<typeof UsageTrendPointSchema>;
export type AccountUsageTrend = z.infer<typeof AccountUsageTrendSchema>;
export type AccountSummary = z.infer<typeof AccountSummarySchema>;
export type AccountAdditionalWindow = z.infer<typeof AccountAdditionalWindowSchema>;
export type AccountAdditionalQuota = z.infer<typeof AccountAdditionalQuotaSchema>;
export type AccountLiveQuotaDebug = z.infer<typeof AccountLiveQuotaDebugSchema>;
export type AccountLiveQuotaDebugSample = z.infer<typeof AccountLiveQuotaDebugSampleSchema>;
export type AccountLiveQuotaDebugWindow = z.infer<typeof AccountLiveQuotaDebugWindowSchema>;
export type AccountTrendsResponse = z.infer<typeof AccountTrendsResponseSchema>;
export type AccountUseLocalResponse = z.infer<typeof AccountUseLocalResponseSchema>;
export type AccountRefreshAuthResponse = z.infer<typeof AccountRefreshAuthResponseSchema>;
export type AccountOpenTerminalResponse = z.infer<typeof AccountOpenTerminalResponseSchema>;
export type AccountTerminateCliSessionsResponse = z.infer<
  typeof AccountTerminateCliSessionsResponseSchema
>;
export type AccountSnapshotRepairResponse = z.infer<typeof AccountSnapshotRepairResponseSchema>;
export type OauthStartResponse = z.infer<typeof OauthStartResponseSchema>;
export type OauthStatusResponse = z.infer<typeof OauthStatusResponseSchema>;
export type ManualOauthCallbackResponse = z.infer<typeof ManualOauthCallbackResponseSchema>;
export type RuntimeConnectAddressResponse = z.infer<
  typeof RuntimeConnectAddressResponseSchema
>;
export type OAuthState = z.infer<typeof OAuthStateSchema>;
export type ImportState = z.infer<typeof ImportStateSchema>;
