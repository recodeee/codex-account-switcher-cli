import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ExternalLink,
  Minimize2,
  SquareTerminal,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  AccountTerminalSurface,
  type TerminalAccountRef,
} from "@/features/dashboard/components/account-terminal-surface";
import { cn } from "@/lib/utils";
import {
  TerminalWorkspaceContext,
  type TerminalWorkspaceContextValue,
} from "@/features/dashboard/components/terminal-workspace-context";

type TerminalWindowState = TerminalAccountRef & {
  minimized: boolean;
  position: {
    x: number;
    y: number;
  };
  zIndex: number;
};

const WINDOW_OFFSET_STEP = 28;

function resolveDefaultPosition(existingCount: number) {
  const offset = existingCount % 5;
  return {
    x: 72 + offset * WINDOW_OFFSET_STEP,
    y: 88 + offset * WINDOW_OFFSET_STEP,
  };
}

function buildPopoutUrl(entry: TerminalAccountRef): string {
  const url = new URL("/terminal-popout", window.location.origin);
  url.searchParams.set("accountId", entry.accountId);
  url.searchParams.set("email", entry.email);
  return url.toString();
}

function TerminalWorkspaceLayer({
  entries,
  activeAccountId,
  onClose,
  onMinimize,
  onRestore,
  onFocus,
  onMove,
  onPopout,
}: {
  entries: TerminalWindowState[];
  activeAccountId: string | null;
  onClose: (accountId: string) => void;
  onMinimize: (accountId: string) => void;
  onRestore: (accountId: string) => void;
  onFocus: (accountId: string) => void;
  onMove: (accountId: string, position: { x: number; y: number }) => void;
  onPopout: (accountId: string) => void;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-live="polite">
      <div className="pointer-events-auto fixed top-1/2 left-2 z-[85] -translate-y-1/2">
        <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto rounded-2xl border border-slate-700/80 bg-[#0a0f1d]/95 p-2 shadow-2xl backdrop-blur">
          {entries
            .slice().sort((a, b) => b.zIndex - a.zIndex)
            .map((entry) => {
              const isActive = entry.accountId === activeAccountId;
              return (
                <button
                  key={entry.accountId}
                  type="button"
                  data-testid={`terminal-dock-item-${entry.accountId}`}
                  className={cn(
                    "group flex h-11 w-11 items-center justify-center rounded-xl border transition",
                    isActive
                      ? "border-cyan-400/70 bg-cyan-500/20 text-cyan-200"
                      : "border-slate-700/80 bg-[#111a2b] text-slate-400 hover:border-slate-500 hover:text-slate-200",
                  )}
                  title={entry.email}
                  onClick={() => {
                    if (entry.minimized) {
                      onRestore(entry.accountId);
                    } else {
                      onFocus(entry.accountId);
                    }
                  }}
                >
                  <span className="relative inline-flex">
                    <SquareTerminal className="h-5 w-5" />
                    {entry.minimized ? (
                      <span
                        className="absolute -right-1 -bottom-1 h-2 w-2 rounded-full bg-amber-400"
                        aria-hidden
                      />
                    ) : null}
                  </span>
                  <span className="sr-only">
                    {entry.minimized ? "Restore" : "Focus"} terminal for {entry.email}
                  </span>
                </button>
              );
            })}
        </div>
      </div>

      {entries
        .slice().sort((a, b) => a.zIndex - b.zIndex)
        .map((entry) => (
          <TerminalFloatingWindow
            key={entry.accountId}
            entry={entry}
            active={entry.accountId === activeAccountId}
            minimized={entry.minimized}
            onFocus={onFocus}
            onMove={onMove}
            onClose={onClose}
            onMinimize={onMinimize}
            onPopout={onPopout}
          />
        ))}
    </div>
  );
}

function TerminalFloatingWindow({
  entry,
  active,
  minimized,
  onFocus,
  onMove,
  onClose,
  onMinimize,
  onPopout,
}: {
  entry: TerminalWindowState;
  active: boolean;
  minimized: boolean;
  onFocus: (accountId: string) => void;
  onMove: (accountId: string, position: { x: number; y: number }) => void;
  onClose: (accountId: string) => void;
  onMinimize: (accountId: string) => void;
  onPopout: (accountId: string) => void;
}) {
  const windowElementRef = useRef<HTMLDivElement | null>(null);

  const handlePointerDownOnTitle = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      onFocus(entry.accountId);

      const node = windowElementRef.current;
      const width = node?.offsetWidth ?? 900;
      const height = node?.offsetHeight ?? 560;
      const margin = 12;

      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const originX = entry.position.x;
      const originY = entry.position.y;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startClientX;
        const deltaY = moveEvent.clientY - startClientY;

        const maxX = Math.max(margin, window.innerWidth - width - margin);
        const maxY = Math.max(margin, window.innerHeight - height - margin);

        onMove(entry.accountId, {
          x: Math.min(Math.max(originX + deltaX, margin), maxX),
          y: Math.min(Math.max(originY + deltaY, margin), maxY),
        });
      };

      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [entry.accountId, entry.position.x, entry.position.y, onFocus, onMove],
  );

  return (
    <section
      ref={windowElementRef}
      data-testid={`terminal-window-${entry.accountId}`}
      className={cn(
        "pointer-events-auto fixed overflow-hidden rounded-xl border border-slate-700/80 bg-[#0a0f1d] text-slate-100 shadow-2xl transition-shadow",
        active ? "shadow-cyan-500/20" : "shadow-black/45",
        minimized && "hidden",
      )}
      style={{
        left: entry.position.x,
        top: entry.position.y,
        zIndex: 70 + entry.zIndex,
        width: "min(1120px, calc(100vw - 6rem))",
      }}
      onMouseDown={() => {
        if (!minimized) {
          onFocus(entry.accountId);
        }
      }}
    >
      <div
        className="flex cursor-move items-center justify-between border-b border-slate-700/80 bg-[#141922] px-3 py-2"
        onPointerDown={handlePointerDownOnTitle}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex items-center gap-1.5 pr-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#22c55e]" />
          </div>
          <p className="truncate text-sm font-medium text-slate-100">Codex Terminal</p>
          <span className="truncate text-xs text-slate-400">{entry.email}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid={`terminal-popout-${entry.accountId}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-700/70 hover:text-slate-100"
            title="Pop out"
            onClick={() => onPopout(entry.accountId)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="sr-only">Pop out terminal</span>
          </button>
          <button
            type="button"
            data-testid={`terminal-minimize-${entry.accountId}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-700/70 hover:text-slate-100"
            title="Minimize"
            onClick={() => onMinimize(entry.accountId)}
          >
            <Minimize2 className="h-3.5 w-3.5" />
            <span className="sr-only">Minimize terminal</span>
          </button>
          <button
            type="button"
            data-testid={`terminal-close-${entry.accountId}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-200"
            title="Close"
            onClick={() => onClose(entry.accountId)}
          >
            <X className="h-3.5 w-3.5" />
            <span className="sr-only">Close terminal</span>
          </button>
        </div>
      </div>
      <AccountTerminalSurface
        account={entry}
        active={active && !minimized}
        hostTestId={`account-terminal-host-${entry.accountId}`}
        hostClassName="h-[min(72vh,680px)] min-h-[420px]"
      />
    </section>
  );
}

export function TerminalWorkspaceProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<TerminalWindowState[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);

  const zCounterRef = useRef(1);
  const entriesRef = useRef<TerminalWindowState[]>(entries);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const nextZIndex = useCallback(() => {
    zCounterRef.current += 1;
    return zCounterRef.current;
  }, []);

  const focusTerminal = useCallback(
    (accountId: string) => {
      setEntries((current) =>
        current.map((entry) =>
          entry.accountId === accountId
            ? {
                ...entry,
                zIndex: nextZIndex(),
              }
            : entry,
        ),
      );
      setActiveAccountId(accountId);
    },
    [nextZIndex],
  );

  const closeTerminal = useCallback((accountId: string) => {
    setEntries((current) => {
      const next = current.filter((entry) => entry.accountId !== accountId);
      const nextActive = next
        .filter((entry) => !entry.minimized)
        .slice().sort((a, b) => b.zIndex - a.zIndex)[0];
      setActiveAccountId(nextActive?.accountId ?? null);
      return next;
    });
  }, []);

  const openTerminal = useCallback(
    (account: TerminalAccountRef) => {
      setEntries((current) => {
        const existing = current.find((entry) => entry.accountId === account.accountId);
        if (existing) {
          return current.map((entry) =>
            entry.accountId === account.accountId
              ? {
                  ...entry,
                  email: account.email,
                  minimized: false,
                  zIndex: nextZIndex(),
                }
              : entry,
          );
        }

        return [
          ...current,
          {
            accountId: account.accountId,
            email: account.email,
            minimized: false,
            position: resolveDefaultPosition(current.length),
            zIndex: nextZIndex(),
          },
        ];
      });

      setActiveAccountId(account.accountId);
    },
    [nextZIndex],
  );

  const minimizeTerminal = useCallback((accountId: string) => {
    setEntries((current) => {
      const next = current.map((entry) =>
        entry.accountId === accountId ? { ...entry, minimized: true } : entry,
      );

      const nextActive = next
        .filter((entry) => entry.accountId !== accountId && !entry.minimized)
        .slice().sort((a, b) => b.zIndex - a.zIndex)[0];

      setActiveAccountId(nextActive?.accountId ?? null);
      return next;
    });
  }, []);

  const restoreTerminal = useCallback(
    (accountId: string) => {
      setEntries((current) =>
        current.map((entry) =>
          entry.accountId === accountId
            ? {
                ...entry,
                minimized: false,
                zIndex: nextZIndex(),
              }
            : entry,
        ),
      );
      setActiveAccountId(accountId);
    },
    [nextZIndex],
  );

  const moveTerminal = useCallback(
    (accountId: string, position: { x: number; y: number }) => {
      setEntries((current) =>
        current.map((entry) =>
          entry.accountId === accountId
            ? {
                ...entry,
                position,
              }
            : entry,
        ),
      );
    },
    [],
  );

  const popoutTerminal = useCallback(
    (accountId: string) => {
      const entry = entriesRef.current.find((item) => item.accountId === accountId);
      if (!entry) {
        return;
      }

      const popout = window.open(
        buildPopoutUrl(entry),
        "_blank",
        "popup=yes,resizable=yes,scrollbars=yes,width=1280,height=820",
      );

      if (!popout) {
        toast.error("Popup blocked. Allow popups for this site to detach terminal windows.");
        return;
      }

      closeTerminal(accountId);
    },
    [closeTerminal],
  );

  const value = useMemo<TerminalWorkspaceContextValue>(
    () => ({
      openTerminal,
    }),
    [openTerminal],
  );

  return (
    <TerminalWorkspaceContext.Provider value={value}>
      {children}
      <TerminalWorkspaceLayer
        entries={entries}
        activeAccountId={activeAccountId}
        onClose={closeTerminal}
        onMinimize={minimizeTerminal}
        onRestore={restoreTerminal}
        onFocus={focusTerminal}
        onMove={moveTerminal}
        onPopout={popoutTerminal}
      />
    </TerminalWorkspaceContext.Provider>
  );
}

