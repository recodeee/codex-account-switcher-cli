import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ensureSecureDir,
  secureWriteFile,
  SECURE_DIR_MODE,
  SECURE_FILE_MODE,
} from "../lib/io/secure-fs";

const IS_WINDOWS = process.platform === "win32";

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "authmux-secure-fs-"));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("ensureSecureDir creates a directory with 0700 perms", { skip: IS_WINDOWS }, async () => {
  await withTmpDir(async (dir) => {
    const target = path.join(dir, "nested", "subdir");
    await ensureSecureDir(target);
    const stat = await fsp.stat(target);
    assert.equal(stat.mode & 0o777, SECURE_DIR_MODE);
  });
});

test("secureWriteFile writes file with 0600 perms", { skip: IS_WINDOWS }, async () => {
  await withTmpDir(async (dir) => {
    const target = path.join(dir, "secret.json");
    await secureWriteFile(target, JSON.stringify({ x: 1 }));
    const stat = await fsp.stat(target);
    assert.equal(stat.mode & 0o777, SECURE_FILE_MODE);
    const data = await fsp.readFile(target, "utf8");
    assert.equal(data, '{"x":1}');
  });
});

test("secureWriteFile is atomic (no partial file visible on failure path)", async () => {
  await withTmpDir(async (dir) => {
    const target = path.join(dir, "atom.txt");
    await secureWriteFile(target, "first");
    await secureWriteFile(target, "second");
    const data = await fsp.readFile(target, "utf8");
    assert.equal(data, "second");

    const entries = await fsp.readdir(dir);
    const stray = entries.filter((e) => e !== "atom.txt");
    assert.deepEqual(stray, [], "no .tmp files left behind");
  });
});

test("secureWriteFile accepts Buffer input", async () => {
  await withTmpDir(async (dir) => {
    const target = path.join(dir, "buf.bin");
    await secureWriteFile(target, Buffer.from([0x00, 0xff, 0x10]));
    const data = await fsp.readFile(target);
    assert.deepEqual([...data], [0x00, 0xff, 0x10]);
  });
});
