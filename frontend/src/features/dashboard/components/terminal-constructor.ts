import type { FitAddon } from "@xterm/addon-fit";

type Disposable = { dispose: () => void };

export type XtermTerminalTheme = {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
};

export type XtermTerminalInstance = {
  cols: number;
  rows: number;
  loadAddon: (addon: FitAddon) => void;
  open: (parent: HTMLElement) => void;
  focus: () => void;
  writeln: (data: string) => void;
  write: (data: string) => void;
  onData: (callback: (data: string) => void) => Disposable;
  dispose: () => void;
};

export type XtermTerminalConstructor = new (options: {
  allowTransparency: boolean;
  convertEol: boolean;
  cursorBlink: boolean;
  cursorStyle: "block";
  cols: number;
  rows: number;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  scrollback: number;
  theme: XtermTerminalTheme;
}) => XtermTerminalInstance;

function safeGetProperty(value: unknown, key: string): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

export function resolveTerminalConstructor(
  moduleValue: unknown,
): XtermTerminalConstructor | null {
  const directTerminal = safeGetProperty(moduleValue, "Terminal");
  if (typeof directTerminal === "function") {
    return directTerminal as XtermTerminalConstructor;
  }

  const nestedDefault = safeGetProperty(moduleValue, "default");
  const nestedTerminal = safeGetProperty(nestedDefault, "Terminal");
  if (typeof nestedTerminal === "function") {
    return nestedTerminal as XtermTerminalConstructor;
  }

  if (typeof moduleValue === "function") {
    return moduleValue as XtermTerminalConstructor;
  }

  return null;
}
