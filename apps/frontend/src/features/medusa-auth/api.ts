import { getMedusaRuntimeConfig } from "@/lib/medusa/config";
import { MedusaClientError } from "@/lib/medusa/client";
import {
  MedusaAdminLoginRequestSchema,
  MedusaAdminLoginResponseSchema,
  MedusaAdminUserResponseSchema,
  type MedusaAdminLoginRequest,
  type MedusaAdminUser,
} from "@/features/medusa-auth/schemas";

function buildMedusaUrl(pathname: string): string {
  const { backendUrl } = getMedusaRuntimeConfig();
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${backendUrl}${normalizedPath}`;
}

async function medusaAdminFetch(pathname: string, init?: RequestInit): Promise<unknown> {
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
      `Medusa admin request failed with status ${response.status}`,
      response.status,
      rawBody,
    );
  }

  if (!rawBody) {
    return undefined;
  }

  return JSON.parse(rawBody) as unknown;
}

export async function loginMedusaAdmin(payload: MedusaAdminLoginRequest): Promise<string> {
  const validatedPayload = MedusaAdminLoginRequestSchema.parse(payload);
  const response = await medusaAdminFetch("/auth/user/emailpass", {
    method: "POST",
    body: JSON.stringify(validatedPayload),
  });

  const parsedResponse = MedusaAdminLoginResponseSchema.parse(response);

  if ("location" in parsedResponse) {
    throw new Error("Medusa authentication requires additional provider steps.");
  }

  return parsedResponse.token;
}

export async function getMedusaAdminUser(token: string): Promise<MedusaAdminUser> {
  const response = await medusaAdminFetch("/admin/users/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const parsedResponse = MedusaAdminUserResponseSchema.parse(response);
  return parsedResponse.user;
}
