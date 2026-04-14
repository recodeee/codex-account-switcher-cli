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
	createDefaultWorkspaces,
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
		projectUrl: z.string().nullable().optional(),
		githubRepoUrl: z.string().nullable().optional(),
		projectPath: z.string().nullable().optional(),
		sandboxMode: z.string().optional(),
		gitBranch: z.string().nullable().optional(),
	})
	.passthrough();

const ProjectUpdatePayloadSchema = z
	.object({
		name: z.string().optional(),
		description: z.string().nullable().optional(),
		projectUrl: z.string().nullable().optional(),
		githubRepoUrl: z.string().nullable().optional(),
		projectPath: z.string().nullable().optional(),
		sandboxMode: z.string().optional(),
		gitBranch: z.string().nullable().optional(),
	})
	.passthrough();

const WorkspaceCreatePayloadSchema = z
	.object({
		name: z.string().optional(),
		label: z.string().nullable().optional(),
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
		workspaceId: string;
		name: string;
		description: string | null;
		projectUrl: string | null;
		githubRepoUrl: string | null;
		projectPath: string | null;
		sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
		gitBranch: string | null;
		createdAt: string;
		updatedAt: string;
	}>;
	workspaces: Array<{
		id: string;
		name: string;
		slug: string;
		label: string;
		isActive: boolean;
		createdAt: string;
		updatedAt: string;
	}>;
	openSpecPlans: Array<{
		slug: string;
		title: string;
		status: string;
		projectPath: string | null;
		createdAt: string;
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
			promptBundles: Array<{
				id: string;
				title: string;
				sourcePath: string;
				prompts: Array<{
					id: string;
					title: string;
					content: string;
					sourcePath: string;
				}>;
			}>;
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

function getActiveWorkspaceId(state: MockState): string | null {
	return state.workspaces.find((entry) => entry.isActive)?.id ?? state.workspaces[0]?.id ?? null;
}

function resolveProjectScopedPlans(
	state: MockState,
	projectId: string | null,
): MockState["openSpecPlans"] {
	if (!projectId) {
		return state.openSpecPlans;
	}

	const activeWorkspaceId = getActiveWorkspaceId(state);
	const project = state.projects.find(
		(entry) => entry.id === projectId && (activeWorkspaceId === null || entry.workspaceId === activeWorkspaceId),
	);
	if (!project?.projectPath) {
		return [];
	}

	return state.openSpecPlans.filter(
		(plan) => Boolean(plan.projectPath) && plan.projectPath === project.projectPath,
	);
}

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
		workspaces: createDefaultWorkspaces(),
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
			projectPath: null,
			createdAt: new Date("2026-04-08T07:41:12Z").toISOString(),
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
			promptBundles: [
				{
					id: "kickoff-prompts",
					title: "Kickoff Prompts (Copy/Paste)",
					sourcePath: "kickoff-prompts.md",
					prompts: [
						{
							id: "prompt-a-wave-7a-schedulers-jobs",
							title: "Prompt A — Wave-7A (Schedulers / Jobs)",
							content:
								'You own Wave-7A for full Python->Rust replacement in /home/deadpool/Documents/codex-lb.',
							sourcePath: "kickoff-prompts.md",
						},
						{
							id: "prompt-b-wave-7b-cache-invalidation-poller",
							title: "Prompt B — Wave-7B (Cache Invalidation Poller)",
							content:
								'You own Wave-7B for full Python->Rust replacement in /home/deadpool/Documents/codex-lb.',
							sourcePath: "kickoff-prompts.md",
						},
						{
							id: "prompt-c-wave-7c-ring-heartbeat-membership-lifecycle",
							title: "Prompt C — Wave-7C (Ring Heartbeat / Membership Lifecycle)",
							content:
								'You own Wave-7C for full Python->Rust replacement in /home/deadpool/Documents/codex-lb.',
							sourcePath: "kickoff-prompts.md",
						},
						{
							id: "prompt-d-integrator-wave-8-cutover-python-deprecation",
							title: "Prompt D — Integrator (Wave-8 Cutover + Python Deprecation)",
							content:
								'You are the integrator for Wave-8 in /home/deadpool/Documents/codex-lb.',
							sourcePath: "kickoff-prompts.md",
						},
					],
				},
				{
					id: "coordinator-prompt",
					title: "Master Coordinator Prompt",
					sourcePath: "coordinator-prompt.md",
					prompts: [
						{
							id: "master-coordinator-prompt",
							title: "Master Coordinator Prompt",
							content:
								"You are the coordinator for full Python->Rust replacement in /home/deadpool/Documents/codex-lb.",
							sourcePath: "coordinator-prompt.md",
						},
					],
				},
			],
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
			projectPath: null,
			createdAt: new Date("2026-04-08T06:58:03Z").toISOString(),
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
			promptBundles: [],
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

function normalizeProjectUrl(
	value: unknown,
): { ok: true; value: string | null } | { ok: false; code: "invalid_project_url"; message: string } {
	if (value == null) {
		return { ok: true, value: null };
	}
	const normalized = String(value).trim();
	if (!normalized) {
		return { ok: true, value: null };
	}
	if (normalized.length > 2048) {
		return {
			ok: false,
			code: "invalid_project_url",
			message: "Project URL must be 2048 characters or fewer",
		};
	}
	try {
		const url = new URL(
			/^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`,
		);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return {
				ok: false,
				code: "invalid_project_url",
				message: "Project URL must be a valid http/https URL",
			};
		}
		return { ok: true, value: url.toString() };
	} catch {
		return {
			ok: false,
			code: "invalid_project_url",
			message: "Project URL must be a valid http/https URL",
		};
	}
}

function normalizeProjectGithubRepoUrl(
	value: unknown,
<<<<<<< Updated upstream
): { ok: true; value: string | null } | {
	ok: false;
	code: "invalid_project_github_repo_url";
	message: string;
} {
=======
): { ok: true; value: string | null } | { ok: false; code: "invalid_project_github_repo_url"; message: string } {
>>>>>>> Stashed changes
	if (value == null) {
		return { ok: true, value: null };
	}
	const normalized = String(value).trim();
	if (!normalized) {
		return { ok: true, value: null };
	}
	if (normalized.length > 2048) {
		return {
			ok: false,
			code: "invalid_project_github_repo_url",
			message: "GitHub repo URL must be 2048 characters or fewer",
		};
	}
<<<<<<< Updated upstream
	const withScheme = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
	let url: URL;
	try {
		url = new URL(withScheme);
=======

	const scpMatch = /^(?:ssh:\/\/)?git@([^:]+):(.+)$/i.exec(normalized);
	const normalizedCandidate = scpMatch
		? `https://${scpMatch[1]}/${scpMatch[2].replace(/^\/+/, "")}`
		: normalized;

	try {
		const url = new URL(
			/^https?:\/\//i.test(normalizedCandidate) ? normalizedCandidate : `https://${normalizedCandidate}`,
		);
		const host = url.hostname.toLowerCase();
		if (host !== "github.com" && host !== "www.github.com") {
			return {
				ok: false,
				code: "invalid_project_github_repo_url",
				message: "GitHub repo URL must use github.com",
			};
		}
		const pathMatch = /^\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.pathname.trim());
		if (!pathMatch) {
			return {
				ok: false,
				code: "invalid_project_github_repo_url",
				message: "GitHub repo URL must include owner and repository",
			};
		}
		return { ok: true, value: `https://github.com/${pathMatch[1]}/${pathMatch[2]}` };
>>>>>>> Stashed changes
	} catch {
		return {
			ok: false,
			code: "invalid_project_github_repo_url",
			message: "GitHub repo URL must be a valid github.com URL",
		};
	}
<<<<<<< Updated upstream
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return {
			ok: false,
			code: "invalid_project_github_repo_url",
			message: "GitHub repo URL must be a valid github.com URL",
		};
	}
	if (!["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
		return {
			ok: false,
			code: "invalid_project_github_repo_url",
			message: "GitHub repo URL must use github.com",
		};
	}
	const parts = url.pathname.split("/").filter(Boolean);
	if (parts.length < 2) {
		return {
			ok: false,
			code: "invalid_project_github_repo_url",
			message: "GitHub repo URL must include owner and repository",
		};
	}
	const owner = parts[0];
	const repo = parts[1].replace(/\.git$/i, "");
	return { ok: true, value: `https://github.com/${owner}/${repo}` };
=======
>>>>>>> Stashed changes
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

function normalizeWorkspaceName(
	value: unknown,
): { ok: true; value: string } | { ok: false; code: "invalid_workspace_name"; message: string } {
	const normalized = String(value ?? "").trim();
	if (!normalized) {
		return {
			ok: false,
			code: "invalid_workspace_name",
			message: "Workspace name is required",
		};
	}
	if (normalized.length > 128) {
		return {
			ok: false,
			code: "invalid_workspace_name",
			message: "Workspace name must be 128 characters or fewer",
		};
	}
	return { ok: true, value: normalized };
}

function normalizeWorkspaceLabel(
	value: unknown,
): { ok: true; value: string } | { ok: false; code: "invalid_workspace_label"; message: string } {
	if (value == null) {
		return { ok: true, value: "Team" };
	}
	const normalized = String(value).trim();
	if (!normalized) {
		return { ok: true, value: "Team" };
	}
	if (normalized.length > 64) {
		return {
			ok: false,
			code: "invalid_workspace_label",
			message: "Workspace label must be 64 characters or fewer",
		};
	}
	return { ok: true, value: normalized };
}

function slugifyWorkspaceName(name: string): string {
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
	return slug || "workspace";
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

let sourceControlBranches = [
	{ name: "agent/demo-source-control", isActive: true, ahead: 3, behind: 0, mergedIntoBase: false, mergeState: "ready" },
	{ name: "agent/fix-auth-refresh", isActive: false, ahead: 0, behind: 0, mergedIntoBase: true, mergeState: "merged" },
	{ name: "gx/runtime-guardrails", isActive: false, ahead: 2, behind: 1, mergedIntoBase: false, mergeState: "diverged" },
];

const sourceControlBots = [
	{
		botName: "Master Agent",
		botStatus: "active",
		runtime: "Codex",
		matchedBranch: "agent/demo-source-control",
		inSync: true,
		branchCandidates: ["agent/master-agent", "agent_master-agent", "subbranch/master-agent"],
		source: "agent",
		snapshotName: null,
		sessionCount: 0,
	},
	{
		botName: "Runtime Guardrail Bot",
		botStatus: "idle",
		runtime: "Codex",
		matchedBranch: "gx/runtime-guardrails",
		inSync: true,
		branchCandidates: ["gx/runtime-guardrails", "agent/runtime-guardrail-bot"],
		source: "agent",
		snapshotName: null,
		sessionCount: 0,
	},
	{
		botName: "Codex (admin@kozponthiusbolt.hu--dup-2)",
		botStatus: "active",
		runtime: "codex-auth snapshot session",
		matchedBranch: "dev",
		inSync: true,
		branchCandidates: ["dev", "agent/codex/admin-kozponthiusbolt-hu--dup-2"],
		source: "snapshot",
		snapshotName: "admin@kozponthiusbolt.hu--dup-2",
		sessionCount: 1,
	},
];

const sourceControlChangesByBranch: Record<string, Array<{ path: string; code: string; staged: boolean; unstaged: boolean }>> = {
	"agent/demo-source-control": [
		{ path: "apps/frontend/src/features/source-control/components/source-control-page.tsx", code: "M", staged: true, unstaged: false },
		{ path: "apps/frontend/src/features/source-control/schemas.ts", code: "M", staged: true, unstaged: false },
		{ path: "app/modules/source_control/service.py", code: "M", staged: true, unstaged: false },
		{ path: "app/modules/source_control/api.py", code: "M", staged: true, unstaged: false },
		{ path: "app/modules/source_control/schemas.py", code: "M", staged: true, unstaged: false },
	],
	"agent/fix-auth-refresh": [
		{ path: "app/core/auth/dependencies.py", code: "M", staged: true, unstaged: false },
		{ path: "apps/frontend/src/features/auth/api.ts", code: "M", staged: true, unstaged: false },
	],
	"gx/runtime-guardrails": [
		{ path: "apps/frontend/src/features/runtimes/components/runtimes-page.tsx", code: "M", staged: true, unstaged: false },
		{ path: "app/modules/accounts/codex_live_usage.py", code: "M", staged: true, unstaged: false },
	],
};

let sourceControlPullRequests = [
	{
		number: 128,
		title: "feat(source-control): simplify preview for bots and branches",
		state: "open",
		headBranch: "agent/demo-source-control",
		baseBranch: "dev",
		url: "https://github.com/recodeecom/recodee/pull/128",
		author: "recodee-bot",
		isDraft: false,
	},
	{
		number: 127,
		title: "fix(runtime): keep gx bot branch sync aligned with agent list",
		state: "open",
		headBranch: "gx/runtime-guardrails",
		baseBranch: "dev",
		url: "https://github.com/recodeecom/recodee/pull/127",
		author: "runtime-guardrail-bot",
		isDraft: true,
	},
];

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

	http.get("/api/source-control/preview", ({ request }) => {
		const url = new URL(request.url);
		const projectId = url.searchParams.get("projectId");
		const selectedProject = projectId
			? state.projects.find((project) => project.id === projectId)
			: null;

		const refreshedAt = new Date().toISOString();
		const activeBranch = selectedProject?.gitBranch ?? "agent/demo-source-control";
		return HttpResponse.json({
			repositoryRoot: selectedProject?.projectPath ?? "/home/deadpool/Documents/recodee",
			projectPath: selectedProject?.projectPath ?? null,
			activeBranch,
			baseBranch: "dev",
			dirty: true,
			refreshedAt,
			changedFiles: sourceControlChangesByBranch[activeBranch] ?? sourceControlChangesByBranch["agent/demo-source-control"] ?? [],
			commitPreview: {
				hash: "12ab34cd56ef78gh90ij",
				subject: "feat(source-control): add gx bot commit + merge preview panel",
				body: "Add source-control preview API and UI panel with bot branch sync status.",
				authorName: "recodee bot",
				authoredAt: refreshedAt,
			},
			branches: sourceControlBranches.map((branch) => ({
				...branch,
				isActive: branch.name === activeBranch,
			})),
			mergePreview: [
				{ branch: "agent/demo-source-control", mergeState: "ready", ahead: 3, behind: 0 },
				{ branch: "agent/fix-auth-refresh", mergeState: "merged", ahead: 0, behind: 0 },
				{ branch: "gx/runtime-guardrails", mergeState: "diverged", ahead: 2, behind: 1 },
			],
			worktrees: [
				{ path: "/home/deadpool/Documents/recodee", branch: "dev", isCurrent: true },
				{ path: "/home/deadpool/Documents/recodee/.omx/agent-worktrees/agent-demo-source-control", branch: "agent/demo-source-control", isCurrent: false },
			],
			gxBots: sourceControlBots,
			pullRequests: sourceControlPullRequests,
			quickActions: [
				"git status --short",
				"git log --oneline --decorate -n 8",
				"git checkout agent/demo-source-control",
				"gh pr create --fill --head agent/demo-source-control --base dev",
			],
		});
	}),

	http.get("/api/source-control/branch-details", ({ request }) => {
		const url = new URL(request.url);
		const branch = url.searchParams.get("branch") ?? "";
		const branchEntry = sourceControlBranches.find((entry) => entry.name === branch);
		if (!branchEntry) {
			return HttpResponse.json(
				{
					error: {
						code: "source_control_git_failed",
						message: `Branch not found: ${branch}`,
					},
				},
				{ status: 400 },
			);
		}

		const pullRequest = sourceControlPullRequests.find((entry) => entry.headBranch === branch) ?? null;
		const linkedBots = sourceControlBots
			.filter((bot) => bot.matchedBranch === branch)
			.map((bot) => bot.botName);

		return HttpResponse.json({
			repositoryRoot: "/home/deadpool/Documents/recodee",
			projectPath: null,
			branch,
			baseBranch: "dev",
			mergeState: branchEntry.mergeState,
			ahead: branchEntry.ahead,
			behind: branchEntry.behind,
			changedFiles: sourceControlChangesByBranch[branch] ?? [],
			linkedBots,
			pullRequest,
		});
	}),

	http.post("/api/source-control/pr/create", async ({ request }) => {
		const payload = await request.json();
		const parsed = z.object({
			projectId: z.string().nullable().optional(),
			branch: z.string().min(1),
			baseBranch: z.string().nullable().optional(),
			title: z.string().nullable().optional(),
			body: z.string().nullable().optional(),
			draft: z.boolean().optional(),
		}).safeParse(payload);
		if (!parsed.success) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_source_control_pr_payload",
						message: "Invalid create PR payload",
					},
				},
				{ status: 400 },
			);
		}

		const branch = parsed.data.branch;
		const existing = sourceControlPullRequests.find((entry) => entry.headBranch === branch);
		const nextPr = existing ?? {
			number: Math.max(120, ...sourceControlPullRequests.map((entry) => entry.number)) + 1,
			title: parsed.data.title?.trim() || `feat(source-control): create PR for ${branch}`,
			state: "open",
			headBranch: branch,
			baseBranch: parsed.data.baseBranch?.trim() || "dev",
			url: `https://github.com/recodeecom/recodee/pull/${Math.max(120, ...sourceControlPullRequests.map((entry) => entry.number)) + 1}`,
			author: "mock-bot",
			isDraft: Boolean(parsed.data.draft),
		};
		if (!existing) {
			sourceControlPullRequests = [nextPr, ...sourceControlPullRequests];
		}

		return HttpResponse.json({
			status: "created",
			branch,
			baseBranch: nextPr.baseBranch,
			pullRequest: nextPr,
			message: "Pull request created.",
		});
	}),

	http.post("/api/source-control/pr/merge", async ({ request }) => {
		const payload = await request.json();
		const parsed = z.object({
			projectId: z.string().nullable().optional(),
			branch: z.string().min(1),
			pullRequestNumber: z.number().int().positive().nullable().optional(),
			baseBranch: z.string().nullable().optional(),
			deleteBranch: z.boolean().optional(),
			squash: z.boolean().optional(),
		}).safeParse(payload);
		if (!parsed.success) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_source_control_pr_payload",
						message: "Invalid merge PR payload",
					},
				},
				{ status: 400 },
			);
		}

		const branch = parsed.data.branch;
		const matched = sourceControlPullRequests.find((entry) => entry.headBranch === branch);
		if (!matched) {
			return HttpResponse.json(
				{
					error: {
						code: "source_control_git_failed",
						message: `No open pull request found for branch: ${branch}`,
					},
				},
				{ status: 400 },
			);
		}

		sourceControlPullRequests = sourceControlPullRequests.filter((entry) => entry.headBranch !== branch);

		return HttpResponse.json({
			status: "merged",
			branch,
			pullRequestNumber: matched.number,
			message: "Pull request merged.",
		});
	}),

	http.post("/api/source-control/branch/delete", async ({ request }) => {
		const payload = await request.json();
		const parsed = z.object({
			projectId: z.string().nullable().optional(),
			branch: z.string().min(1),
		}).safeParse(payload);
		if (!parsed.success) {
			return HttpResponse.json(
				{
					error: {
						code: "invalid_source_control_delete_payload",
						message: "Invalid delete branch payload",
					},
				},
				{ status: 400 },
			);
		}

		const branch = parsed.data.branch.trim();
		const baseBranch = "dev";
		const activeBranch = "agent/demo-source-control";
		if (branch === activeBranch) {
			return HttpResponse.json(
				{
					error: {
						code: "source_control_git_failed",
						message: `Cannot delete active branch: ${branch}`,
					},
				},
				{ status: 400 },
			);
		}
		if (branch === baseBranch) {
			return HttpResponse.json(
				{
					error: {
						code: "source_control_git_failed",
						message: `Cannot delete base branch: ${branch}`,
					},
				},
				{ status: 400 },
			);
		}

		const exists = sourceControlBranches.some((entry) => entry.name === branch);
		if (!exists) {
			return HttpResponse.json(
				{
					error: {
						code: "source_control_git_failed",
						message: `Branch not found: ${branch}`,
					},
				},
				{ status: 400 },
			);
		}

		sourceControlBranches = sourceControlBranches.filter((entry) => entry.name !== branch);
		sourceControlPullRequests = sourceControlPullRequests.filter((entry) => entry.headBranch !== branch);
		delete sourceControlChangesByBranch[branch];

		return HttpResponse.json({
			status: "deleted",
			branch,
			message: "Branch deleted.",
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
		const since30d = now.getTime() - 30 * 24 * 60 * 60 * 1000;
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
		const last30dEntries = filtered.filter((entry) => new Date(entry.requestedAt).getTime() >= since30d);

		return HttpResponse.json(
			createRequestLogUsageSummary({
				last5h: sumByAccount(last5hEntries),
				last7d: sumByAccount(last7dEntries),
				last30d: sumByAccount(last30dEntries),
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

	http.get("/api/projects/plans", ({ request }) => {
		const url = new URL(request.url);
		const projectId = url.searchParams.get("projectId");
		const plans = resolveProjectScopedPlans(state, projectId);

		return HttpResponse.json({
			entries: plans.map((plan) => ({
				slug: plan.slug,
				title: plan.title,
				status: plan.status,
				createdAt: plan.createdAt,
				updatedAt: plan.updatedAt,
				summaryMarkdown: plan.summaryMarkdown,
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

	http.get("/api/projects/plans/:planSlug", ({ params, request }) => {
		const url = new URL(request.url);
		const projectId = url.searchParams.get("projectId");
		const plans = resolveProjectScopedPlans(state, projectId);
		const planSlug = String(params.planSlug);
		const plan = plans.find((entry) => entry.slug === planSlug);
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
			createdAt: plan.createdAt,
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
				promptBundles: plan.promptBundles,
			});
		}),

	http.get("/api/projects/plans/:planSlug/runtime", ({ params, request }) => {
		const url = new URL(request.url);
		const projectId = url.searchParams.get("projectId");
		const plans = resolveProjectScopedPlans(state, projectId);
		const planSlug = String(params.planSlug);
		const plan = plans.find((entry) => entry.slug === planSlug);
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

	http.get("/api/workspaces", () => {
		return HttpResponse.json({ entries: state.workspaces });
	}),

	http.post("/api/workspaces", async ({ request }) => {
		const payload = await parseJsonBody(request, WorkspaceCreatePayloadSchema);
		const nameResult = normalizeWorkspaceName(payload?.name);
		if (!nameResult.ok) {
			return HttpResponse.json(
				{
					error: {
						code: nameResult.code,
						message: nameResult.message,
					},
				},
				{ status: 400 },
			);
		}
		const labelResult = normalizeWorkspaceLabel(payload?.label);
		if (!labelResult.ok) {
			return HttpResponse.json(
				{
					error: {
						code: labelResult.code,
						message: labelResult.message,
					},
				},
				{ status: 400 },
			);
		}

		if (state.workspaces.some((entry) => entry.name === nameResult.value)) {
			return HttpResponse.json(
				{
					error: {
						code: "workspace_name_exists",
						message: "Workspace name already exists",
					},
				},
				{ status: 409 },
			);
		}

		const baseSlug = slugifyWorkspaceName(nameResult.value);
		let slugCandidate = baseSlug;
		let suffix = 1;
		while (state.workspaces.some((entry) => entry.slug === slugCandidate)) {
			suffix += 1;
			slugCandidate = `${baseSlug}-${suffix}`;
		}

		const now = new Date().toISOString();
		const created = {
			id: `workspace_${state.workspaces.length + 1}`,
			name: nameResult.value,
			slug: slugCandidate,
			label: labelResult.value,
			isActive: true,
			createdAt: now,
			updatedAt: now,
		};
		state.workspaces = state.workspaces.map((entry) => ({ ...entry, isActive: false }));
		state.workspaces = [...state.workspaces, created];
		return HttpResponse.json(created);
	}),

	http.post("/api/workspaces/:workspaceId/select", ({ params }) => {
		const workspaceId = String(params.workspaceId);
		const exists = state.workspaces.some((entry) => entry.id === workspaceId);
		if (!exists) {
			return HttpResponse.json(
				{
					error: {
						code: "workspace_not_found",
						message: "Workspace not found",
					},
				},
				{ status: 404 },
			);
		}
		state.workspaces = state.workspaces.map((entry) => ({
			...entry,
			isActive: entry.id === workspaceId,
			updatedAt: entry.id === workspaceId ? new Date().toISOString() : entry.updatedAt,
		}));
		return HttpResponse.json({ activeWorkspaceId: workspaceId });
	}),

	http.delete("/api/workspaces/:workspaceId", ({ params }) => {
		const workspaceId = String(params.workspaceId);
		const target = state.workspaces.find((entry) => entry.id === workspaceId);
		if (!target) {
			return HttpResponse.json(
				{
					error: {
						code: "workspace_not_found",
						message: "Workspace not found",
					},
				},
				{ status: 404 },
			);
		}
		if (target.isActive) {
			return HttpResponse.json(
				{
					error: {
						code: "workspace_active_delete_forbidden",
						message: "Active workspace cannot be deleted",
					},
				},
				{ status: 409 },
			);
		}
		state.workspaces = state.workspaces.filter((entry) => entry.id !== workspaceId);
		return new HttpResponse(null, { status: 204 });
	}),

	http.get("/api/projects", () => {
		const activeWorkspaceId = getActiveWorkspaceId(state);
		const entries =
			activeWorkspaceId === null
				? []
				: state.projects.filter((entry) => entry.workspaceId === activeWorkspaceId);
		return HttpResponse.json({
			entries: entries.map((entry) => ({
				id: entry.id,
				name: entry.name,
				description: entry.description,
				projectUrl: entry.projectUrl,
				githubRepoUrl: entry.githubRepoUrl,
				projectPath: entry.projectPath,
				sandboxMode: entry.sandboxMode,
				gitBranch: entry.gitBranch,
				createdAt: entry.createdAt,
				updatedAt: entry.updatedAt,
			})),
		});
	}),

	http.get("/api/projects/plan-links", () => {
		const activeWorkspaceId = getActiveWorkspaceId(state);
		const entries =
			activeWorkspaceId === null
				? []
				: state.projects.filter((entry) => entry.workspaceId === activeWorkspaceId);

		return HttpResponse.json({
			entries: entries.map((entry) => {
				const linkedPlans = state.openSpecPlans
					.filter((plan) => Boolean(plan.projectPath) && plan.projectPath === entry.projectPath)
					.sort(
						(left, right) =>
							new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
					);
				const latest = linkedPlans[0] ?? null;
				return {
					projectId: entry.id,
					planCount: linkedPlans.length,
					latestPlanSlug: latest ? latest.slug : null,
					latestPlanUpdatedAt: latest ? latest.updatedAt : null,
				};
			}),
		});
	}),

	http.post("/api/projects", async ({ request }) => {
		const payload = await parseJsonBody(request, ProjectCreatePayloadSchema);
		const name = String(payload?.name || "").trim();
		const descriptionRaw = payload?.description;
		const description =
			typeof descriptionRaw === "string" ? descriptionRaw.trim() : null;
		const projectUrlResult = normalizeProjectUrl(payload?.projectUrl);
		const githubRepoUrlResult = normalizeProjectGithubRepoUrl(payload?.githubRepoUrl);
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
		if (!projectUrlResult.ok) {
			return HttpResponse.json(
				{
					error: {
						code: projectUrlResult.code,
						message: projectUrlResult.message,
					},
				},
				{ status: 400 },
			);
		}
		if (!githubRepoUrlResult.ok) {
			return HttpResponse.json(
				{
					error: {
						code: githubRepoUrlResult.code,
						message: githubRepoUrlResult.message,
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
		const activeWorkspaceId = getActiveWorkspaceId(state);
		if (!activeWorkspaceId) {
			return HttpResponse.json(
				{
					error: {
						code: "workspace_not_found",
						message: "Workspace not found",
					},
				},
				{ status: 404 },
			);
		}
		if (
			state.projects.some(
				(entry) =>
					entry.workspaceId === activeWorkspaceId
					&& entry.name === name,
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
		if (
			projectPathResult.value
			&& state.projects.some(
				(entry) =>
					entry.workspaceId === activeWorkspaceId
					&& entry.projectPath === projectPathResult.value,
			)
		) {
			return HttpResponse.json(
				{
					error: {
						code: "project_path_exists",
						message: "Project path is already linked to another project",
					},
				},
				{ status: 409 },
			);
		}

		const now = new Date().toISOString();
		const created = {
			id: `project_${state.projects.length + 1}`,
			workspaceId: activeWorkspaceId,
			name,
			description: description || null,
			projectUrl: projectUrlResult.value,
			githubRepoUrl: githubRepoUrlResult.value,
			projectPath: projectPathResult.value,
			sandboxMode: sandboxModeResult.value,
			gitBranch: gitBranchResult.value,
			createdAt: now,
			updatedAt: now,
		};
		state.projects = [...state.projects, created];
		return HttpResponse.json({
			id: created.id,
			name: created.name,
			description: created.description,
			projectUrl: created.projectUrl,
			githubRepoUrl: created.githubRepoUrl,
			projectPath: created.projectPath,
			sandboxMode: created.sandboxMode,
			gitBranch: created.gitBranch,
			createdAt: created.createdAt,
			updatedAt: created.updatedAt,
		});
	}),

	http.put("/api/projects/:projectId", async ({ params, request }) => {
		const projectId = String(params.projectId);
		const payload = await parseJsonBody(request, ProjectUpdatePayloadSchema);
		const name = String(payload?.name || "").trim();
		const descriptionRaw = payload?.description;
		const description =
			typeof descriptionRaw === "string" ? descriptionRaw.trim() : null;
		const projectUrlResult = normalizeProjectUrl(payload?.projectUrl);
		const githubRepoUrlResult = normalizeProjectGithubRepoUrl(payload?.githubRepoUrl);
		const projectPathResult = normalizeProjectPath(payload?.projectPath);
		const sandboxModeResult = normalizeProjectSandboxMode(payload?.sandboxMode);
		const gitBranchResult = normalizeProjectGitBranch(payload?.gitBranch);
		const activeWorkspaceId = getActiveWorkspaceId(state);
		const current =
			activeWorkspaceId === null
				? undefined
				: state.projects.find(
						(entry) => entry.id === projectId && entry.workspaceId === activeWorkspaceId,
					);

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
		if (!projectUrlResult.ok) {
			return HttpResponse.json(
				{
					error: {
						code: projectUrlResult.code,
						message: projectUrlResult.message,
					},
				},
				{ status: 400 },
			);
		}
		if (!githubRepoUrlResult.ok) {
			return HttpResponse.json(
				{
					error: {
						code: githubRepoUrlResult.code,
						message: githubRepoUrlResult.message,
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
				(entry) =>
					entry.id !== projectId
					&& entry.workspaceId === current.workspaceId
					&& entry.name === name,
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
		if (
			projectPathResult.value
			&& state.projects.some(
				(entry) =>
					entry.id !== projectId
					&& entry.workspaceId === current.workspaceId
					&& entry.projectPath === projectPathResult.value,
			)
		) {
			return HttpResponse.json(
				{
					error: {
						code: "project_path_exists",
						message: "Project path is already linked to another project",
					},
				},
				{ status: 409 },
			);
		}

		const updated = {
			...current,
			name,
			description: description || null,
			projectUrl: projectUrlResult.value,
			githubRepoUrl: githubRepoUrlResult.value,
			projectPath: projectPathResult.value,
			sandboxMode: sandboxModeResult.value,
			gitBranch: gitBranchResult.value,
			updatedAt: new Date().toISOString(),
		};
		state.projects = state.projects.map((entry) =>
			entry.id === projectId ? updated : entry,
		);
		return HttpResponse.json({
			id: updated.id,
			name: updated.name,
			description: updated.description,
			projectUrl: updated.projectUrl,
			githubRepoUrl: updated.githubRepoUrl,
			projectPath: updated.projectPath,
			sandboxMode: updated.sandboxMode,
			gitBranch: updated.gitBranch,
			createdAt: updated.createdAt,
			updatedAt: updated.updatedAt,
		});
	}),

	http.post("/api/projects/:projectId/open-folder", ({ params }) => {
		const projectId = String(params.projectId);
		const activeWorkspaceId = getActiveWorkspaceId(state);
		const project =
			activeWorkspaceId == null
				? undefined
				: state.projects.find(
						(entry) => entry.id === projectId && entry.workspaceId === activeWorkspaceId,
					);
		if (!project) {
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
		if (!project.projectPath) {
			return HttpResponse.json(
				{
					error: {
						code: "project_path_required",
						message: "Project path is required before opening in an editor",
					},
				},
				{ status: 400 },
			);
		}
		return HttpResponse.json({
			status: "opened",
			projectPath: project.projectPath,
			editor: "code",
		});
	}),

	http.delete("/api/projects/:projectId", ({ params }) => {
		const projectId = String(params.projectId);
		const activeWorkspaceId = getActiveWorkspaceId(state);
		const exists = state.projects.some(
			(entry) => entry.id === projectId && entry.workspaceId === activeWorkspaceId,
		);
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
		state.projects = state.projects.filter(
			(entry) => !(entry.id === projectId && entry.workspaceId === activeWorkspaceId),
		);
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
