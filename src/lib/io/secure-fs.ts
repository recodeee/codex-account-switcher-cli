import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const SECURE_FILE_MODE = 0o600;
export const SECURE_DIR_MODE = 0o700;

const IS_WINDOWS = process.platform === "win32";

export async function ensureSecureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true, mode: SECURE_DIR_MODE });
  if (!IS_WINDOWS) {
    try {
      await fsp.chmod(dirPath, SECURE_DIR_MODE);
    } catch {
      // best-effort; some filesystems disallow chmod
    }
  }
}

export async function secureWriteFile(filePath: string, data: string | Buffer): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  const handle = await fsp.open(tmp, "w", SECURE_FILE_MODE);
  try {
    if (typeof data === "string") {
      await handle.writeFile(data, "utf8");
    } else {
      await handle.writeFile(data);
    }
    await handle.sync().catch(() => {
      // fsync can fail on some FS; not fatal for our durability goals
    });
  } finally {
    await handle.close();
  }
  if (!IS_WINDOWS) {
    try {
      await fsp.chmod(tmp, SECURE_FILE_MODE);
    } catch {
      // ignore
    }
  }
  await fsp.rename(tmp, filePath);
  if (!IS_WINDOWS) {
    try {
      await fsp.chmod(filePath, SECURE_FILE_MODE);
    } catch {
      // ignore
    }
  }
}

export async function chmodSecureFile(filePath: string): Promise<void> {
  if (IS_WINDOWS) return;
  try {
    await fsp.chmod(filePath, SECURE_FILE_MODE);
  } catch {
    // ignore
  }
}

export async function chmodSecureDir(dirPath: string): Promise<void> {
  if (IS_WINDOWS) return;
  try {
    await fsp.chmod(dirPath, SECURE_DIR_MODE);
  } catch {
    // ignore
  }
}
