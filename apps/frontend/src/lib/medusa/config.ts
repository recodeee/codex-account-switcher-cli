const DEFAULT_MEDUSA_BACKEND_URL = "http://localhost:9000";
const DEFAULT_MEDUSA_BACKEND_PORT = "9000";

export type MedusaRuntimeConfig = {
  backendUrl: string;
  publishableKey: string | null;
};

function normalizeBrowserHostname(value?: string): string | null {
  const hostname = value?.trim();

  if (!hostname) {
    return null;
  }

  if (hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]") {
    return "localhost";
  }

  return hostname;
}

function isLoopbackHostname(value?: string | null): boolean {
  const hostname = value?.trim().toLowerCase();

  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

function rewriteLoopbackUrlForBrowserHost(candidate: string): string {
  if (typeof window === "undefined") {
    return candidate;
  }

  const browserHostname = normalizeBrowserHostname(window.location.hostname);
  if (!browserHostname || isLoopbackHostname(browserHostname)) {
    return candidate;
  }

  try {
    const parsed = new URL(candidate);
    if (!isLoopbackHostname(parsed.hostname)) {
      return candidate;
    }

    const rewritten = new URL(candidate);
    rewritten.protocol = window.location.protocol;
    rewritten.hostname = browserHostname;
    return rewritten.toString().replace(/\/+$/, "");
  } catch {
    return candidate;
  }
}

function normalizeUrl(value?: string): string {
  const candidate = value?.trim();
  if (!candidate) {
    if (typeof window !== "undefined") {
      const hostname = normalizeBrowserHostname(window.location.hostname);
      if (hostname) {
        const protocol = window.location.protocol === "https:" ? "https" : "http";
        return `${protocol}://${hostname}:${DEFAULT_MEDUSA_BACKEND_PORT}`;
      }
    }

    return DEFAULT_MEDUSA_BACKEND_URL;
  }
  return rewriteLoopbackUrlForBrowserHost(candidate.replace(/\/+$/, ""));
}

function normalizeOptionalValue(value?: string): string | null {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : null;
}

export function getMedusaRuntimeConfig(): MedusaRuntimeConfig {
  const backendUrl = normalizeUrl(
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? process.env.MEDUSA_BACKEND_URL,
  );
  const publishableKey = normalizeOptionalValue(
    process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? process.env.MEDUSA_PUBLISHABLE_KEY,
  );

  return {
    backendUrl,
    publishableKey,
  };
}
