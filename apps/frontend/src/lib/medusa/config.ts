const DEFAULT_MEDUSA_BACKEND_URL = "http://localhost:9000";
const DEFAULT_MEDUSA_BACKEND_PORT = "9000";

export type MedusaRuntimeConfig = {
  backendUrl: string;
  publishableKey: string | null;
};

function normalizeUrl(value?: string): string {
  const candidate = value?.trim();
  if (!candidate) {
    if (typeof window !== "undefined") {
      const hostname = window.location.hostname?.trim();
      if (hostname) {
        const protocol = window.location.protocol === "https:" ? "https" : "http";
        return `${protocol}://${hostname}:${DEFAULT_MEDUSA_BACKEND_PORT}`;
      }
    }

    return DEFAULT_MEDUSA_BACKEND_URL;
  }
  return candidate.replace(/\/+$/, "");
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
