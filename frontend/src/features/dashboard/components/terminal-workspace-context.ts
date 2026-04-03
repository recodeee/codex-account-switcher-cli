import { createContext, useContext } from "react";

import type { TerminalAccountRef } from "@/features/dashboard/components/account-terminal-surface";

export type TerminalWorkspaceContextValue = {
  openTerminal: (account: TerminalAccountRef) => void;
};

export const TerminalWorkspaceContext =
  createContext<TerminalWorkspaceContextValue | null>(null);

export function useTerminalWorkspace(): TerminalWorkspaceContextValue {
  const value = useContext(TerminalWorkspaceContext);
  if (!value) {
    throw new Error("useTerminalWorkspace must be used inside TerminalWorkspaceProvider");
  }
  return value;
}
