import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROMPT_DISPATCH_IDLE_CLOSE_MS,
  resetPromptDispatchConnectionsForTests,
  sendPromptToAccountTerminal,
} from "@/features/sessions/terminal-dispatch";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  sentPayloads: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(payload: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("Socket is not open.");
    }
    this.sentPayloads.push(payload);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    if (this.readyState === MockWebSocket.CLOSED) {
      return;
    }
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.call(this as unknown as WebSocket, new Event("close") as CloseEvent);
  }

  emitReady(): void {
    this.readyState = MockWebSocket.OPEN;
    const event = {
      data: JSON.stringify({ type: "ready" }),
    } as MessageEvent;
    this.onmessage?.call(this as unknown as WebSocket, event);
  }

  emitErrorMessage(message: string): void {
    const event = {
      data: JSON.stringify({ type: "error", message }),
    } as MessageEvent;
    this.onmessage?.call(this as unknown as WebSocket, event);
  }
}

describe("sendPromptToAccountTerminal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    resetPromptDispatchConnectionsForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reuses a live terminal websocket and closes it only after idle timeout", async () => {
    const firstSend = sendPromptToAccountTerminal({
      accountId: "acc_alpha",
      prompt: "first prompt",
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    const socket = MockWebSocket.instances[0];
    socket.emitReady();
    await firstSend;

    expect(socket.closeCalls).toHaveLength(0);
    expect(socket.sentPayloads).toEqual([
      JSON.stringify({ type: "input", data: "first prompt\n" }),
    ]);

    await sendPromptToAccountTerminal({
      accountId: "acc_alpha",
      prompt: "second prompt",
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(socket.sentPayloads).toEqual([
      JSON.stringify({ type: "input", data: "first prompt\n" }),
      JSON.stringify({ type: "input", data: "second prompt\n" }),
    ]);

    vi.advanceTimersByTime(PROMPT_DISPATCH_IDLE_CLOSE_MS - 1);
    expect(socket.closeCalls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(socket.closeCalls).toHaveLength(1);
    expect(socket.closeCalls[0].reason).toBe("prompt-idle-timeout");
  });

  it("surfaces terminal error messages from websocket payloads", async () => {
    const sendPromise = sendPromptToAccountTerminal({
      accountId: "acc_error",
      prompt: "run diagnostics",
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    MockWebSocket.instances[0].emitErrorMessage("No codex-auth snapshot found.");

    await expect(sendPromise).rejects.toThrow("No codex-auth snapshot found.");
  });
});
