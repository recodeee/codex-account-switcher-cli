const NAVIGATION_LOADER_SUPPRESS_UNTIL_KEY = "recodee.navigation-loader.suppress-until";
const NAVIGATION_LOADER_SUPPRESS_MS = 1_500;

function readSuppressUntil(): number | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(NAVIGATION_LOADER_SUPPRESS_UNTIL_KEY);
    if (!raw) {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      window.sessionStorage.removeItem(NAVIGATION_LOADER_SUPPRESS_UNTIL_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function markNavigationLoaderSuppressed(durationMs = NAVIGATION_LOADER_SUPPRESS_MS): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const until = Date.now() + Math.max(0, durationMs);
    window.sessionStorage.setItem(NAVIGATION_LOADER_SUPPRESS_UNTIL_KEY, String(until));
  } catch {
    // Ignore storage access failures (for example, private mode restrictions).
  }
}

export function isNavigationLoaderSuppressed(nowMs = Date.now()): boolean {
  const until = readSuppressUntil();
  if (until == null) {
    return false;
  }

  if (nowMs <= until) {
    return true;
  }

  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(NAVIGATION_LOADER_SUPPRESS_UNTIL_KEY);
    } catch {
      // Ignore cleanup failures.
    }
  }
  return false;
}
