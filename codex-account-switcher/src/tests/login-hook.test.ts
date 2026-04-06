import test, { TestContext } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";

import {
  getLoginHookStatus,
  LOGIN_HOOK_MARK_END,
  LOGIN_HOOK_MARK_START,
  installLoginHook,
  removeLoginHook,
} from "../lib/config/login-hook";

async function withTempRcFile(
  t: TestContext,
  fn: (rcPath: string) => Promise<void>,
): Promise<void> {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-auth-hook-"));
  const rcPath = path.join(tempDir, ".bashrc");
  await fsp.writeFile(rcPath, "# test bashrc\n", "utf8");

  t.after(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  await fn(rcPath);
}

test("installLoginHook writes marker block when missing", async (t) => {
  await withTempRcFile(t, async (rcPath) => {
    const result = await installLoginHook(rcPath);
    assert.equal(result, "installed");

    const contents = await fsp.readFile(rcPath, "utf8");
    assert.ok(contents.includes(LOGIN_HOOK_MARK_START));
    assert.ok(contents.includes(LOGIN_HOOK_MARK_END));
  });
});

test("installLoginHook is idempotent", async (t) => {
  await withTempRcFile(t, async (rcPath) => {
    const first = await installLoginHook(rcPath);
    const second = await installLoginHook(rcPath);
    assert.equal(first, "installed");
    assert.equal(second, "already-installed");

    const contents = await fsp.readFile(rcPath, "utf8");
    const startCount = contents.split(LOGIN_HOOK_MARK_START).length - 1;
    assert.equal(startCount, 1);
  });
});

test("removeLoginHook removes installed marker block", async (t) => {
  await withTempRcFile(t, async (rcPath) => {
    await installLoginHook(rcPath);
    const result = await removeLoginHook(rcPath);
    assert.equal(result, "removed");

    const contents = await fsp.readFile(rcPath, "utf8");
    assert.ok(!contents.includes(LOGIN_HOOK_MARK_START));
    assert.ok(!contents.includes(LOGIN_HOOK_MARK_END));
  });
});

test("removeLoginHook returns not-installed when hook is absent", async (t) => {
  await withTempRcFile(t, async (rcPath) => {
    const result = await removeLoginHook(rcPath);
    assert.equal(result, "not-installed");
  });
});

test("getLoginHookStatus reflects installed state", async (t) => {
  await withTempRcFile(t, async (rcPath) => {
    const before = await getLoginHookStatus(rcPath);
    assert.equal(before.installed, false);
    assert.equal(before.rcPath, rcPath);

    await installLoginHook(rcPath);
    const after = await getLoginHookStatus(rcPath);
    assert.equal(after.installed, true);
    assert.equal(after.rcPath, rcPath);
  });
});
