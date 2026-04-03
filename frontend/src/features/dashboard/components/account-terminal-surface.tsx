import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import * as XtermModule from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import type { AccountSummary } from "@/features/dashboard/schemas";
import {
  resolveTerminalConstructor,
  type XtermTerminalInstance,
} from "@/features/dashboard/components/terminal-constructor";
import { cn } from "@/lib/utils";

type TerminalAccountRef = Pick<AccountSummary, "accountId" | "email">;

export type AccountTerminalSurfaceProps = {
  account: TerminalAccountRef;
  active?: boolean;
  className?: string;
  hostClassName?: string;
  hostTestId?: string;
};

function buildTerminalSocketUrl(accountId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${protocol}//${host}/api/accounts/${encodeURIComponent(accountId)}/terminal/ws`;
}

const TERMINAL_THEME = {
  background: "#050b14",
  foreground: "#e2e8f0",
  cursor: "#f8fafc",
  cursorAccent: "#050b14",
  selectionBackground: "rgba(148, 163, 184, 0.35)",
};

export function AccountTerminalSurface({
  account,
  active = true,
  className,
  hostClassName,
  hostTestId = "account-terminal-host",
}: AccountTerminalSurfaceProps) {
  const terminalHostElementRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XtermTerminalInstance | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const syncSizeRef = useRef<(() => void) | null>(null);
  const [hostVersion, setHostVersion] = useState(0);

  const handleTerminalHostRef = useCallback((node: HTMLDivElement | null) => {
    terminalHostElementRef.current = node;
    setHostVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }

    const fit = syncSizeRef.current;
    if (!fit) {
      return;
    }

    const raf = window.requestAnimationFrame(() => {
      fit();
      terminalRef.current?.focus();
    });

    const timeoutId = window.setTimeout(() => {
      fit();
    }, 120);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timeoutId);
    };
  }, [active]);

  useEffect(() => {
    const hostElement = terminalHostElementRef.current;
    if (!hostElement) {
      return;
    }

    hostElement.innerHTML = "";
    const renderInitError = (message: string) => {
      hostElement.innerHTML = "";
      const notice = document.createElement("p");
      notice.role = "status";
      notice.className = "px-4 py-3 text-sm text-rose-400";
      notice.textContent = message;
      hostElement.appendChild(notice);
    };

    const TerminalConstructor = resolveTerminalConstructor(XtermModule);
    if (!TerminalConstructor) {
      renderInitError("Terminal runtime failed to load. Refresh and try again.");
      return;
    }

    let terminal: XtermTerminalInstance;
    try {
      terminal = new TerminalConstructor({
        allowTransparency: false,
        convertEol: true,
        cursorBlink: true,
        cursorStyle: "block",
        cols: 120,
        rows: 36,
        fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 13,
        lineHeight: 1.28,
        scrollback: 10_000,
        theme: TERMINAL_THEME,
      });
    } catch {
      renderInitError("Terminal failed to initialize. Please reopen the terminal.");
      return;
    }

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostElement);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const socket = new WebSocket(buildTerminalSocketUrl(account.accountId));
    socketRef.current = socket;

    const syncSize = () => {
      fitAddon.fit();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "resize",
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        );
      }
    };
    syncSizeRef.current = syncSize;

    syncSize();
    const initialFitRaf = window.requestAnimationFrame(syncSize);
    const initialFitTimeout = window.setTimeout(syncSize, 120);

    terminal.focus();
    terminal.writeln(`Connecting terminal for ${account.email}...`);

    const dataDisposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    socket.onopen = () => {
      syncSize();
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as
          | { type: "output"; data: string }
          | { type: "ready"; snapshotName: string }
          | { type: "error"; message: string }
          | { type: "exit"; code: number };

        if (message.type === "output") {
          terminal.write(message.data);
          return;
        }

        if (message.type === "ready") {
          terminal.writeln(`\r\n[connected] snapshot: ${message.snapshotName}\r\n`);
          return;
        }

        if (message.type === "error") {
          terminal.writeln(`\r\n[error] ${message.message}\r\n`);
          return;
        }

        if (message.type === "exit") {
          terminal.writeln(`\r\n[session exited] code ${message.code}\r\n`);
        }
      } catch {
        terminal.write(String(event.data));
      }
    };

    socket.onerror = () => {
      terminal.writeln("\r\n[error] Terminal connection failed.\r\n");
    };

    socket.onclose = () => {
      terminal.writeln("\r\n[disconnected]\r\n");
    };

    const observer = new ResizeObserver(() => {
      syncSize();
    });
    observer.observe(hostElement);
    window.addEventListener("resize", syncSize);

    return () => {
      window.removeEventListener("resize", syncSize);
      observer.disconnect();
      window.cancelAnimationFrame(initialFitRaf);
      window.clearTimeout(initialFitTimeout);
      dataDisposable.dispose();
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1000, "terminal_closed");
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      socketRef.current = null;
      syncSizeRef.current = null;
      hostElement.innerHTML = "";
    };
  }, [account.accountId, account.email, hostVersion]);

  return (
    <div className={cn("bg-[#0a0f1d] p-3", className)}>
      <div
        data-testid={hostTestId}
        ref={handleTerminalHostRef}
        className={cn(
          "min-h-[420px] w-full overflow-hidden rounded-md border border-slate-700/80 bg-[#050b14]",
          hostClassName,
        )}
      />
    </div>
  );
}

export type { TerminalAccountRef };
