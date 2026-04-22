import test from "node:test";
import assert from "node:assert/strict";
import { parseAuthSnapshotData } from "../lib/accounts/auth-parser";

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

test("parseAuthSnapshotData extracts chatgpt metadata from id_token claims", () => {
  const payload = {
    email: "ADMIN@EDIXAI.COM",
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct-1",
      chatgpt_user_id: "user-1",
      chatgpt_plan_type: "team",
    },
  };

  const idToken = `${encodeBase64Url(JSON.stringify({ alg: "none" }))}.${encodeBase64Url(
    JSON.stringify(payload),
  )}.sig`;

  const parsed = parseAuthSnapshotData({
    tokens: {
      access_token: "token-123",
      id_token: idToken,
      account_id: "acct-1",
    },
  });

  assert.equal(parsed.authMode, "chatgpt");
  assert.equal(parsed.email, "admin@edixai.com");
  assert.equal(parsed.accountId, "acct-1");
  assert.equal(parsed.userId, "user-1");
  assert.equal(parsed.planType, "team");
  assert.equal(parsed.accessToken, "token-123");
});

test("parseAuthSnapshotData detects API key mode", () => {
  const parsed = parseAuthSnapshotData({ OPENAI_API_KEY: "sk-test" });
  assert.equal(parsed.authMode, "apikey");
  assert.equal(parsed.accessToken, undefined);
});

test("parseAuthSnapshotData falls back to root/sub/default_account_id metadata when auth claim is partial", () => {
  const payload = {
    sub: "user-from-sub",
  };
  const idToken = `${encodeBase64Url(JSON.stringify({ alg: "none" }))}.${encodeBase64Url(
    JSON.stringify(payload),
  )}.sig`;

  const parsed = parseAuthSnapshotData({
    email: "Fallback@Example.com",
    chatgpt_plan_type: "plus",
    tokens: {
      access_token: "token-xyz",
      id_token: idToken,
      default_account_id: "acct-default",
    },
  });

  assert.equal(parsed.authMode, "chatgpt");
  assert.equal(parsed.email, "fallback@example.com");
  assert.equal(parsed.accountId, "acct-default");
  assert.equal(parsed.userId, "user-from-sub");
  assert.equal(parsed.planType, "plus");
  assert.equal(parsed.accessToken, "token-xyz");
});
