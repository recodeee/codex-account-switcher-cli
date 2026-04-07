const TERMINAL_CONNECT_TIMEOUT_MS = 8_000;

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

export function buildTerminalWebSocketUrl(accountId: string): string {
  if (typeof window === "undefined") {
    throw new Error("Terminal prompt can only be sent from the browser.");
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/accounts/${encodeURIComponent(accountId)}/terminal/ws`;
}

export async function sendPromptToAccountTerminal(args: {
  accountId: string;
  prompt: string;
}): Promise<void> {
  const prompt = args.prompt.trim();
  if (!prompt) {
    throw new Error("Prompt cannot be empty.");
  }

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(buildTerminalWebSocketUrl(args.accountId));
    let settled = false;
    let promptSent = false;
    const timeoutId = window.setTimeout(() => {
      fail("Timed out while connecting to account terminal.");
    }, TERMINAL_CONNECT_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        // ignore close errors from already-closed sockets
      }
      reject(new Error(message));
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "prompt-sent");
        }
      } catch {
        // ignore close errors from already-closed sockets
      }
      resolve();
    };

    ws.onmessage = (event) => {
      let message: TerminalSocketMessage;
      try {
        message = JSON.parse(event.data as string) as TerminalSocketMessage;
      } catch {
        return;
      }

      if (message.type === "error") {
        const rawError =
          "message" in message && typeof message.message === "string"
            ? message.message
            : "";
        const errorMessage = rawError.trim().length > 0
          ? rawError.trim()
          : "Terminal reported an error.";
        fail(errorMessage);
        return;
      }

      if (message.type !== "ready" || promptSent) {
        return;
      }

      try {
        ws.send(JSON.stringify({ type: "input", data: `${prompt}\n` }));
      } catch {
        fail("Failed to send prompt to terminal.");
        return;
      }

      promptSent = true;
      succeed();
    };

    ws.onerror = () => {
      fail("Unable to connect to account terminal.");
    };

    ws.onclose = () => {
      if (settled) {
        return;
      }
      fail(promptSent ? "Terminal closed before prompt confirmation." : "Terminal closed before prompt could be sent.");
    };
  });
}
