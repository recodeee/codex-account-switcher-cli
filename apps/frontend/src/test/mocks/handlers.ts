import { HttpResponse, http } from "msw";
import { z } from "zod";

import { LIMIT_TYPES, LIMIT_WINDOWS } from "@/features/api-keys/schemas";
import {
	BillingAccountCreateRequestSchema,
	BillingAccountSchema,
} from "@/features/billing/schemas";
import {
	type AccountSummary,
	type ApiKey,
	createAccountSummary,
	createAccountTrends,
	createApiKey,
	createApiKeyCreateResponse,
	createApiKeyTrends,
	createApiKeyUsage7Day,
	createDashboardAuthSession,
	createDashboardOverview,
	createDashboardSettings,
	createDefaultAccounts,
	createDefaultApiKeys,
	createDefaultRequestLogs,
	createOauthCompleteResponse,
	createOauthStartResponse,
	createOauthStatusResponse,
	createRequestLogFilterOptions,
	createRequestLogUsageSummary,
	createRequestLogsResponse,
	type DashboardAuthSession,
	type DashboardSettings,
	type RequestLogEntry,
} from "@/test/mocks/factories";

const MODEL_OPTION_DELIMITER = ":::";
const STATUS_ORDER = ["ok", "rate_limit", "quota", "error"] as const;
const PROJECT_SANDBOX_MODES = new Set([
	"read-only",
	"workspace-write",
	"danger-full-access",
]);
const WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const GIT_BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

// ── Zod schemas for mock request bodies ──

const OauthStartPayloadSchema = z
	.object({
		forceMethod: z.string().optional(),
	})
	.passthrough();

const ApiKeyCreatePayloadSchema = z
	.object({
		name: z.string().optional(),
	})
	.passthrough();

const FirewallIpCreatePayloadSchema = z
	.object({
		ipAddress: z.string().optional(),
	})
	.passthrough();

const DeviceCreatePayloadSchema = z
	.object({
		name: z.string().optional(),
		ipAddress: z.string().optional(),
	})
	.passthrough();

const DeviceUpdatePayloadSchema = z
	.object({
		name: z.string().optional(),
		ipAddress: z.string().optional(),
	})
	.passthrough();

const ProjectCreatePayloadSchema = z
	.object({
		name: z.string().optional(),
		description: z.string().nullable().optional(),
		projectPath: z.string().nullable().optional(),
		sandboxMode: z.string().optional(),
		gitBranch: z.string().nullable().optional(),
	})
	.passthrough();

const ProjectUpdatePayloadSchema = z
	.object({
		name: z.string().optional(),
		description: z.string().nullable().optional(),
		projectPath: z.string().nullable().optional(),
		sandboxMode: z.string().optional(),
		gitBranch: z.string().nullable().optional(),
	})
	.passthrough();

const ApiKeyUpdatePayloadSchema = z
	.object({
		name: z.string().optional(),
		allowedModels: z.array(z.string()).nullable().optional(),
		isActive: z.boolean().optional(),
		resetUsage: z.boolean().optional(),
		limits: z
			.array(
				z.object({
					limitType: z.enum(LIMIT_TYPES),
					limitWindow: z.enum(LIMIT_WINDOWS),
					maxValue: z.number(),
					modelFilter: z.string().nullable().optional(),
				}),
			)
			.optional(),
	})
	.passthrough();

const SettingsPayloadSchema = z
	.object({
		stickyThreadsEnabled: z.boolean().optional(),
		upstreamStreamTransport: z
			.enum(["default", "auto", "http", "websocket"])
			.optional(),
		preferEarlierResetAccounts: z.boolean().optional(),
		routingStrategy: z.enum(["usage_weighted", "round_robin", "capacity_weighted"]).optional(),
		openaiCacheAffinityMaxAgeSeconds: z.number().int().positive().optional(),
		stickyReallocationBudgetThresholdPct: z.number().min(0).max(100).optional(),
		importWithoutOverwrite: z.boolean().optional(),
		totpRequiredOnLogin: z.boolean().optional(),
		totpConfigured: z.boolean().optional(),
		apiKeyAuthEnabled: z.boolean().optional(),
	})
	.passthrough();

const BillingPayloadSchema = z
	.object({
		accounts: z.array(BillingAccountSchema),
	})
	.passthrough();

const BillingAccountCreatePayloadSchema = BillingAccountCreateRequestSchema.passthrough();
const BillingAccountDeletePayloadSchema = z
	.object({
		id: z.string().min(1),
	})
	.passthrough();

const MedusaCredentialsPayloadSchema = z
	.object({
		email: z.string().email(),
		password: z.string().min(1),
	})
	.passthrough();

const MedusaCustomerCreatePayloadSchema = z
	.object({
		email: z.string().email(),
		first_name: z.string().optional(),
		last_name: z.string().optional(),
	})
	.passthrough();

// ── Helpers ──

async function parseJsonBody<T>(
	request: Request,
	schema: z.ZodType<T>,
): Promise<T | null> {
	try {
		const raw: unknown = await request.json();
		const result = schema.safeParse(raw);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

type MockState = {
	accounts: AccountSummary[];
	requestLogs: RequestLogEntry[];
	authSession: DashboardAuthSession;
	settings: DashboardSettings;
	apiKeys: ApiKey[];
	firewallEntries: Array<{ ipAddress: string; createdAt: string }>;
	devices: Array<{
		id: string;
		name: string;
		ipAddress: string;
		createdAt: string;
		updatedAt: string;
	}>;
	projects: Array<{
		id: string;
		name: string;
		description: string | null;
		projectPath: string | null;
		sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
		gitBranch: string | null;
		createdAt: string;
		updatedAt: string;
	}>;
	openSpecPlans: Array<{
		slug: string;
		title: string;
		status: string;
		updatedAt: string;
		roles: Array<{
			role: string;
			totalCheckpoints: number;
			doneCheckpoints: number;
			tasksMarkdown: string;
			checkpointsMarkdown: string | null;
		}>;
		overallProgress: {
			totalCheckpoints: number;
			doneCheckpoints: number;
			percentComplete: number;
		};
		currentCheckpoint: {
			timestamp: string;
			role: string;
			checkpointId: string;
			state: string;
			message: string;
		} | null;
		summaryMarkdown: string;
		checkpointsMarkdown: string;
		runtime: {
			available: boolean;
			sessionId: string | null;
			correlationConfidence: string | null;
			mode: string | null;
			phase: string | null;
			active: boolean;
			updatedAt: string | null;
			agents: Array<{
				name: string;
				role: string | null;
				model: string | null;
				status: string | null;
				startedAt: string | null;
				updatedAt: string | null;
				source: string;
				authoritative: boolean;
			}>;
			events: Array<{
				ts: string;
				kind: string;
				message: string;
				agentName: string | null;
				role: string | null;
				model: string | null;
				status: string | null;
				source: string;
				authoritative: boolean;
			}>;
			lastCheckpoint: {
				timestamp: string;
				role: string;
				checkpointId: string;
				state: string;
				message: string;
			} | null;
			lastError: {
				timestamp: string;
				code: string | null;
				message: string;
				source: string | null;
				recoverable: boolean | null;
			} | null;
			canResume: boolean;
			partial: boolean;
			staleAfterSeconds: number | null;
			reasons: string[];
			unavailableReason: string | null;
		};
	}>;
	billingAccounts: z.infer<typeof BillingAccountSchema>[];
	stickySessions: Array<{
		key: string;
		accountId: string;
		displayName: string;
		kind: "codex_session" | "sticky_thread" | "prompt_cache";
		createdAt: string;
		updatedAt: string;
		expiresAt: string | null;
		isStale: boolean;
	}>;
	medusaCustomer: {
		id: string;
		email: string;
		first_name: string | null;
		last_name: string | null;
		phone: string | null;
	};
};

function createInitialState(): MockState {
	return {
		accounts: createDefaultAccounts(),
		requestLogs: createDefaultRequestLogs(),
		authSession: createDashboardAuthSession(),
		settings: createDashboardSettings(),
		apiKeys: createDefaultApiKeys(),
		firewallEntries: [],
		devices: [],
		projects: [],
		openSpecPlans: createDefaultOpenSpecPlans(),
		billingAccounts: createDefaultBillingAccounts(),
		stickySessions: [],
		medusaCustomer: {
			id: "cus_test_1",
			email: "customer@example.com",
			first_name: "Test",
			last_name: "Customer",
			phone: null,
		},
	};
}

function createDefaultOpenSpecPlans(): MockState["openSpecPlans"] {
	return [
		{
			slug: "projects-plans-page",
			title: "projects-plans-page",
			status: "approved",
			updatedAt: new Date("2026-04-08T09:51:46Z").toISOString(),
			roles: [
				{
					role: "planner",
					totalCheckpoints: 1,
					doneCheckpoints: 1,
					tasksMarkdown: "# planner tasks\\n\\n- [x] [P1] DONE - Draft completed",
					checkpointsMarkdown: null,
				},
				{
					role: "architect",
					totalCheckpoints: 1,
					doneCheckpoints: 1,
					tasksMarkdown: "# architect tasks\\n\\n- [x] [A1] DONE - Architecture approved",
					checkpointsMarkdown: null,
				},
				{
					role: "critic",
					totalCheckpoints: 1,
					doneCheckpoints: 1,
					tasksMarkdown: "# critic tasks\\n\\n- [x] [C1] DONE - Critic approved",
					checkpointsMarkdown: null,
				},
				{
					role: "executor",
					totalCheckpoints: 1,
					doneCheckpoints: 0,
					tasksMarkdown: "# executor tasks\\n\\n- [ ] [E1] READY - Execution pending",
					checkpointsMarkdown: null,
				},
				{
					role: "writer",
					totalCheckpoints: 1,
					doneCheckpoints: 0,
					tasksMarkdown: "# writer tasks\\n\\n- [ ] [W1] READY - Docs pending",
					checkpointsMarkdown: null,
				},
				{
					role: "verifier",
					totalCheckpoints: 1,
					doneCheckpoints: 0,
					tasksMarkdown: "# verifier tasks\\n\\n- [ ] [V1] READY - Verification pending",
					checkpointsMarkdown: null,
				},
				{
					role: "designer",
					totalCheckpoints: 1,
					doneCheckpoints: 0,
					tasksMarkdown: "# designer tasks\\n\\n- [ ] [D1] READY - Design review pending",
					checkpointsMarkdown: null,
				},
			],
			overallProgress: {
				totalCheckpoints: 7,
				doneCheckpoints: 3,
				percentComplete: 43,
			},
			currentCheckpoint: {
				timestamp: "2026-04-08T09:52:21Z",
				role: "executor",
				checkpointId: "E1",
				state: "IN_PROGRESS",
				message: "Implementing plans progress UI",
			},
			summaryMarkdown:
				"# Plan Summary: projects-plans-page\\n\\n- **Mode:** ralplan\\n- **Status:** approved\\n- **Task:** Create a Projects -> Plans page (`/projects/plans`) with visualized OpenSpec plan data. ![Plans Header](https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=96&h=96&fit=crop) [Image #1]\\n",
			checkpointsMarkdown:
				"# Plan Checkpoints: projects-plans-page\\n\\n- 2026-04-08T09:52:21Z | role=executor | id=E1 | state=IN_PROGRESS | Implementing plans progress UI\\n",
			runtime: {
				available: true,
				sessionId: "019d6cae-f82e-7670-a403-b5fae5c6e85c",
				correlationConfidence: "high",
				mode: "ralplan",
				phase: "planning",
				active: true,
				updatedAt: new Date("2026-04-08T09:53:00Z").toISOString(),
				agents: [
					{
						name: "executor",
						role: "executor",
						model: "gpt-5.3-codex",
						status: "running",
						startedAt: "2026-04-08T09:52:10Z",
						updatedAt: "2026-04-08T09:53:00Z",
						source: "ralplan-runtime",
						authoritative: true,
					},
				],
				events: [
					{
						ts: "2026-04-08T09:52:10Z",
						kind: "agent_spawned",
						message: "Executor spawned",
						agentName: "executor",
						role: "executor",
						model: "gpt-5.3-codex",
						status: "running",
						source: "ralplan-runtime",
						authoritative: true,
					},
					{
						ts: "2026-04-08T09:53:00Z",
						kind: "session_start",
						message: "Session started",
						agentName: null,
						role: null,
						model: null,
						status: "active",
						source: "omx-2026-04-08.jsonl",
						authoritative: false,
					},
				],
				lastCheckpoint: {
					timestamp: "2026-04-08T09:52:21Z",
					role: "executor",
					checkpointId: "E1",
					state: "IN_PROGRESS",
					message: "Implementing plans progress UI",
				},
				lastError: null,
				canResume: true,
				partial: false,
				staleAfterSeconds: 5,
				reasons: ["plan_session_mapping"],
				unavailableReason: null,
			},
		},
		{
			slug: "ralplan-openspec-plan-export",
			title: "ralplan-openspec-plan-export",
			status: "proposed",
			updatedAt: new Date("2026-04-08T09:46:52Z").toISOString(),
			roles: [
				{
					role: "planner",
					totalCheckpoints: 1,
					doneCheckpoints: 0,
					tasksMarkdown: "# planner tasks\\n\\n- [ ] [P1] READY - Draft pending",
					checkpointsMarkdown: null,
				},
				{
					role: "architect",
					totalCheckpoints: 1,
					doneCheckpoints: 0,
					tasksMarkdown: "# architect tasks\\n\\n- [ ] [A1] READY - Review pending",
					checkpointsMarkdown: null,
				},
				{
					role: "critic",
					totalCheckpoints: 1,
					doneCheckpoints: 0,
					tasksMarkdown: "# critic tasks\\n\\n- [ ] [C1] READY - Critic pending",
					checkpointsMarkdown: null,
				},
				{
					role: "executor",
					totalCheckpoints: 1,
					doneCheckpoints: 0,
					tasksMarkdown: "# executor tasks\\n\\n- [ ] [E1] READY - Execution pending",
					checkpointsMarkdown: null,
				},
				{
					role: "writer",
					totalCheckpoints: 1,
					doneCheckpoints: 0,
					tasksMarkdown: "# writer tasks\\n\\n- [ ] [W1] READY - Docs pending",
					checkpointsMarkdown: null,
				},
				{
					role: "verifier",
					totalCheckpoints: 1,
					doneCheckpoints: 0,
					tasksMarkdown: "# verifier tasks\\n\\n- [ ] [V1] READY - Verification pending",
					checkpointsMarkdown: null,
				},
				{
					role: "designer",
					totalCheckpoints: 1,
					doneCheckpoints: 0,
					tasksMarkdown: "# designer tasks\\n\\n- [ ] [D1] READY - Design pending",
					checkpointsMarkdown: null,
				},
			],
			overallProgress: {
				totalCheckpoints: 7,
				doneCheckpoints: 0,
				percentComplete: 0,
			},
			currentCheckpoint: null,
			summaryMarkdown:
				"# Plan Summary: ralplan-openspec-plan-export\\n\\n- **Mode:** ralplan\\n- **Status:** proposed\\n",
			checkpointsMarkdown:
				"# Plan Checkpoints: ralplan-openspec-plan-export\\n\\nNo checkpoints recorded yet.\\n",
			runtime: {
				available: false,
				sessionId: null,
				correlationConfidence: null,
				mode: null,
				phase: null,
				active: false,
				updatedAt: null,
				agents: [],
				events: [],
				lastCheckpoint: null,
				lastError: null,
				canResume: false,
				partial: false,
				staleAfterSeconds: 30,
				reasons: ["correlation_unresolved"],
				unavailableReason: "correlation_unresolved",
			},
		},
	];
}

function createDefaultBillingAccounts(): z.infer<typeof BillingAccountSchema>[] {
	return [
		{
			id: "business-plan-edixai",
			domain: "edixai.com",
			planCode: "business",
			planName: "Business",
			subscriptionStatus: "active",
			entitled: true,
			paymentStatus: "paid",
			billingCycle: {
				start: new Date("2026-03-23T00:00:00.000Z"),
				end: new Date("2026-04-23T00:00:00.000Z"),
			},
			renewalAt: new Date("2026-04-23T00:00:00.000Z"),
			chatgptSeatsInUse: 5,
			codexSeatsInUse: 5,
			members: [
				{
					id: "member-bianka-belovics",
					name: "Bianka Belovics",
					email: "bia@edixai.com",
					role: "Member",
					seatType: "ChatGPT",
					dateAdded: "Mar 30, 2026",
				},
				{
					id: "member-csoves",
					name: "Csoves",
					email: "csoves@edixai.com",
					role: "Member",
					seatType: "Codex",
					dateAdded: "Mar 23, 2026",
				},
			],
		},
		{
			id: "business-plan-kozpont",
			domain: "kozpontihusbolt.hu",
			planCode: "business",
			planName: "Business",
			subscriptionStatus: "past_due",
			entitled: false,
			paymentStatus: "past_due",
			billingCycle: {
				start: new Date("2026-03-26T00:00:00.000Z"),
				end: new Date("2026-04-26T00:00:00.000Z"),
			},
			renewalAt: new Date("2026-04-26T00:00:00.000Z"),
			chatgptSeatsInUse: 5,
			codexSeatsInUse: 5,
			members: [
				{
					id: "member-kozpont-admin",
					name: "Kozpont Admin",
					email: "admin@kozpontihusbolt.hu",
					role: "Owner",
					seatType: "ChatGPT",
					dateAdded: "Mar 23, 2026",
				},
				{
					id: "member-kozpont-codex-1",
					name: "Automation 1",
					email: "codex1@kozpontihusbolt.hu",
					role: "Member",
					seatType: "Codex",
					dateAdded: "Mar 26, 2026",
				},
				{
					id: "member-kozpont-codex-2",
					name: "Automation 2",
					email: "codex2@kozpontihusbolt.hu",
					role: "Member",
					seatType: "Codex",
					dateAdded: "Mar 27, 2026",
				},
			],
		},
		{
			id: "business-plan-kronakert",
			domain: "kronakert.hu",
			planCode: "trial",
			planName: "Trial",
			subscriptionStatus: "trialing",
			entitled: true,
			paymentStatus: "paid",
			billingCycle: {
				start: new Date("2026-04-01T00:00:00.000Z"),
				end: new Date("2026-05-01T00:00:00.000Z"),
			},
			renewalAt: new Date("2026-05-01T00:00:00.000Z"),
			chatgptSeatsInUse: 3,
			codexSeatsInUse: 3,
			members: [
				{
					id: "member-kronakert-owner",
					name: "Kronakert Owner",
					email: "owner@kronakert.hu",
					role: "Owner",
					seatType: "ChatGPT",
					dateAdded: "Apr 1, 2026",
				},
			],
		},
	];
}

let state: MockState = createInitialState();

export function resetMockState(): void {
	state = createInitialState();
}

function parseDateValue(value: string | null): number | null {
	if (!value) {
		return null;
	}
	const timestamp = new Date(value).getTime();
	return Number.isNaN(timestamp) ? null : timestamp;
}

function normalizeProjectPath(
	value: unknown,
): { ok: true; value: string | null } | { ok: false; code: "invalid_project_path"; message: string } {
	if (value == null) {
		return { ok: true, value: null };
	}
	const normalized = String(value).trim();
	if (!normalized) {
		return { ok: true, value: null };
	}
	if (normalized.length > 1024) {
		return {
			ok: false,
			code: "invalid_project_path",
			message: "Project path must be 1024 characters or fewer",
		};
	}
	const isAbsolute =
		normalized.startsWith("/") ||
		normalized.startsWith("\\\\") ||
		WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN.test(normalized);
	if (!isAbsolute) {
		return {
			ok: false,
			code: "invalid_project_path",
			message: "Project path must be absolute",
		};
	}
	return { ok: true, value: normalized };
}

function normalizeProjectSandboxMode(
	value: unknown,
): { ok: true; value: "read-only" | "workspace-write" | "danger-full-access" } | {
	ok: false;
	code: "invalid_project_sandbox";
	message: string;
} {
	if (value == null) {
		return { ok: true, value: "workspace-write" };
	}
	const normalized = String(value).trim().toLowerCase();
	if (!normalized) {
		return { ok: true, value: "workspace-write" };
	}
	if (!PROJECT_SANDBOX_MODES.has(normalized)) {
		return {
			ok: false,
			code: "invalid_project_sandbox",
			message: "Sandbox mode must be one of: read-only, workspace-write, danger-full-access",
		};
	}
	return {
		ok: true,
		value: normalized as "read-only" | "workspace-write" | "danger-full-access",
	};
}

function normalizeProjectGitBranch(
	value: unknown,
): { ok: true; value: string | null } | { ok: false; code: "invalid_project_branch"; message: string } {
	if (value == null) {
		return { ok: true, value: null };
	}
	const normalized = String(value).trim();
	if (!normalized) {
		return { ok: true, value: null };
	}
	if (normalized.length > 255) {
		return {
			ok: false,
			code: "invalid_project_branch",
			message: "Git branch must be 255 characters or fewer",
		};
	}
	if (
		!GIT_BRANCH_PATTERN.test(normalized) ||
		normalized.startsWith("/") ||
		normalized.endsWith("/") ||
		normalized.includes("..") ||
		normalized.endsWith(".lock")
	) {
		return {
			ok: false,
			code: "invalid_project_branch",
			message: "Git branch contains invalid characters",
		};
	}
	return { ok: true, value: normalized };
}

function filterRequestLogs(
	url: URL,
	options?: { includeStatuses?: boolean },
): RequestLogEntry[] {
	const includeStatuses = options?.includeStatuses ?? true;
	const accountIds = new Set(url.searchParams.getAll("accountId"));
	const statuses = new Set(
		url.searchParams.getAll("status").map((value) => value.toLowerCase()),
	);
	const models = new Set(url.searchParams.getAll("model"));
	const reasoningEfforts = new Set(url.searchParams.getAll("reasoningEffort"));
	const modelOptions = new Set(url.searchParams.getAll("modelOption"));
	const search = (url.searchParams.get("search") || "").trim().toLowerCase();
	const since = parseDateValue(url.searchParams.get("since"));
	const until = parseDateValue(url.searchParams.get("until"));

	return state.requestLogs.filter((entry) => {
		if (
			accountIds.size > 0 &&
			(!entry.accountId || !accountIds.has(entry.accountId))
		) {
			return false;
		}

		if (
			includeStatuses &&
			statuses.size > 0 &&
			!statuses.has("all") &&
			!statuses.has(entry.status)
		) {
			return false;
		}

		if (models.size > 0 && !models.has(entry.model)) {
			return false;
		}

		if (reasoningEfforts.size > 0) {
			const effort = entry.reasoningEffort ?? "";
			if (!reasoningEfforts.has(effort)) {
				return false;
			}
		}

		if (modelOptions.size > 0) {
			const key = `${entry.model}${MODEL_OPTION_DELIMITER}${entry.reasoningEffort ?? ""}`;
			const matchNoEffort = modelOptions.has(entry.model);
			if (!modelOptions.has(key) && !matchNoEffort) {
				return false;
			}
		}

		const timestamp = new Date(entry.requestedAt).getTime();
		if (since !== null && timestamp < since) {
			return false;
		}
		if (until !== null && timestamp > until) {
			return false;
		}

		if (search.length > 0) {
			const haystack = [
				entry.accountId,
				entry.apiKeyName,
				entry.requestId,
				entry.model,
				entry.reasoningEffort,
				entry.errorCode,
				entry.errorMessage,
				entry.status,
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
			if (!haystack.includes(search)) {
				return false;
			}
		}

		return true;
	});
}

function requestLogOptionsFromEntries(entries: RequestLogEntry[]) {
	const accountIds = [
		...new Set(
			entries
				.map((entry) => entry.accountId)
				.filter((id): id is string => id != null),
		),
	].sort();

	const modelMap = new Map<
		string,
		{ model: string; reasoningEffort: string | null }
	>();
	for (const entry of entries) {
		const key = `${entry.model}${MODEL_OPTION_DELIMITER}${entry.reasoningEffort ?? ""}`;
		if (!modelMap.has(key)) {
			modelMap.set(key, {
				model: entry.model,
				reasoningEffort: entry.reasoningEffort ?? null,
			});
		}
	}
	const modelOptionsList = [...modelMap.values()].sort((a, b) => {
		if (a.model !== b.model) {
			return a.model.localeCompare(b.model);
		}
		return (a.reasoningEffort ?? "").localeCompare(b.reasoningEffort ?? "");
	});

	const presentStatuses = new Set(entries.map((entry) => entry.status));
	const statuses = STATUS_ORDER.filter((status) => presentStatuses.has(status));

	return createRequestLogFilterOptions({
		accountIds,
		modelOptions: modelOptionsList,
		statuses: [...statuses],
	});
}

function findAccount(accountId: string): AccountSummary | undefined {
	return state.accounts.find((account) => account.accountId === accountId);
}

function findApiKey(keyId: string): ApiKey | undefined {
	return state.apiKeys.find((item) => item.id === keyId);
}

export const handlers = [
	http.get("/health", () => {
		return HttpResponse.json({ status: "ok" });
	}),

	http.get("/api/dashboard/overview", () => {
		return HttpResponse.json(
			createDashboardOverview({
				accounts: state.accounts,
			}),
		);
	}),

	http.get("/api/dashboard/system-monitor", () => {
		return HttpResponse.json({
			sampledAt: new Date().toISOString(),
			cpuPercent: 39.8,
			gpuPercent: 33.5,
			vramPercent: 57.5,
			networkMbS: 5.3,
			memoryPercent: 61.2,
			spike: true,
		});
	}),

	http.get("/api/request-logs", ({ request }) => {
		const url = new URL(request.url);
		const filtered = filterRequestLogs(url);
		const total = filtered.length;
		const limitRaw = Number(url.searchParams.get("limit") ?? 50);
		const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
		const limit =
			Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 50;
		const offset =
			Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
		const requests = filtered.slice(offset, offset + limit);
		return HttpResponse.json(
			createRequestLogsResponse(requests, total, offset + limit < total),
		);
	}),

	http.get("/api/request-logs/options", ({ request }) => {
		const filtered = filterRequestLogs(new URL(request.url), {
			includeStatuses: false,
		});
		return HttpResponse.json(requestLogOptionsFromEntries(filtered));
	}),

	http.get("/api/request-logs/usage-summary", ({ request }) => {
		const url = new URL(request.url);
		const now = new Date();
		const since5h = now.getTime() - 5 * 60 * 60 * 1000;
		const since7d = now.getTime() - 7 * 24 * 60 * 60 * 1000;
		const filtered = filterRequestLogs(url, { includeStatuses: false });

		const sumByAccount = (
			entries: RequestLogEntry[],
		): {
			totalTokens: number;
			totalCostUsd: number;
			totalCostEur: number;
			accounts: Array<{ accountId: string | null; tokens: number; costUsd: number; costEur: number }>;
		} => {
			const byAccount = new Map<string | null, { tokens: number; costUsd: number; costEur: number }>();
			const fxRate = 0.92;
			for (const entry of entries) {
				const tokens = entry.tokens ?? 0;
				const costUsd = entry.costUsd ?? 0;
				const costEur = costUsd * fxRate;
				const key = entry.accountId ?? null;
				const current = byAccount.get(key) ?? { tokens: 0, costUsd: 0, costEur: 0 };
				byAccount.set(key, {
					tokens: current.tokens + tokens,
					costUsd: current.costUsd + costUsd,
					costEur: current.costEur + costEur,
				});
			}

			const accounts = [...byAccount.entries()]
				.map(([accountId, aggregate]) => ({
					accountId,
					tokens: aggregate.tokens,
					costUsd: aggregate.costUsd,
					costEur: aggregate.costEur,
				}))
				.sort((left, right) => right.tokens - left.tokens);

			return {
				totalTokens: accounts.reduce((total, row) => total + row.tokens, 0),
				totalCostUsd: accounts.reduce((total, row) => total + row.costUsd, 0),
				totalCostEur: accounts.reduce((total, row) => total + row.costEur, 0),
				accounts,
			};
		};

		const last5hEntries = filtered.filter((entry) => new Date(entry.requestedAt).getTime() >= since5h);
		const last7dEntries = filtered.filter((entry) => new Date(entry.requestedAt).getTime() >= since7d);

		return HttpResponse.json(
			createRequestLogUsageSummary({
				last5h: sumByAccount(last5hEntries),
				last7d: sumByAccount(last7dEntries),
				fxRateUsdToEur: 0.92,
			}),
		);
	}),

	http.get("/api/accounts", () => {
		return HttpResponse.json({ accounts: state.accounts });
	}),

	http.post("/api/accounts/import", async () => {
		const sequence = state.accounts.length + 1;
		const created = createAccountSummary({
			accountId: `acc_imported_${sequence}`,
			email: `imported-${sequence}@example.com`,
			displayName: `imported-${sequence}@example.com`,
			status: "active",
		});
		state.accounts = [...state.accounts, created];
		return HttpResponse.json({
			accountId: created.accountId,
			email: created.email,
			planType: created.planType,
			status: created.status,
		});
	}),

	http.post("/api/accounts/:accountId/pause", ({ params }) => {
		const accountId = String(params.accountId);
		const account = findAccount(accountId);
		if (!account) {
			return HttpResponse.json(
				{ error: { code: "account_not_found", message: "Account not found" } },
				{ status: 404 },
			);
		}
		account.status = "paused";
		return HttpResponse.json({ status: "paused" });
	}),

	http.post("/api/accounts/:accountId/reactivate", ({ params }) => {
		const accountId = String(params.accountId);
		const account = findAccount(accountId);
		if (!account) {
			return HttpResponse.json(
				{ error: { code: "account_not_found", message: "Account not found" } },
				{ status: 404 },
			);
		}
		account.status = "active";
		return HttpResponse.json({ status: "reactivated" });
	}),

	http.post("/api/accounts/:accountId/use-local", ({ params }) => {
		const accountId = String(params.accountId);
		const account = findAccount(accountId);
		if (!account) {
			return HttpResponse.json(
				{ error: { code: "account_not_found", message: "Account not found" } },
				{ status: 404 },
			);
		}

		const snapshotName = account.codexAuth?.snapshotName ?? "main";
		state.accounts = state.accounts.map((entry) => ({
			...entry,
			codexAuth: entry.codexAuth
				? {
						...entry.codexAuth,
						activeSnapshotName: snapshotName,
						isActiveSnapshot: entry.accountId === accountId,
					}
				: entry.codexAuth,
		}));

		return HttpResponse.json({
			status: "switched",
			accountId: account.accountId,
			snapshotName,
		});
	}),

	http.post("/api/accounts/:accountId/refresh-auth", ({ params }) => {
		const accountId = String(params.accountId);
		const account = findAccount(accountId);
		if (!account) {
			return HttpResponse.json(
				{ error: { code: "account_not_found", message: "Account not found" } },
				{ status: 404 },
			);
		}

		if (account.status === "deactivated") {
			account.status = "active";
		}

		return HttpResponse.json({
			status: "refreshed",
			accountId: account.accountId,
			email: account.email,
			planType: account.planType,
		});
	}),

	http.post("/api/accounts/:accountId/repair-snapshot", ({ params, request }) => {
		const accountId = String(params.accountId);
		const account = findAccount(accountId);
		if (!account) {
			return HttpResponse.json(
				{ error: { code: "account_not_found", message: "Account not found" } },
				{ status: 404 },
			);
		}
		const url = new URL(request.url);
		const mode = url.searchParams.get("mode") === "rename" ? "rename" : "readd";
		const previousSnapshotName = account.codexAuth?.snapshotName ?? "main";
		const expectedSnapshotName = account.codexAuth?.expectedSnapshotName ?? account.email.trim().toLowerCase();
		state.accounts = state.accounts.map((entry) =>
			entry.accountId === accountId
				? {
						...entry,
						codexAuth: entry.codexAuth
							? {
									...entry.codexAuth,
									hasSnapshot: true,
									snapshotName: expectedSnapshotName,
									activeSnapshotName: expectedSnapshotName,
									isActiveSnapshot: true,
									expectedSnapshotName,
									snapshotNameMatchesEmail: true,
								}
							: entry.codexAuth,
				  }
				: entry,
		);
		return HttpResponse.json({
			status: "repaired",
			accountId,
			previousSnapshotName,
			snapshotName: expectedSnapshotName,
			mode,
			changed: previousSnapshotName !== expectedSnapshotName,
		});
	}),

	http.get("/api/accounts/:accountId/trends", ({ params }) => {
		const accountId = String(params.accountId);
		const account = findAccount(accountId);
		if (!account) {
			return HttpResponse.json(
				{ error: { code: "account_not_found", message: "Account not found" } },
				{ status: 404 },
			);
		}
		return HttpResponse.json(createAccountTrends(accountId));
	}),

	http.delete("/api/accounts/:accountId", ({ params }) => {
		const accountId = String(params.accountId);
		const exists = state.accounts.some(
			(account) => account.accountId === accountId,
		);
		if (!exists) {
			return HttpResponse.json(
				{ error: { code: "account_not_found", message: "Account not found" } },
				{ status: 404 },
			);
		}
		state.accounts = state.accounts.filter(
			(account) => account.accountId !== accountId,
		);
		return HttpResponse.json({ status: "deleted" });
	}),

	http.post("/api/oauth/start", async ({ request }) => {
		const payload = await parseJsonBody(request, OauthStartPayloadSchema);
		if (payload?.forceMethod === "device") {
			return HttpResponse.json(
				createOauthStartResponse({
					method: "device",
					authorizationUrl: null,
					callbackUrl: null,
					verificationUrl: "https://auth.example.com/device",
					userCode: "AAAA-BBBB",
					deviceAuthId: "device-auth-id",
					intervalSeconds: 5,
					expiresInSeconds: 900,
				}),
			);
		}
		return HttpResponse.json(createOauthStartResponse());
	}),

	http.get("/api/oauth/status", () => {
		return HttpResponse.json(createOauthStatusResponse());
	}),

	http.post("/api/oauth/complete", () => {
		return HttpResponse.json(createOauthCompleteResponse());
	}),

	http.get("/api/settings", () => {
		return HttpResponse.json(state.settings);
	}),

	http.get("/api/billing", () => {
		return HttpResponse.json({ accounts: state.billingAccounts });
	}),

	http.put("/api/billing", async ({ request }) => {
		const payload = await parseJsonBody(request, BillingPayloadSchema);
		if (!payload) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_billing_payload",
						message: "Invalid billing payload",
					},
				},
				{ status: 400 },
			);
		}
		state.billingAccounts = payload.accounts;
		return HttpResponse.json({ accounts: state.billingAccounts });
	}),

	http.post("/api/billing/accounts", async ({ request }) => {
		const payload = await parseJsonBody(request, BillingAccountCreatePayloadSchema);
		if (!payload) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_billing_account_payload",
						message: "Invalid billing account payload",
					},
				},
				{ status: 400 },
			);
		}

		const normalizedDomain = payload.domain.trim().toLowerCase();
		if (!normalizedDomain) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_billing_account_payload",
						message: "Domain is required",
					},
				},
				{ status: 400 },
			);
		}

		if (state.billingAccounts.some((account) => account.domain.toLowerCase() === normalizedDomain)) {
			return HttpResponse.json(
				{
					error: {
						code: "billing_account_exists",
						message: `Subscription account already exists for ${normalizedDomain}`,
					},
				},
				{ status: 409 },
			);
		}

		const now = new Date();
		const renewalAt =
			payload.renewalAt instanceof Date ? payload.renewalAt : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
		const idSuffix = normalizedDomain.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "account";
		const created = {
			id: `business-plan-${idSuffix}`,
			domain: normalizedDomain,
			planCode: payload.planCode,
			planName: payload.planName,
			subscriptionStatus: payload.subscriptionStatus,
			entitled: payload.entitled,
			paymentStatus: payload.paymentStatus,
			billingCycle: {
				start: now,
				end: renewalAt,
			},
			renewalAt,
			chatgptSeatsInUse: payload.chatgptSeatsInUse,
			codexSeatsInUse: payload.codexSeatsInUse,
			members: [],
		};

		state.billingAccounts = [...state.billingAccounts, created];

		return HttpResponse.json(created, { status: 200 });
	}),

	http.delete("/api/billing/accounts", async ({ request }) => {
		const payload = await parseJsonBody(request, BillingAccountDeletePayloadSchema);
		if (!payload) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_billing_account_payload",
						message: "Invalid billing account payload",
					},
				},
				{ status: 400 },
			);
		}

		const existing = state.billingAccounts.find((account) => account.id === payload.id);
		if (!existing) {
			return HttpResponse.json(
				{
					error: {
						code: "billing_account_not_found",
						message: `Billing account not found: ${payload.id}`,
					},
				},
				{ status: 404 },
			);
		}

		state.billingAccounts = state.billingAccounts.filter((account) => account.id !== payload.id);
		return new HttpResponse(null, { status: 204 });
	}),

	http.get("/api/firewall/ips", () => {
		return HttpResponse.json({
			mode:
				state.firewallEntries.length === 0 ? "allow_all" : "allowlist_active",
			entries: state.firewallEntries,
		});
	}),

	http.post("/api/firewall/ips", async ({ request }) => {
		const payload = await parseJsonBody(request, FirewallIpCreatePayloadSchema);
		const ipAddress = String(payload?.ipAddress || "").trim();
		if (!ipAddress) {
			return HttpResponse.json(
				{ error: { code: "invalid_ip", message: "IP address is required" } },
				{ status: 400 },
			);
		}
		if (state.firewallEntries.some((entry) => entry.ipAddress === ipAddress)) {
			return HttpResponse.json(
				{ error: { code: "ip_exists", message: "IP address already exists" } },
				{ status: 409 },
			);
		}
		const created = { ipAddress, createdAt: new Date().toISOString() };
		state.firewallEntries = [...state.firewallEntries, created];
		return HttpResponse.json(created);
	}),

	http.delete("/api/firewall/ips/:ipAddress", ({ params }) => {
		const ipAddress = decodeURIComponent(String(params.ipAddress));
		const exists = state.firewallEntries.some(
			(entry) => entry.ipAddress === ipAddress,
		);
		if (!exists) {
			return HttpResponse.json(
				{ error: { code: "ip_not_found", message: "IP address not found" } },
				{ status: 404 },
			);
		}
		state.firewallEntries = state.firewallEntries.filter(
			(entry) => entry.ipAddress !== ipAddress,
		);
		return HttpResponse.json({ status: "deleted" });
	}),

	http.get("/api/devices", () => {
		return HttpResponse.json({ entries: state.devices });
	}),

	http.post("/api/devices", async ({ request }) => {
		const payload = await parseJsonBody(request, DeviceCreatePayloadSchema);
		const name = String(payload?.name || "").trim();
		const ipAddress = String(payload?.ipAddress || "").trim();

		if (!name) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_device_name",
						message: "Device name is required",
					},
				},
				{ status: 400 },
			);
		}
		if (!ipAddress) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_ip",
						message: "IP address is required",
					},
				},
				{ status: 400 },
			);
		}
		if (state.devices.some((entry) => entry.name === name)) {
			return HttpResponse.json(
				{
					error: {
						code: "device_name_exists",
						message: "Device name already exists",
					},
				},
				{ status: 409 },
			);
		}
		if (state.devices.some((entry) => entry.ipAddress === ipAddress)) {
			return HttpResponse.json(
				{
					error: {
						code: "device_ip_exists",
						message: "Device IP address already exists",
					},
				},
				{ status: 409 },
			);
		}

		const now = new Date().toISOString();
		const created = {
			id: `device_${state.devices.length + 1}`,
			name,
			ipAddress,
			createdAt: now,
			updatedAt: now,
		};
		state.devices = [...state.devices, created];
		return HttpResponse.json(created);
	}),

	http.put("/api/devices/:deviceId", async ({ params, request }) => {
		const deviceId = String(params.deviceId);
		const payload = await parseJsonBody(request, DeviceUpdatePayloadSchema);
		const name = String(payload?.name || "").trim();
		const ipAddress = String(payload?.ipAddress || "").trim();
		const current = state.devices.find((entry) => entry.id === deviceId);

		if (!current) {
			return HttpResponse.json(
				{
					error: {
						code: "device_not_found",
						message: "Device not found",
					},
				},
				{ status: 404 },
			);
		}

		if (!name) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_device_name",
						message: "Device name is required",
					},
				},
				{ status: 400 },
			);
		}
		if (!ipAddress) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_ip",
						message: "IP address is required",
					},
				},
				{ status: 400 },
			);
		}
		if (
			state.devices.some(
				(entry) => entry.id !== deviceId && entry.name === name,
			)
		) {
			return HttpResponse.json(
				{
					error: {
						code: "device_name_exists",
						message: "Device name already exists",
					},
				},
				{ status: 409 },
			);
		}
		if (
			state.devices.some(
				(entry) => entry.id !== deviceId && entry.ipAddress === ipAddress,
			)
		) {
			return HttpResponse.json(
				{
					error: {
						code: "device_ip_exists",
						message: "Device IP address already exists",
					},
				},
				{ status: 409 },
			);
		}

		const updated = {
			...current,
			name,
			ipAddress,
			updatedAt: new Date().toISOString(),
		};
		state.devices = state.devices.map((entry) =>
			entry.id === deviceId ? updated : entry,
		);
		return HttpResponse.json(updated);
	}),

	http.delete("/api/devices/:deviceId", ({ params }) => {
		const deviceId = String(params.deviceId);
		const exists = state.devices.some((entry) => entry.id === deviceId);
		if (!exists) {
			return HttpResponse.json(
				{
					error: {
						code: "device_not_found",
						message: "Device not found",
					},
				},
				{ status: 404 },
			);
		}
		state.devices = state.devices.filter((entry) => entry.id !== deviceId);
		return HttpResponse.json({ status: "deleted" });
	}),

	http.get("/api/projects/plans", () => {
		return HttpResponse.json({
			entries: state.openSpecPlans.map((plan) => ({
				slug: plan.slug,
				title: plan.title,
				status: plan.status,
				updatedAt: plan.updatedAt,
				roles: plan.roles.map((role) => ({
					role: role.role,
					totalCheckpoints: role.totalCheckpoints,
					doneCheckpoints: role.doneCheckpoints,
				})),
				overallProgress: plan.overallProgress,
				currentCheckpoint: plan.currentCheckpoint,
			})),
		});
	}),

	http.get("/api/projects/plans/:planSlug", ({ params }) => {
		const planSlug = String(params.planSlug);
		const plan = state.openSpecPlans.find((entry) => entry.slug === planSlug);
		if (!plan) {
			return HttpResponse.json(
				{
					error: {
						code: "plan_not_found",
						message: "Plan not found",
					},
				},
				{ status: 404 },
			);
		}

		return HttpResponse.json({
			slug: plan.slug,
			title: plan.title,
			status: plan.status,
			updatedAt: plan.updatedAt,
			summaryMarkdown: plan.summaryMarkdown,
			checkpointsMarkdown: plan.checkpointsMarkdown,
			roles: plan.roles.map((role) => ({
				role: role.role,
				totalCheckpoints: role.totalCheckpoints,
				doneCheckpoints: role.doneCheckpoints,
				tasksMarkdown: role.tasksMarkdown,
				checkpointsMarkdown: role.checkpointsMarkdown,
			})),
			overallProgress: plan.overallProgress,
			currentCheckpoint: plan.currentCheckpoint,
		});
	}),

	http.get("/api/projects/plans/:planSlug/runtime", ({ params }) => {
		const planSlug = String(params.planSlug);
		const plan = state.openSpecPlans.find((entry) => entry.slug === planSlug);
		if (!plan) {
			return HttpResponse.json(
				{
					available: false,
					sessionId: null,
					correlationConfidence: null,
					mode: null,
					phase: null,
					active: false,
					updatedAt: null,
					agents: [],
					events: [],
					lastCheckpoint: null,
					lastError: null,
					canResume: false,
					partial: false,
					staleAfterSeconds: 30,
					reasons: ["correlation_unresolved"],
					unavailableReason: "correlation_unresolved",
				},
				{ status: 200 },
			);
		}
		return HttpResponse.json(plan.runtime);
	}),

	http.get("/api/projects", () => {
		return HttpResponse.json({ entries: state.projects });
	}),

	http.post("/api/projects", async ({ request }) => {
		const payload = await parseJsonBody(request, ProjectCreatePayloadSchema);
		const name = String(payload?.name || "").trim();
		const descriptionRaw = payload?.description;
		const description =
			typeof descriptionRaw === "string" ? descriptionRaw.trim() : null;
		const projectPathResult = normalizeProjectPath(payload?.projectPath);
		const sandboxModeResult = normalizeProjectSandboxMode(payload?.sandboxMode);
		const gitBranchResult = normalizeProjectGitBranch(payload?.gitBranch);

		if (!name) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_project_name",
						message: "Project name is required",
					},
				},
				{ status: 400 },
			);
		}
		if (name.length > 128) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_project_name",
						message: "Project name must be 128 characters or fewer",
					},
				},
				{ status: 400 },
			);
		}
		if (description && description.length > 512) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_project_description",
						message: "Project description must be 512 characters or fewer",
					},
				},
				{ status: 400 },
			);
		}
		if (!projectPathResult.ok) {
			return HttpResponse.json(
				{
					error: {
						code: projectPathResult.code,
						message: projectPathResult.message,
					},
				},
				{ status: 400 },
			);
		}
		if (!sandboxModeResult.ok) {
			return HttpResponse.json(
				{
					error: {
						code: sandboxModeResult.code,
						message: sandboxModeResult.message,
					},
				},
				{ status: 400 },
			);
		}
		if (!gitBranchResult.ok) {
			return HttpResponse.json(
				{
					error: {
						code: gitBranchResult.code,
						message: gitBranchResult.message,
					},
				},
				{ status: 400 },
			);
		}
		if (state.projects.some((entry) => entry.name === name)) {
			return HttpResponse.json(
				{
					error: {
						code: "project_name_exists",
						message: "Project name already exists",
					},
				},
				{ status: 409 },
			);
		}

		const now = new Date().toISOString();
		const created = {
			id: `project_${state.projects.length + 1}`,
			name,
			description: description || null,
			projectPath: projectPathResult.value,
			sandboxMode: sandboxModeResult.value,
			gitBranch: gitBranchResult.value,
			createdAt: now,
			updatedAt: now,
		};
		state.projects = [...state.projects, created];
		return HttpResponse.json(created);
	}),

	http.put("/api/projects/:projectId", async ({ params, request }) => {
		const projectId = String(params.projectId);
		const payload = await parseJsonBody(request, ProjectUpdatePayloadSchema);
		const name = String(payload?.name || "").trim();
		const descriptionRaw = payload?.description;
		const description =
			typeof descriptionRaw === "string" ? descriptionRaw.trim() : null;
		const projectPathResult = normalizeProjectPath(payload?.projectPath);
		const sandboxModeResult = normalizeProjectSandboxMode(payload?.sandboxMode);
		const gitBranchResult = normalizeProjectGitBranch(payload?.gitBranch);
		const current = state.projects.find((entry) => entry.id === projectId);

		if (!current) {
			return HttpResponse.json(
				{
					error: {
						code: "project_not_found",
						message: "Project not found",
					},
				},
				{ status: 404 },
			);
		}

		if (!name) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_project_name",
						message: "Project name is required",
					},
				},
				{ status: 400 },
			);
		}
		if (name.length > 128) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_project_name",
						message: "Project name must be 128 characters or fewer",
					},
				},
				{ status: 400 },
			);
		}
		if (description && description.length > 512) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_project_description",
						message: "Project description must be 512 characters or fewer",
					},
				},
				{ status: 400 },
			);
		}
		if (!projectPathResult.ok) {
			return HttpResponse.json(
				{
					error: {
						code: projectPathResult.code,
						message: projectPathResult.message,
					},
				},
				{ status: 400 },
			);
		}
		if (!sandboxModeResult.ok) {
			return HttpResponse.json(
				{
					error: {
						code: sandboxModeResult.code,
						message: sandboxModeResult.message,
					},
				},
				{ status: 400 },
			);
		}
		if (!gitBranchResult.ok) {
			return HttpResponse.json(
				{
					error: {
						code: gitBranchResult.code,
						message: gitBranchResult.message,
					},
				},
				{ status: 400 },
			);
		}
		if (
			state.projects.some(
				(entry) => entry.id !== projectId && entry.name === name,
			)
		) {
			return HttpResponse.json(
				{
					error: {
						code: "project_name_exists",
						message: "Project name already exists",
					},
				},
				{ status: 409 },
			);
		}

		const updated = {
			...current,
			name,
			description: description || null,
			projectPath: projectPathResult.value,
			sandboxMode: sandboxModeResult.value,
			gitBranch: gitBranchResult.value,
			updatedAt: new Date().toISOString(),
		};
		state.projects = state.projects.map((entry) =>
			entry.id === projectId ? updated : entry,
		);
		return HttpResponse.json(updated);
	}),

	http.delete("/api/projects/:projectId", ({ params }) => {
		const projectId = String(params.projectId);
		const exists = state.projects.some((entry) => entry.id === projectId);
		if (!exists) {
			return HttpResponse.json(
				{
					error: {
						code: "project_not_found",
						message: "Project not found",
					},
				},
				{ status: 404 },
			);
		}
		state.projects = state.projects.filter((entry) => entry.id !== projectId);
		return HttpResponse.json({ status: "deleted" });
	}),

	http.put("/api/settings", async ({ request }) => {
		const payload = await parseJsonBody(request, SettingsPayloadSchema);
		if (!payload) {
			return HttpResponse.json(state.settings);
		}
		state.settings = createDashboardSettings({
			...state.settings,
			...payload,
		});
		return HttpResponse.json(state.settings);
	}),

	http.get("/api/sticky-sessions", ({ request }) => {
		const url = new URL(request.url);
		const staleOnly = url.searchParams.get("staleOnly") === "true";
		const kind = url.searchParams.get("kind");
		const offset = Number(url.searchParams.get("offset") ?? "0");
		const limit = Number(url.searchParams.get("limit") ?? "10");
		const kindFilteredEntries = kind
			? state.stickySessions.filter((entry) => entry.kind === kind)
			: state.stickySessions;
		const filteredEntries = staleOnly
			? kindFilteredEntries.filter(
					(entry) => entry.kind === "prompt_cache" && entry.isStale,
				)
			: kindFilteredEntries;
		const entries = filteredEntries.slice(offset, offset + limit);
		const stalePromptCacheCount = state.stickySessions.filter(
			(entry) => entry.kind === "prompt_cache" && entry.isStale,
		).length;
		return HttpResponse.json({
			entries,
			stalePromptCacheCount,
			total: filteredEntries.length,
			hasMore: offset + entries.length < filteredEntries.length,
		});
	}),

	http.post("/api/sticky-sessions/delete", async ({ request }) => {
		const payload = (await parseJsonBody(
			request,
			z.object({
				sessions: z
					.array(
						z.object({
							key: z.string().min(1),
							kind: z.enum(["codex_session", "sticky_thread", "prompt_cache"]),
						}),
					)
					.min(1)
					.max(500),
			}),
		)) ?? { sessions: [] };
		const targets = new Set(payload.sessions.map((session) => `${session.kind}:${session.key}`));
		const before = state.stickySessions.length;
		state.stickySessions = state.stickySessions.filter(
			(entry) => !targets.has(`${entry.kind}:${entry.key}`),
		);
		return HttpResponse.json({ deletedCount: before - state.stickySessions.length });
	}),

	http.post("/api/sticky-sessions/purge", async ({ request }) => {
		const payload = (await parseJsonBody(
			request,
			z.object({ staleOnly: z.boolean().default(true) }),
		)) ?? {
			staleOnly: true,
		};
		if (payload.staleOnly) {
			const before = state.stickySessions.length;
			state.stickySessions = state.stickySessions.filter(
				(entry) => !entry.isStale,
			);
			return HttpResponse.json({
				deletedCount: before - state.stickySessions.length,
			});
		}
		const deletedCount = state.stickySessions.length;
		state.stickySessions = [];
		return HttpResponse.json({ deletedCount });
	}),

	http.post("*/auth/customer/emailpass/register", async ({ request }) => {
		const payload = await parseJsonBody(request, MedusaCredentialsPayloadSchema);
		if (!payload) {
			return HttpResponse.json(
				{ message: "Invalid registration payload" },
				{ status: 400 },
			);
		}
		return HttpResponse.json({ token: "test-medusa-token" });
	}),

	http.post("*/auth/customer/emailpass", async ({ request }) => {
		const payload = await parseJsonBody(request, MedusaCredentialsPayloadSchema);
		if (!payload) {
			return HttpResponse.json(
				{ message: "Invalid login payload" },
				{ status: 400 },
			);
		}

		return HttpResponse.json({ token: "test-medusa-token" });
	}),

	http.post("*/store/customers", async ({ request }) => {
		const authHeader = request.headers.get("authorization");
		if (!authHeader?.startsWith("Bearer ")) {
			return HttpResponse.json({ message: "Unauthorized" }, { status: 401 });
		}

		const payload = await parseJsonBody(request, MedusaCustomerCreatePayloadSchema);
		if (!payload) {
			return HttpResponse.json(
				{ message: "Invalid customer payload" },
				{ status: 400 },
			);
		}

		state.medusaCustomer = {
			...state.medusaCustomer,
			email: payload.email,
			first_name: payload.first_name?.trim() || null,
			last_name: payload.last_name?.trim() || null,
		};

		return HttpResponse.json({ customer: state.medusaCustomer });
	}),

	http.get("*/store/customers/me", ({ request }) => {
		const authHeader = request.headers.get("authorization");
		if (!authHeader?.startsWith("Bearer ")) {
			return HttpResponse.json({ message: "Unauthorized" }, { status: 401 });
		}

		return HttpResponse.json({ customer: state.medusaCustomer });
	}),

	http.get("/api/dashboard-auth/session", () => {
		return HttpResponse.json(state.authSession);
	}),

	http.post("/api/dashboard-auth/password/setup", () => {
		state.authSession = createDashboardAuthSession({
			authenticated: true,
			passwordRequired: true,
			totpRequiredOnLogin: false,
			totpConfigured: state.authSession.totpConfigured,
		});
		return HttpResponse.json(state.authSession);
	}),

	http.post("/api/dashboard-auth/password/login", () => {
		state.authSession = createDashboardAuthSession({
			...state.authSession,
			authenticated: !state.authSession.totpRequiredOnLogin,
		});
		return HttpResponse.json(state.authSession);
	}),

	http.post("/api/dashboard-auth/password/change", () => {
		return HttpResponse.json({ status: "ok" });
	}),

	http.delete("/api/dashboard-auth/password", () => {
		state.authSession = createDashboardAuthSession({
			authenticated: false,
			passwordRequired: false,
			totpRequiredOnLogin: false,
			totpConfigured: false,
		});
		return HttpResponse.json({ status: "ok" });
	}),

	http.post("/api/dashboard-auth/totp/setup/start", () => {
		return HttpResponse.json({
			secret: "JBSWY3DPEHPK3PXP",
			otpauthUri: "otpauth://totp/codex-lb?secret=JBSWY3DPEHPK3PXP",
			qrSvgDataUri: "data:image/svg+xml;base64,PHN2Zy8+",
		});
	}),

	http.post("/api/dashboard-auth/totp/setup/confirm", () => {
		state.authSession = createDashboardAuthSession({
			...state.authSession,
			totpConfigured: true,
			authenticated: true,
		});
		return HttpResponse.json({ status: "ok" });
	}),

	http.post("/api/dashboard-auth/totp/verify", () => {
		state.authSession = createDashboardAuthSession({
			...state.authSession,
			authenticated: true,
		});
		return HttpResponse.json(state.authSession);
	}),

	http.post("/api/dashboard-auth/totp/disable", () => {
		state.authSession = createDashboardAuthSession({
			...state.authSession,
			totpConfigured: false,
			totpRequiredOnLogin: false,
			authenticated: true,
		});
		return HttpResponse.json({ status: "ok" });
	}),

	http.post("/api/dashboard-auth/logout", () => {
		state.authSession = createDashboardAuthSession({
			...state.authSession,
			authenticated: false,
		});
		return HttpResponse.json({ status: "ok" });
	}),

	http.get("/api/models", () => {
		return HttpResponse.json({
			models: [
				{ id: "gpt-5.1", name: "GPT 5.1" },
				{ id: "gpt-5.1-codex-mini", name: "GPT 5.1 Codex Mini" },
				{ id: "gpt-4o-mini", name: "GPT 4o Mini" },
			],
		});
	}),

	http.get("/api/api-keys/", () => {
		return HttpResponse.json(state.apiKeys);
	}),

	http.post("/api/api-keys/", async ({ request }) => {
		const payload = await parseJsonBody(request, ApiKeyCreatePayloadSchema);
		const sequence = state.apiKeys.length + 1;
		const created = createApiKeyCreateResponse({
			...createApiKey({
				id: `key_${sequence}`,
				name: payload?.name ?? `API Key ${sequence}`,
			}),
			key: `sk-test-generated-${sequence}`,
		});
		state.apiKeys = [...state.apiKeys, createApiKey(created)];
		return HttpResponse.json(created);
	}),

	http.patch("/api/api-keys/:keyId", async ({ params, request }) => {
		const keyId = String(params.keyId);
		const existing = findApiKey(keyId);
		if (!existing) {
			return HttpResponse.json(
				{ error: { code: "not_found", message: "API key not found" } },
				{ status: 404 },
			);
		}
		const payload = await parseJsonBody(request, ApiKeyUpdatePayloadSchema);
		if (!payload) {
			return HttpResponse.json(existing);
		}

		// Build override with converted limits (create format → response format)
		const overrides: Partial<ApiKey> = {
			...(payload.name !== undefined ? { name: payload.name } : {}),
			...(payload.allowedModels !== undefined
				? { allowedModels: payload.allowedModels }
				: {}),
			...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
		};

		if (payload.limits) {
			overrides.limits = payload.limits.map((l, idx) => ({
				id: idx + 100,
				limitType: l.limitType,
				limitWindow: l.limitWindow,
				maxValue: l.maxValue,
				currentValue: 0,
				modelFilter: l.modelFilter ?? null,
				resetAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
			}));
		}

		const updated = createApiKey({
			...existing,
			...overrides,
			id: keyId,
		});
		state.apiKeys = state.apiKeys.map((item) =>
			item.id === keyId ? updated : item,
		);
		return HttpResponse.json(updated);
	}),

	http.delete("/api/api-keys/:keyId", ({ params }) => {
		const keyId = String(params.keyId);
		const exists = state.apiKeys.some((item) => item.id === keyId);
		if (!exists) {
			return HttpResponse.json(
				{ error: { code: "not_found", message: "API key not found" } },
				{ status: 404 },
			);
		}
		state.apiKeys = state.apiKeys.filter((item) => item.id !== keyId);
		return new HttpResponse(null, { status: 204 });
	}),

	http.post("/api/api-keys/:keyId/regenerate", ({ params }) => {
		const keyId = String(params.keyId);
		const existing = findApiKey(keyId);
		if (!existing) {
			return HttpResponse.json(
				{ error: { code: "not_found", message: "API key not found" } },
				{ status: 404 },
			);
		}
		const regenerated = createApiKeyCreateResponse({
			...existing,
			key: `sk-test-regenerated-${keyId}`,
		});
		state.apiKeys = state.apiKeys.map((item) =>
			item.id === keyId ? createApiKey(regenerated) : item,
		);
		return HttpResponse.json(regenerated);
	}),

	http.get("/api/api-keys/:keyId/trends", ({ params }) => {
		const keyId = String(params.keyId);
		const existing = findApiKey(keyId);
		if (!existing) {
			return HttpResponse.json(
				{ error: { code: "not_found", message: "API key not found" } },
				{ status: 404 },
			);
		}
		return HttpResponse.json(createApiKeyTrends({ keyId }));
	}),

	http.get("/api/api-keys/:keyId/usage-7d", ({ params }) => {
		const keyId = String(params.keyId);
		const existing = findApiKey(keyId);
		if (!existing) {
			return HttpResponse.json(
				{ error: { code: "not_found", message: "API key not found" } },
				{ status: 404 },
			);
		}
		return HttpResponse.json(createApiKeyUsage7Day({ keyId }));
	}),
];
