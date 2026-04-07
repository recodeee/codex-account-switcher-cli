import { getMedusaRuntimeConfig } from "@/lib/medusa/config";

export class MedusaClientError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "MedusaClientError";
    this.status = status;
    this.body = body;
  }
}

function buildStoreUrl(pathname: string): string {
  const { backendUrl } = getMedusaRuntimeConfig();
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${backendUrl}/store${normalizedPath}`;
}

export async function medusaStoreFetch<T>(
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const { publishableKey } = getMedusaRuntimeConfig();
  const headers = new Headers(init?.headers);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (!headers.has("Content-Type") && init?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (publishableKey && !headers.has("x-publishable-api-key")) {
    headers.set("x-publishable-api-key", publishableKey);
  }

  const response = await fetch(buildStoreUrl(pathname), {
    ...init,
    headers,
    cache: init?.cache ?? "no-store",
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new MedusaClientError(
      `Medusa request failed with status ${response.status}`,
      response.status,
      rawBody,
    );
  }

  if (!rawBody) {
    return undefined as T;
  }

  return JSON.parse(rawBody) as T;
}

