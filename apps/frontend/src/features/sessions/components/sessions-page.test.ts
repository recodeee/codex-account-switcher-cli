import { describe, expect, it } from "vitest";

import { buildTerminalWebSocketUrl } from "@/features/sessions/terminal-dispatch";

describe("buildTerminalWebSocketUrl", () => {
  it("targets the account terminal websocket route", () => {
    const url = new URL(buildTerminalWebSocketUrl("acc_alpha"));

    expect(url.protocol).toBe("ws:");
    expect(url.pathname).toBe("/api/accounts/acc_alpha/terminal/ws");
  });
});
