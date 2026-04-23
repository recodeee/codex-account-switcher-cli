import test, { TestContext } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";

import { AccountService } from "../lib/accounts/account-service";
import type { RegistryData } from "../lib/accounts/types";

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildAuthPayload(
  email: string,
  options?: { accountId?: string; userId?: string; tokenSeed?: string },
): string {
  const accountId = options?.accountId ?? "acct-1";
  const userId = options?.userId ?? "user-1";
  const tokenSeed = options?.tokenSeed ?? email;
  const idTokenPayload = {
    email,
    "https://api.openai.com/auth": {
      chatgpt_account_id: accountId,
      chatgpt_user_id: userId,
      chatgpt_plan_type: "team",
    },
  };
  const idToken = `${encodeBase64Url(JSON.stringify({ alg: "none" }))}.${encodeBase64Url(
    JSON.stringify(idTokenPayload),
  )}.sig`;

  return JSON.stringify(
    {
      tokens: {
        access_token: `token-${tokenSeed}`,
        refresh_token: `refresh-${tokenSeed}`,
        id_token: idToken,
        account_id: accountId,
      },
    },
    null,
    2,
  );
}

async function withIsolatedCodexDir(
  t: TestContext,
  fn: (paths: { codexDir: string; accountsDir: string; authPath: string; registryPath: string }) => Promise<void>,
): Promise<void> {
  const codexDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-auth-list-"));
  const accountsDir = path.join(codexDir, "accounts");
  const authPath = path.join(codexDir, "auth.json");
  const registryPath = path.join(accountsDir, "registry.json");
  await fsp.mkdir(accountsDir, { recursive: true });

  const previousEnv = {
    CODEX_AUTH_CODEX_DIR: process.env.CODEX_AUTH_CODEX_DIR,
    CODEX_AUTH_ACCOUNTS_DIR: process.env.CODEX_AUTH_ACCOUNTS_DIR,
    CODEX_AUTH_JSON_PATH: process.env.CODEX_AUTH_JSON_PATH,
    CODEX_AUTH_CURRENT_PATH: process.env.CODEX_AUTH_CURRENT_PATH,
    CODEX_AUTH_SESSION_ACTIVE_OVERRIDE: process.env.CODEX_AUTH_SESSION_ACTIVE_OVERRIDE,
  };

  process.env.CODEX_AUTH_CODEX_DIR = codexDir;
  delete process.env.CODEX_AUTH_ACCOUNTS_DIR;
  delete process.env.CODEX_AUTH_JSON_PATH;
  delete process.env.CODEX_AUTH_CURRENT_PATH;

  t.after(async () => {
    process.env.CODEX_AUTH_CODEX_DIR = previousEnv.CODEX_AUTH_CODEX_DIR;
    process.env.CODEX_AUTH_ACCOUNTS_DIR = previousEnv.CODEX_AUTH_ACCOUNTS_DIR;
    process.env.CODEX_AUTH_JSON_PATH = previousEnv.CODEX_AUTH_JSON_PATH;
    process.env.CODEX_AUTH_CURRENT_PATH = previousEnv.CODEX_AUTH_CURRENT_PATH;
    process.env.CODEX_AUTH_SESSION_ACTIVE_OVERRIDE = previousEnv.CODEX_AUTH_SESSION_ACTIVE_OVERRIDE;
    await fsp.rm(codexDir, { recursive: true, force: true });
  });

  await fn({ codexDir, accountsDir, authPath, registryPath });
}

async function writeRegistry(registryPath: string, registry: RegistryData): Promise<void> {
  await fsp.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

test("listAccountMappings refreshes missing quota values from API mode", async (t) => {
  await withIsolatedCodexDir(t, async ({ accountsDir, authPath, registryPath }) => {
    const service = new AccountService();
    const futureResetAt = Math.floor(Date.now() / 1000) + 600;
    const fetchCalls: string[] = [];

    await Promise.all([
      fsp.writeFile(path.join(accountsDir, "odin@munchi.hu.json"), buildAuthPayload("odin@munchi.hu"), "utf8"),
      fsp.writeFile(path.join(accountsDir, "viktor@edixai.com.json"), buildAuthPayload("viktor@edixai.com"), "utf8"),
      fsp.writeFile(authPath, buildAuthPayload("odin@munchi.hu"), "utf8"),
      writeRegistry(registryPath, {
        version: 1,
        autoSwitch: {
          enabled: false,
          threshold5hPercent: 10,
          thresholdWeeklyPercent: 5,
        },
        api: {
          usage: true,
        },
        accounts: {
          "odin@munchi.hu": {
            name: "odin@munchi.hu",
            createdAt: new Date().toISOString(),
          },
          "viktor@edixai.com": {
            name: "viktor@edixai.com",
            createdAt: new Date().toISOString(),
            lastUsageAt: new Date().toISOString(),
            lastUsage: {
              source: "cached",
              fetchedAt: new Date().toISOString(),
              primary: { usedPercent: 0, windowMinutes: 300, resetsAt: futureResetAt },
              secondary: { usedPercent: 0, windowMinutes: 10080, resetsAt: futureResetAt },
            },
          },
        },
      }),
    ]);

    const originalFetch = global.fetch;
    global.fetch = (async (_input: unknown, init?: RequestInit) => {
      const accountId = init?.headers && typeof init.headers === "object"
        ? (init.headers as Record<string, string>)["ChatGPT-Account-Id"]
        : undefined;
      fetchCalls.push(accountId ?? "missing");
      return {
        ok: true,
        async json() {
          return {
            rate_limit: {
              primary_window: { used_percent: 17, window_minutes: 300, reset_at: futureResetAt },
              secondary_window: { used_percent: 38, window_minutes: 10080, reset_at: futureResetAt },
            },
            plan_type: "team",
          };
        },
      } as Response;
    }) as typeof global.fetch;

    t.after(() => {
      global.fetch = originalFetch;
    });

    const mappings = await service.listAccountMappings({ refreshUsage: "missing" });

    assert.deepEqual(fetchCalls, ["acct-1"]);
    assert.equal(
      mappings.find((entry) => entry.name === "odin@munchi.hu")?.remaining5hPercent,
      83,
    );
    assert.equal(
      mappings.find((entry) => entry.name === "odin@munchi.hu")?.remainingWeeklyPercent,
      62,
    );
    assert.equal(
      mappings.find((entry) => entry.name === "viktor@edixai.com")?.remaining5hPercent,
      100,
    );
  });
});

test("listAccountMappings only applies local fallback to the active account", async (t) => {
  await withIsolatedCodexDir(t, async ({ codexDir, accountsDir, authPath, registryPath }) => {
    const service = new AccountService();
    const futureResetAt = Math.floor(Date.now() / 1000) + 600;
    const sessionsDir = path.join(codexDir, "sessions", "2026", "04", "23");
    await fsp.mkdir(sessionsDir, { recursive: true });

    await Promise.all([
      fsp.writeFile(path.join(accountsDir, "odin@munchi.hu.json"), buildAuthPayload("odin@munchi.hu"), "utf8"),
      fsp.writeFile(path.join(accountsDir, "viktor@edixai.com.json"), buildAuthPayload("viktor@edixai.com"), "utf8"),
      fsp.writeFile(authPath, buildAuthPayload("odin@munchi.hu"), "utf8"),
      fsp.writeFile(path.join(codexDir, "current"), "odin@munchi.hu\n", "utf8"),
      fsp.writeFile(
        path.join(sessionsDir, "rollout-test.jsonl"),
        `${JSON.stringify({
          timestamp_ms: Date.now(),
          payload: {
            rate_limits: {
              primary_window: { used_percent: 21, window_minutes: 300, reset_at: futureResetAt },
              secondary_window: { used_percent: 44, window_minutes: 10080, reset_at: futureResetAt },
            },
          },
        })}\n`,
        "utf8",
      ),
      writeRegistry(registryPath, {
        version: 1,
        autoSwitch: {
          enabled: false,
          threshold5hPercent: 10,
          thresholdWeeklyPercent: 5,
        },
        api: {
          usage: false,
        },
        accounts: {
          "odin@munchi.hu": {
            name: "odin@munchi.hu",
            createdAt: new Date().toISOString(),
          },
          "viktor@edixai.com": {
            name: "viktor@edixai.com",
            createdAt: new Date().toISOString(),
          },
        },
      }),
    ]);

    const originalFetch = global.fetch;
    global.fetch = (async () => {
      throw new Error("fetch should not run in local-only mode");
    }) as typeof global.fetch;

    t.after(() => {
      global.fetch = originalFetch;
    });

    const mappings = await service.listAccountMappings({ refreshUsage: "missing" });

    assert.equal(
      mappings.find((entry) => entry.name === "odin@munchi.hu")?.remaining5hPercent,
      79,
    );
    assert.equal(
      mappings.find((entry) => entry.name === "odin@munchi.hu")?.remainingWeeklyPercent,
      56,
    );
    assert.equal(
      mappings.find((entry) => entry.name === "viktor@edixai.com")?.remaining5hPercent,
      undefined,
    );
    assert.equal(
      mappings.find((entry) => entry.name === "viktor@edixai.com")?.remainingWeeklyPercent,
      undefined,
    );
  });
});
