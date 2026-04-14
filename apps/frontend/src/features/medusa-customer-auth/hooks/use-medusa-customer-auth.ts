import { create } from "zustand";

import {
  getLoggedInMedusaCustomer,
  loginMedusaCustomer,
  registerMedusaCustomer,
} from "@/features/medusa-customer-auth/api";
import type { MedusaCustomer, MedusaCustomerRegisterRequest } from "@/features/medusa-customer-auth/schemas";
import { MedusaClientError } from "@/lib/medusa/client";
import { getMedusaRuntimeConfig } from "@/lib/medusa/config";

const MEDUSA_CUSTOMER_TOKEN_STORAGE_KEY = "codex-lb-medusa-customer-token";

function isMissingPublishableKeyError(error: unknown): boolean {
  if (!(error instanceof MedusaClientError)) {
    return false;
  }

  const body = error.body.trim().toLowerCase();
  if (!body) {
    return false;
  }

  return (
    body.includes("x-publishable-api-key")
    || body.includes("publishable api key required")
  );
}

function getErrorMessage(error: unknown): string {
  if (isMissingPublishableKeyError(error)) {
    return "Missing Medusa publishable key. Set NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY (or MEDUSA_PUBLISHABLE_KEY in dev env), restart frontend, then try again.";
  }

  if (error instanceof MedusaClientError && error.body) {
    try {
      const parsed = JSON.parse(error.body) as { message?: string };
      if (parsed.message) {
        return parsed.message;
      }
    } catch {
      // fall through to generic messages.
    }
  }

  if (error instanceof TypeError && /failed to fetch|load failed|networkerror/i.test(error.message)) {
    const { backendUrl } = getMedusaRuntimeConfig();
    return `Unable to reach Medusa backend at ${backendUrl}. Check NEXT_PUBLIC_MEDUSA_BACKEND_URL and ensure the backend is running.`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to authenticate with Medusa backend.";
}

function readStoredToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem(MEDUSA_CUSTOMER_TOKEN_STORAGE_KEY);
  const token = value?.trim();
  return token && token.length > 0 ? token : null;
}

function writeStoredToken(token: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!token) {
    window.localStorage.removeItem(MEDUSA_CUSTOMER_TOKEN_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(MEDUSA_CUSTOMER_TOKEN_STORAGE_KEY, token);
}

type MedusaCustomerAuthState = {
  token: string | null;
  customer: MedusaCustomer | null;
  initialized: boolean;
  loading: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: MedusaCustomerRegisterRequest) => Promise<void>;
  logout: () => void;
  clearError: () => void;
};

export const useMedusaCustomerAuthStore = create<MedusaCustomerAuthState>((set) => ({
  token: null,
  customer: null,
  initialized: false,
  loading: false,
  error: null,
  initialize: async () => {
    const existingToken = readStoredToken();

    if (!existingToken) {
      set({
        token: null,
        customer: null,
        error: null,
        initialized: true,
      });
      return;
    }

    set({ loading: true, error: null });
    try {
      const customer = await getLoggedInMedusaCustomer(existingToken);
      set({
        token: existingToken,
        customer,
        initialized: true,
        error: null,
      });
    } catch {
      writeStoredToken(null);
      set({
        token: null,
        customer: null,
        initialized: true,
        error: null,
      });
    } finally {
      set({ loading: false });
    }
  },
  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const token = await loginMedusaCustomer({ email, password });
      const customer = await getLoggedInMedusaCustomer(token);
      writeStoredToken(token);
      set({
        token,
        customer,
        initialized: true,
        error: null,
      });
    } catch (error) {
      set({ error: getErrorMessage(error) });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
  register: async (payload) => {
    set({ loading: true, error: null });
    try {
      const token = await registerMedusaCustomer(payload);
      const customer = await getLoggedInMedusaCustomer(token);
      writeStoredToken(token);
      set({
        token,
        customer,
        initialized: true,
        error: null,
      });
    } catch (error) {
      set({ error: getErrorMessage(error) });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
  logout: () => {
    writeStoredToken(null);
    set({
      token: null,
      customer: null,
      error: null,
      initialized: true,
    });
  },
  clearError: () => {
    set({ error: null });
  },
}));
