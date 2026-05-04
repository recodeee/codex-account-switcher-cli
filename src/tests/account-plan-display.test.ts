import test from "node:test";
import assert from "node:assert/strict";

import { formatAccountType } from "../lib/accounts/plan-display";

test("formatAccountType renders known ChatGPT seat tiers", () => {
  assert.equal(formatAccountType("plus"), "ChatGPT seat (Plus)");
  assert.equal(formatAccountType("team"), "ChatGPT seat (Business)");
  assert.equal(formatAccountType("business"), "ChatGPT seat (Business)");
  assert.equal(formatAccountType("pro"), "ChatGPT seat (Pro)");
  assert.equal(formatAccountType("max"), "ChatGPT seat (Max)");
});

test("formatAccountType renders Codex usage-based plans", () => {
  assert.equal(formatAccountType("usage_based"), "Usage based (Codex)");
  assert.equal(formatAccountType("codex-usage-based"), "Usage based (Codex)");
  assert.equal(formatAccountType("pay_as_you_go"), "Usage based (Codex)");
});

test("formatAccountType keeps unknown plan tiers visible", () => {
  assert.equal(formatAccountType(undefined), "-");
  assert.equal(formatAccountType(""), "-");
  assert.equal(formatAccountType("enterprise_plus"), "ChatGPT seat (Enterprise Plus)");
});
