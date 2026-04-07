import { create } from "zustand";

import { getMedusaAdminUser, loginMedusaAdmin } from "@/features/medusa-auth/api";
import type { MedusaAdminUser } from "@/features/medusa-auth/schemas";
import { MedusaClientError } from "@/lib/medusa/client";

function getErrorMessage(error: unknown): string {
  if (error instanceof MedusaClientError && error.body) {
    try {
      const parsed = JSON.parse(error.body) as { message?: string };
      if (parsed.message) {
        return parsed.message;
      }
    } catch {
      // no-op: fall through to generic messages.
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to authenticate with Medusa admin.";
}

type MedusaAdminAuthState = {
  token: string | null;
  user: MedusaAdminUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
};

export const useMedusaAdminAuthStore = create<MedusaAdminAuthState>((set) => ({
  token: null,
  user: null,
  loading: false,
  error: null,
  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const token = await loginMedusaAdmin({ email, password });
      const user = await getMedusaAdminUser(token);
      set({ token, user, error: null });
    } catch (error) {
      set({ error: getErrorMessage(error) });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
  logout: () => {
    set({ token: null, user: null, error: null });
  },
  clearError: () => {
    set({ error: null });
  },
}));
