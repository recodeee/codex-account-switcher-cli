import test, { TestContext } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";

import { AccountService } from "../lib/accounts/account-service";
import { SnapshotEmailMismatchError } from "../lib/accounts/errors";
import { parseAuthSnapshotFile } from "../lib/accounts/auth-parser";

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildAuthPayload(email: string, options?: { accountId?: string; userId?: string }): string {
  const accountId = options?.accountId ?? "acct-1";
  const userId = options?.userId ?? "user-1";
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
        access_token: `token-${email}`,
        refresh_token: `refresh-${email}`,
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
  fn: (paths: { codexDir: string; accountsDir: string; authPath: string }) => Promise<void>,
): Promise<void> {
  const codexDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-auth-save-"));
  const accountsDir = path.join(codexDir, "accounts");
  const authPath = path.join(codexDir, "auth.json");
  await fsp.mkdir(accountsDir, { recursive: true });

  const previousEnv = {
    CODEX_AUTH_CODEX_DIR: process.env.CODEX_AUTH_CODEX_DIR,
    CODEX_AUTH_ACCOUNTS_DIR: process.env.CODEX_AUTH_ACCOUNTS_DIR,
    CODEX_AUTH_JSON_PATH: process.env.CODEX_AUTH_JSON_PATH,
    CODEX_AUTH_CURRENT_PATH: process.env.CODEX_AUTH_CURRENT_PATH,
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
    await fsp.rm(codexDir, { recursive: true, force: true });
  });

  await fn({ codexDir, accountsDir, authPath });
}

test("saveAccount blocks overwriting snapshot when existing and incoming emails differ", async (t) => {
  await withIsolatedCodexDir(t, async ({ accountsDir, authPath }) => {
    const service = new AccountService();
    const destinationPath = path.join(accountsDir, "codexina.json");

    await fsp.writeFile(destinationPath, buildAuthPayload("bia@edixai.com"), "utf8");
    await fsp.writeFile(authPath, buildAuthPayload("codexina@edixai.com"), "utf8");

    await assert.rejects(
      () => service.saveAccount("codexina"),
      (error: unknown) =>
        error instanceof SnapshotEmailMismatchError &&
        error.message.includes("bia@edixai.com") &&
        error.message.includes("codexina@edixai.com"),
    );

    const parsed = await parseAuthSnapshotFile(destinationPath);
    assert.equal(parsed.email, "bia@edixai.com");
  });
});

test("saveAccount allows force overwrite when emails differ", async (t) => {
  await withIsolatedCodexDir(t, async ({ accountsDir, authPath }) => {
    const service = new AccountService();
    const destinationPath = path.join(accountsDir, "codexina.json");

    await fsp.writeFile(destinationPath, buildAuthPayload("bia@edixai.com"), "utf8");
    await fsp.writeFile(authPath, buildAuthPayload("codexina@edixai.com"), "utf8");

    await service.saveAccount("codexina", { force: true });
    const parsed = await parseAuthSnapshotFile(destinationPath);
    assert.equal(parsed.email, "codexina@edixai.com");
  });
});

test("saveAccount still overwrites when existing snapshot belongs to same email", async (t) => {
  await withIsolatedCodexDir(t, async ({ accountsDir, authPath }) => {
    const service = new AccountService();
    const destinationPath = path.join(accountsDir, "codexina.json");

    await fsp.writeFile(destinationPath, buildAuthPayload("codexina@edixai.com"), "utf8");
    await fsp.writeFile(authPath, buildAuthPayload("codexina@edixai.com"), "utf8");

    await assert.doesNotReject(() => service.saveAccount("codexina"));
    const parsed = await parseAuthSnapshotFile(destinationPath);
    assert.equal(parsed.email, "codexina@edixai.com");
  });
});

test("saveAccount blocks overwrite when emails match but account identity differs", async (t) => {
  await withIsolatedCodexDir(t, async ({ accountsDir, authPath }) => {
    const service = new AccountService();
    const destinationPath = path.join(accountsDir, "work.json");

    await fsp.writeFile(
      destinationPath,
      buildAuthPayload("codexina@edixai.com", {
        accountId: "acct-a",
        userId: "user-a",
      }),
      "utf8",
    );
    await fsp.writeFile(
      authPath,
      buildAuthPayload("codexina@edixai.com", {
        accountId: "acct-b",
        userId: "user-a",
      }),
      "utf8",
    );

    await assert.rejects(
      () => service.saveAccount("work"),
      (error: unknown) =>
        error instanceof SnapshotEmailMismatchError &&
        error.message.includes("account:acct-a") &&
        error.message.includes("account:acct-b"),
    );
  });
});

test("inferAccountNameFromCurrentAuth returns unique suffix for same-email different account identities", async (t) => {
  await withIsolatedCodexDir(t, async ({ accountsDir, authPath }) => {
    const service = new AccountService();
    const firstSnapshotPath = path.join(accountsDir, "codexina.json");

    await fsp.writeFile(
      firstSnapshotPath,
      buildAuthPayload("codexina@edixai.com", {
        accountId: "acct-a",
        userId: "user-a",
      }),
      "utf8",
    );

    await fsp.writeFile(
      authPath,
      buildAuthPayload("codexina@edixai.com", {
        accountId: "acct-b",
        userId: "user-a",
      }),
      "utf8",
    );

    const inferred = await service.inferAccountNameFromCurrentAuth();
    assert.equal(inferred, "codexina-edixai-com");
  });
});
