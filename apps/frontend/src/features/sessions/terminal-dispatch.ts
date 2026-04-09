const TERMINAL_CONNECT_TIMEOUT_MS = 8_000;
export const PROMPT_DISPATCH_IDLE_CLOSE_MS = 75_000;

type TerminalSocketMessage =
  | {
      type: "ready";
      accountId?: string;
      snapshotName?: string;
      cwd?: string;
      command?: string;
    }
  | {
      type: "error";
      message?: string;
      code?: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

type TerminalDispatchConnection = {
  accountId: string;
  ws: WebSocket;
  ready: Promise<void>;
  idleTimeoutId: number | null;
};

const dispatchConnectionsByAccount = new Map<string, TerminalDispatchConnection>();

export function buildTerminalWebSocketUrl(accountId: string): string {
  if (typeof window === "undefined") {
    throw new Error("Terminal prompt can only be sent from the browser.");
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/accounts/${encodeURIComponent(accountId)}/terminal/ws`;
}

function readSocketErrorMessage(message: TerminalSocketMessage): string {
  if ("message" in message && typeof message.message === "string") {
    const trimmed = message.message.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return "Terminal reported an error.";
}

function closeConnection(connection: TerminalDispatchConnection, reason: string): void {
  const current = dispatchConnectionsByAccount.get(connection.accountId);
  if (current === connection) {
    dispatchConnectionsByAccount.delete(connection.accountId);
  }
  if (connection.idleTimeoutId != null) {
    window.clearTimeout(connection.idleTimeoutId);
    connection.idleTimeoutId = null;
  }
  try {
    if (
      connection.ws.readyState === WebSocket.OPEN
      || connection.ws.readyState === WebSocket.CONNECTING
    ) {
      connection.ws.close(1000, reason);
    }
  } catch {
    // ignore close errors from already-closed sockets
  }
}

function scheduleIdleClose(connection: TerminalDispatchConnection): void {
  if (connection.idleTimeoutId != null) {
    window.clearTimeout(connection.idleTimeoutId);
  }
  connection.idleTimeoutId = window.setTimeout(() => {
    closeConnection(connection, "prompt-idle-timeout");
  }, PROMPT_DISPATCH_IDLE_CLOSE_MS);
}

function createDispatchConnection(accountId: string): TerminalDispatchConnection {
  const ws = new WebSocket(buildTerminalWebSocketUrl(accountId));

  let readySettled = false;
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((reason: Error) => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const connectTimeoutId = window.setTimeout(() => {
    if (readySettled) {
      return;
    }
    readySettled = true;
    closeConnection(connection, "connect-timeout");
    rejectReady?.(new Error("Timed out while connecting to account terminal."));
  }, TERMINAL_CONNECT_TIMEOUT_MS);

  const connection: TerminalDispatchConnection = {
    accountId,
    ws,
    ready,
    idleTimeoutId: null,
  };

  ws.onmessage = (event) => {
    let message: TerminalSocketMessage;
    try {
      message = JSON.parse(event.data as string) as TerminalSocketMessage;
    } catch {
      return;
    }

    if (message.type === "error") {
      if (!readySettled) {
        readySettled = true;
        window.clearTimeout(connectTimeoutId);
        rejectReady?.(new Error(readSocketErrorMessage(message)));
      }
      closeConnection(connection, "terminal-error");
      return;
    }

    if (message.type !== "ready") {
      return;
    }

    if (!readySettled) {
      readySettled = true;
      window.clearTimeout(connectTimeoutId);
      resolveReady?.();
    }
  };

  ws.onerror = () => {
    if (!readySettled) {
      readySettled = true;
      window.clearTimeout(connectTimeoutId);
      rejectReady?.(new Error("Unable to connect to account terminal."));
    }
    closeConnection(connection, "socket-error");
  };

  ws.onclose = () => {
    if (connection.idleTimeoutId != null) {
      window.clearTimeout(connection.idleTimeoutId);
      connection.idleTimeoutId = null;
    }
    const current = dispatchConnectionsByAccount.get(accountId);
    if (current === connection) {
      dispatchConnectionsByAccount.delete(accountId);
    }
    if (!readySettled) {
      readySettled = true;
      window.clearTimeout(connectTimeoutId);
      rejectReady?.(new Error("Terminal closed before prompt could be sent."));
    }
  };

  return connection;
}

function getOrCreateDispatchConnection(accountId: string): TerminalDispatchConnection {
  const existing = dispatchConnectionsByAccount.get(accountId);
  if (
    existing
    && (existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING)
  ) {
    return existing;
  }

  const connection = createDispatchConnection(accountId);
  dispatchConnectionsByAccount.set(accountId, connection);
  return connection;
}

export function resetPromptDispatchConnectionsForTests(): void {
  for (const connection of dispatchConnectionsByAccount.values()) {
    closeConnection(connection, "test-reset");
  }
  dispatchConnectionsByAccount.clear();
}

export async function sendPromptToAccountTerminal(args: {
  accountId: string;
  prompt: string;
}): Promise<void> {
  const prompt = args.prompt.trim();
  if (!prompt) {
    throw new Error("Prompt cannot be empty.");
  }
  const connection = getOrCreateDispatchConnection(args.accountId);
  await connection.ready;

  if (connection.ws.readyState !== WebSocket.OPEN) {
    closeConnection(connection, "socket-not-open");
    throw new Error("Terminal closed before prompt could be sent.");
  }

  try {
    connection.ws.send(JSON.stringify({ type: "input", data: `${prompt}\n` }));
  } catch {
    closeConnection(connection, "send-failed");
    throw new Error("Failed to send prompt to terminal.");
  }

  // Keep the runtime-scoped terminal alive briefly so the session is visible in
  // telemetry and follow-up prompts can reuse the same process.
  scheduleIdleClose(connection);
}
