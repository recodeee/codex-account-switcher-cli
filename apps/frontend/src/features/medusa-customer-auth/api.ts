import { getMedusaRuntimeConfig } from "@/lib/medusa/config";
import { MedusaClientError, medusaStoreFetch } from "@/lib/medusa/client";
import {
  MedusaAuthResponseSchema,
  MedusaCustomerLoginRequestSchema,
  MedusaCustomerResponseSchema,
  MedusaCustomerRegisterRequestSchema,
  type MedusaCustomer,
  type MedusaCustomerLoginRequest,
  type MedusaCustomerRegisterRequest,
} from "@/features/medusa-customer-auth/schemas";

export const DASHBOARD_OVERVIEW_METADATA_KEY = "codex_lb_dashboard_overview_v1";
export const DASHBOARD_OVERVIEW_METADATA_SAVED_AT_KEY =
  "codex_lb_dashboard_overview_saved_at_v1";

function buildMedusaUrl(pathname: string): string {
  const { backendUrl } = getMedusaRuntimeConfig();
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${backendUrl}${normalizedPath}`;
}

async function medusaAuthFetch(pathname: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);

  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (!headers.has("Content-Type") && init?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(buildMedusaUrl(pathname), {
    ...init,
    headers,
    cache: "no-store",
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new MedusaClientError(
      `Medusa auth request failed with status ${response.status}`,
      response.status,
      rawBody,
    );
  }

  if (!rawBody) {
    return undefined;
  }

  return JSON.parse(rawBody) as unknown;
}

function extractToken(response: unknown): string {
  const parsed = MedusaAuthResponseSchema.parse(response);

  if ("location" in parsed) {
    throw new Error("This authentication provider requires an additional redirect flow.");
  }

  return parsed.token;
}

export async function loginMedusaCustomer(
  payload: MedusaCustomerLoginRequest,
): Promise<string> {
  const validatedPayload = MedusaCustomerLoginRequestSchema.parse(payload);
  const response = await medusaAuthFetch("/auth/customer/emailpass", {
    method: "POST",
    body: JSON.stringify(validatedPayload),
  });

  return extractToken(response);
}

export async function getLoggedInMedusaCustomer(
  token: string,
): Promise<MedusaCustomer> {
  const response = await medusaStoreFetch<unknown>("/customers/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const parsed = MedusaCustomerResponseSchema.parse(response);
  return parsed.customer;
}

export async function registerMedusaCustomer(
  payload: MedusaCustomerRegisterRequest,
): Promise<string> {
  const validatedPayload = MedusaCustomerRegisterRequestSchema.parse(payload);

  const registrationTokenResponse = await medusaAuthFetch(
    "/auth/customer/emailpass/register",
    {
      method: "POST",
      body: JSON.stringify({
        email: validatedPayload.email,
        password: validatedPayload.password,
      }),
    },
  );

  const registrationToken = extractToken(registrationTokenResponse);

  await medusaStoreFetch("/customers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${registrationToken}`,
    },
    body: JSON.stringify({
      email: validatedPayload.email,
      first_name: validatedPayload.firstName,
      last_name: validatedPayload.lastName,
    }),
  });

  return loginMedusaCustomer({
    email: validatedPayload.email,
    password: validatedPayload.password,
  });
}

export async function loadMedusaCustomerDashboardOverviewState(
  token: string,
): Promise<unknown | null> {
  const response = await medusaStoreFetch<unknown>("/customers/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const parsed = MedusaCustomerResponseSchema.parse(response);
  const metadata = parsed.customer.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  return metadata[DASHBOARD_OVERVIEW_METADATA_KEY] ?? null;
}

export async function saveMedusaCustomerDashboardOverviewState(
  token: string,
  state: unknown,
): Promise<void> {
  const response = await medusaStoreFetch<unknown>("/customers/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const parsed = MedusaCustomerResponseSchema.parse(response);
  const existingMetadata =
    parsed.customer.metadata && typeof parsed.customer.metadata === "object" && !Array.isArray(parsed.customer.metadata)
      ? parsed.customer.metadata
      : {};

  const nextMetadata = {
    ...existingMetadata,
    [DASHBOARD_OVERVIEW_METADATA_KEY]: state,
    [DASHBOARD_OVERVIEW_METADATA_SAVED_AT_KEY]: new Date().toISOString(),
  };

  await medusaStoreFetch("/customers/me", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      metadata: nextMetadata,
    }),
  });
}
