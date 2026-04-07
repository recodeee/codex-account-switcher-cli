const DEFAULT_MEDUSA_BACKEND_URL = "http://localhost:9000";

export type MedusaRuntimeConfig = {
  backendUrl: string;
  publishableKey: string | null;
};

function normalizeUrl(value?: string): string {
  const candidate = value?.trim();
  if (!candidate) {
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

