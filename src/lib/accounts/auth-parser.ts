import fsp from "node:fs/promises";
import { ParsedAuthSnapshot } from "./types";

function decodeJwtPayload(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split(".");
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asAuthObject(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!payload) return null;
  const authClaim = payload["https://api.openai.com/auth"];
  if (!authClaim || typeof authClaim !== "object") return null;
  return authClaim as Record<string, unknown>;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = asNonEmptyString(value);
    if (normalized) return normalized;
  }

  return undefined;
}

export function parseAuthSnapshotData(data: unknown): ParsedAuthSnapshot {
  if (!data || typeof data !== "object") {
    return { authMode: "unknown" };
  }

  const root = data as Record<string, unknown>;

  const apiKey = asNonEmptyString(root.OPENAI_API_KEY);
  if (apiKey) {
    return { authMode: "apikey" };
  }

  const tokens = root.tokens;
  if (!tokens || typeof tokens !== "object") {
    return { authMode: "unknown" };
  }

  const tokenRecord = tokens as Record<string, unknown>;
  const idToken = asNonEmptyString(tokenRecord.id_token);
  const payload = idToken ? decodeJwtPayload(idToken) : null;
  const authObject = asAuthObject(payload);

  const email = firstNonEmptyString(payload?.email, root.email)?.toLowerCase();
  const accountId = firstNonEmptyString(
    tokenRecord.account_id,
    tokenRecord.chatgpt_account_id,
    tokenRecord.default_account_id,
    authObject?.chatgpt_account_id,
    authObject?.account_id,
    authObject?.default_account_id,
    root.account_id,
    root.chatgpt_account_id,
  );
  const userId = firstNonEmptyString(
    authObject?.chatgpt_user_id,
    authObject?.user_id,
    payload?.sub,
    payload?.user_id,
    root.user_id,
    root.chatgpt_user_id,
  );
  const planType = firstNonEmptyString(
    authObject?.chatgpt_plan_type,
    payload?.chatgpt_plan_type,
    root.chatgpt_plan_type,
  );

  return {
    authMode: "chatgpt",
    email,
    accessToken: asNonEmptyString(tokenRecord.access_token),
    accountId,
    userId,
    planType,
  };
}

export async function parseAuthSnapshotFile(snapshotPath: string): Promise<ParsedAuthSnapshot> {
  try {
    const raw = await fsp.readFile(snapshotPath, "utf8");
    const data = JSON.parse(raw) as unknown;
    return parseAuthSnapshotData(data);
  } catch {
    return { authMode: "unknown" };
  }
}
