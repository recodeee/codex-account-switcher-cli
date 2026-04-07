import { create } from "zustand";

const THEME_STORAGE_KEY = "codex-lb-theme";
const LIGHT_BACKGROUND_COLOR = "#f8f9fb";
const DARK_BACKGROUND_COLOR = "#0f1118";

export type ThemePreference = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

/** @deprecated Use ThemePreference instead */
export type Theme = ResolvedTheme;

type ThemeState = {
  preference: ThemePreference;
  /** The resolved (effective) theme — always "light" | "dark". */
  theme: ResolvedTheme;
  initialized: boolean;
  initializeTheme: () => void;
  setTheme: (pref: ThemePreference) => void;
};

function applyThemeToDocument(theme: ResolvedTheme): void {
  if (typeof document === "undefined") {
    return;
  }
  const isDark = theme === "dark";
  const backgroundColor = isDark
    ? DARK_BACKGROUND_COLOR
    : LIGHT_BACKGROUND_COLOR;

  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  document.documentElement.style.backgroundColor = backgroundColor;

  if (document.body) {
    document.body.style.backgroundColor = backgroundColor;
  }
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "auto") return getSystemTheme();
  return preference;
}

function readStoredPreference(): ThemePreference | null {
  if (typeof window === "undefined") {
    return null;
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "auto") {
    return stored;
  }
  return null;
}

let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

function setupSystemThemeListener() {
  cleanupSystemThemeListener();
  if (typeof window === "undefined") return;
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaListener = () => {
    const state = useThemeStore.getState();
    if (state.preference === "auto") {
      const resolved = getSystemTheme();
      applyThemeToDocument(resolved);
      useThemeStore.setState({ theme: resolved });
    }
  };
  mediaQuery.addEventListener("change", mediaListener);
}

function cleanupSystemThemeListener() {
  if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener("change", mediaListener);
  }
  mediaQuery = null;
  mediaListener = null;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: "auto",
  theme: "light",
  initialized: false,
  initializeTheme: () => {
    const preference = readStoredPreference() ?? "auto";
    const resolved = resolveTheme(preference);
    applyThemeToDocument(resolved);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
    set({ preference, theme: resolved, initialized: true });
    if (preference === "auto") {
      setupSystemThemeListener();
    }
  },
  setTheme: (pref) => {
    const resolved = resolveTheme(pref);
    applyThemeToDocument(resolved);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, pref);
    }
    set({ preference: pref, theme: resolved, initialized: true });
    if (pref === "auto") {
      setupSystemThemeListener();
    } else {
      cleanupSystemThemeListener();
    }
  },
}));
