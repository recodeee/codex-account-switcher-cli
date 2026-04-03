import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AccountTerminalDialog,
} from "@/features/dashboard/components/account-terminal-dialog";
import { resolveTerminalConstructor } from "@/features/dashboard/components/terminal-constructor";
import { createAccountSummary } from "@/test/mocks/factories";

const { fitMock, terminalState } = vi.hoisted(() => ({
  fitMock: vi.fn(),
  terminalState: {
    instances: [] as unknown[],
    throwOnConstruct: false,
  },
}));

vi.mock("@xterm/xterm", () => ({
  default: {
    Terminal: class {
      cols = 120;
      rows = 36;
      loadAddon = vi.fn();
      open = vi.fn();
      focus = vi.fn();
      writeln = vi.fn();
      write = vi.fn();
      dispose = vi.fn();
      onData = vi.fn(() => ({ dispose: vi.fn() }));

      constructor() {
        if (terminalState.throwOnConstruct) {
          throw new Error("terminal init failed");
        }
        terminalState.instances.push(this);
      }
    },
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = fitMock;
  },
}));

const websocketInstances: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    websocketInstances.push(this);
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }
}

describe("AccountTerminalDialog", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  beforeEach(() => {
    terminalState.instances.length = 0;
    websocketInstances.length = 0;
    terminalState.throwOnConstruct = false;
    fitMock.mockReset();

    vi.stubGlobal("WebSocket", MockWebSocket);
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn() as unknown as typeof window.cancelAnimationFrame;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("initializes terminal from default-export module shape and connects websocket", async () => {
    const account = createAccountSummary({
      accountId: "account/with spaces",
      email: "admin@edixai.com",
    });

    render(
      <AccountTerminalDialog
        open
        account={account}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Codex Terminal")).toBeInTheDocument();
    expect(screen.getByText(`Account: ${account.email}`)).toBeInTheDocument();
    expect(screen.getByTestId("account-terminal-host").className).toContain("bg-[#050b14]");

    await waitFor(() => {
      expect(terminalState.instances.length).toBeGreaterThan(0);
    });

    const terminal = terminalState.instances.at(-1) as { writeln: ReturnType<typeof vi.fn> };
    expect(terminal.writeln).toHaveBeenCalledWith(
      `Connecting terminal for ${account.email}...`,
    );

    expect(websocketInstances.length).toBeGreaterThan(0);
    expect(websocketInstances.at(-1)?.url).toBe(
      `ws://${window.location.host}/api/accounts/${encodeURIComponent(account.accountId)}/terminal/ws`,
    );
  });

  it("shows a visible init error when terminal construction fails", async () => {
    terminalState.throwOnConstruct = true;
    const account = createAccountSummary({ email: "broken@edixai.com" });

    render(
      <AccountTerminalDialog
        open
        account={account}
        onOpenChange={vi.fn()}
      />,
    );

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Terminal failed to initialize");
    expect(websocketInstances).toHaveLength(0);
  });
});

describe("resolveTerminalConstructor", () => {
  it("resolves constructors from direct and nested default module shapes", () => {
    class DirectTerminal {}
    class NestedTerminal {}

    expect(resolveTerminalConstructor({ Terminal: DirectTerminal })).toBe(
      DirectTerminal,
    );
    expect(resolveTerminalConstructor({ default: { Terminal: NestedTerminal } })).toBe(
      NestedTerminal,
    );
    expect(resolveTerminalConstructor({})).toBeNull();
  });
});
