import { describe, expect, it } from "vitest";

import { handlers } from "@/test/mocks/handlers";

/**
 * Structural test that ensures the MSW handler set covers every API endpoint
 * consumed by the frontend. When a new endpoint is added to an api.ts file,
 * add the corresponding method+path here so this test forces the mock handler
 * to be created at the same time.
 */

function extractHandlerPaths(): string[] {
	return handlers.map((handler) => {
		const { method, path } = handler.info;
		// Normalize: MSW stores method in uppercase, path as the string literal
		return `${String(method).toUpperCase()} ${String(path)}`;
	});
}

// All API endpoints consumed by the frontend (method + MSW path pattern).
// Parameterized segments use MSW `:param` syntax.
const EXPECTED_ENDPOINTS = [
	// health
	"GET /health",
	// dashboard
	"GET /api/dashboard/overview",
	"GET /api/dashboard/system-monitor",
	"GET /api/source-control/commit-activity",
	"GET /api/source-control/preview",
	"GET /api/source-control/branch-details",
	"POST /api/source-control/pr/create",
	"POST /api/source-control/pr/merge",
	"POST /api/source-control/branch/delete",
	"GET /api/request-logs",
	"GET /api/request-logs/options",
	"GET /api/request-logs/usage-summary",
	// accounts
	"GET /api/accounts",
	"POST /api/accounts/import",
	"POST /api/accounts/:accountId/pause",
	"POST /api/accounts/:accountId/reactivate",
	"POST /api/accounts/:accountId/use-local",
	"POST /api/accounts/:accountId/refresh-auth",
	"POST /api/accounts/:accountId/repair-snapshot",
	"GET /api/accounts/:accountId/trends",
	"DELETE /api/accounts/:accountId",
	// oauth
	"POST /api/oauth/start",
	"GET /api/oauth/status",
	"POST /api/oauth/complete",
	// auth
	"POST */auth/customer/emailpass/register",
	"POST */auth/customer/emailpass",
	"POST */store/customers",
	"GET */store/customers/me",
	"GET /api/dashboard-auth/session",
	"POST /api/dashboard-auth/password/setup",
	"POST /api/dashboard-auth/password/login",
	"POST /api/dashboard-auth/password/change",
	"DELETE /api/dashboard-auth/password",
	"POST /api/dashboard-auth/totp/setup/start",
	"POST /api/dashboard-auth/totp/setup/confirm",
	"POST /api/dashboard-auth/totp/verify",
	"POST /api/dashboard-auth/totp/disable",
	"POST /api/dashboard-auth/logout",
	// settings
	"GET /api/settings",
	"PUT /api/settings",
	"GET /api/billing",
	"PUT /api/billing",
	"POST /api/billing/accounts",
	"DELETE /api/billing/accounts",
	"GET /api/sticky-sessions",
	"POST /api/sticky-sessions/delete",
	"POST /api/sticky-sessions/purge",
	// firewall
	"GET /api/firewall/ips",
	"POST /api/firewall/ips",
	"DELETE /api/firewall/ips/:ipAddress",
	// devices
	"GET /api/devices",
	"POST /api/devices",
	"PUT /api/devices/:deviceId",
	"DELETE /api/devices/:deviceId",
	// projects
	"GET /api/projects",
	"GET /api/projects/plan-links",
	"GET /api/projects/plans",
	"GET /api/projects/plans/:planSlug",
	"GET /api/projects/plans/:planSlug/runtime",
	"POST /api/projects/plans/:planSlug/run-team",
	"POST /api/projects",
	"PUT /api/projects/:projectId",
	"DELETE /api/projects/:projectId",
	"POST /api/projects/pick-path",
	"POST /api/projects/:projectId/open-folder",
	// workspaces
	"GET /api/workspaces",
	"POST /api/workspaces",
	"POST /api/workspaces/:workspaceId/select",
	"DELETE /api/workspaces/:workspaceId",
	// models
	"GET /api/models",
	// api-keys
	"GET /api/api-keys/",
	"POST /api/api-keys/",
	"PATCH /api/api-keys/:keyId",
	"DELETE /api/api-keys/:keyId",
	"POST /api/api-keys/:keyId/regenerate",
	"GET /api/api-keys/:keyId/trends",
	"GET /api/api-keys/:keyId/usage-7d",
];

describe("MSW handler coverage", () => {
	it("covers all expected API endpoints", () => {
		const actual = new Set(extractHandlerPaths());
		const missing = EXPECTED_ENDPOINTS.filter((ep) => !actual.has(ep));
		expect(missing, "Missing MSW handlers for these endpoints").toEqual([]);
	});

	it("has no unexpected handlers outside the expected set", () => {
		const expected = new Set(EXPECTED_ENDPOINTS);
		const actual = extractHandlerPaths();
		const extra = actual.filter((ep) => !expected.has(ep));
		expect(
			extra,
			"Unexpected MSW handlers — add them to EXPECTED_ENDPOINTS",
		).toEqual([]);
	});
});
