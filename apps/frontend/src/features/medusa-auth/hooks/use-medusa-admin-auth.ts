import { create } from "zustand";

import {
  confirmMedusaAdminSecondFactorSetup,
  disableMedusaAdminSecondFactor,
  getMedusaAdminSecondFactorStatus,
  getMedusaAdminUser,
  loginMedusaAdmin,
  startMedusaAdminSecondFactorSetup,
  verifyMedusaAdminSecondFactor,
} from "@/features/medusa-auth/api";
import type { MedusaAdminSecondFactorStatus, MedusaAdminUser } from "@/features/medusa-auth/schemas";
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
  lastAuthenticatedEmail: string | null;
  pendingToken: string | null;
  pendingUser: MedusaAdminUser | null;
  secondFactorStatus: MedusaAdminSecondFactorStatus | null;
  challengeRequired: boolean;
  setupSecret: string | null;
  setupQrDataUri: string | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  refreshSecondFactorStatus: () => Promise<MedusaAdminSecondFactorStatus | null>;
  verifySecondFactor: (code: string) => Promise<void>;
  beginSecondFactorSetup: () => Promise<void>;
  confirmSecondFactorSetup: (code: string) => Promise<void>;
  disableSecondFactor: (code: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
};

const clearedSecondFactorState = {
  pendingToken: null,
  pendingUser: null,
  secondFactorStatus: null,
  challengeRequired: false,
  setupSecret: null,
  setupQrDataUri: null,
} satisfies Partial<MedusaAdminAuthState>;

export const useMedusaAdminAuthStore = create<MedusaAdminAuthState>((set, get) => ({
  token: null,
  user: null,
  lastAuthenticatedEmail: null,
  pendingToken: null,
  pendingUser: null,
  secondFactorStatus: null,
  challengeRequired: false,
  setupSecret: null,
  setupQrDataUri: null,
  loading: false,
  error: null,
  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const token = await loginMedusaAdmin({ email, password });
      const user = await getMedusaAdminUser(token);
      const secondFactorStatus = await getMedusaAdminSecondFactorStatus(user.email);

      if (secondFactorStatus.totpEnabled) {
        set({
          token: null,
          user: null,
          lastAuthenticatedEmail: email.trim().toLowerCase(),
          pendingToken: token,
          pendingUser: user,
          secondFactorStatus,
          challengeRequired: true,
          setupSecret: null,
          setupQrDataUri: null,
          error: null,
        });
        return;
      }

      set({
        token,
        user,
        lastAuthenticatedEmail: email.trim().toLowerCase(),
        pendingToken: null,
        pendingUser: null,
        secondFactorStatus,
        challengeRequired: false,
        setupSecret: null,
        setupQrDataUri: null,
        error: null,
      });
    } catch (error) {
      set({ error: getErrorMessage(error) });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
  refreshSecondFactorStatus: async () => {
    const email = get().user?.email;
    if (!email) {
      set({ secondFactorStatus: null });
      return null;
    }

    set({ loading: true, error: null });
    try {
      const secondFactorStatus = await getMedusaAdminSecondFactorStatus(email);
      set({ secondFactorStatus, error: null });
      return secondFactorStatus;
    } catch (error) {
      set({ error: getErrorMessage(error) });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
  verifySecondFactor: async (code) => {
    const { pendingToken, pendingUser, secondFactorStatus } = get();
    if (!pendingToken || !pendingUser) {
      throw new Error("No pending Medusa admin session to verify.");
    }

    set({ loading: true, error: null });
    try {
      await verifyMedusaAdminSecondFactor({
        email: pendingUser.email,
        code: code.trim(),
      });
      set({
        token: pendingToken,
        user: pendingUser,
        lastAuthenticatedEmail: get().lastAuthenticatedEmail ?? pendingUser.email,
        pendingToken: null,
        pendingUser: null,
        secondFactorStatus:
          secondFactorStatus ?? { email: pendingUser.email, totpEnabled: true },
        challengeRequired: false,
        error: null,
      });
    } catch (error) {
      set({ error: getErrorMessage(error) });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
  beginSecondFactorSetup: async () => {
    const email = get().user?.email;
    if (!email) {
      throw new Error("Sign in to a Medusa admin account before enabling second factor.");
    }

    set({ loading: true, error: null });
    try {
      const setup = await startMedusaAdminSecondFactorSetup(email);
      set({
        secondFactorStatus: { email: setup.email, totpEnabled: setup.totpEnabled },
        setupSecret: setup.secret,
        setupQrDataUri: setup.qrSvgDataUri,
        error: null,
      });
    } catch (error) {
      set({ error: getErrorMessage(error) });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
  confirmSecondFactorSetup: async (code) => {
    const { user, setupSecret } = get();
    if (!user?.email || !setupSecret) {
      throw new Error("No pending Medusa admin second-factor setup to confirm.");
    }

    set({ loading: true, error: null });
    try {
      await confirmMedusaAdminSecondFactorSetup({
        email: user.email,
        secret: setupSecret,
        code: code.trim(),
      });
      set({
        secondFactorStatus: { email: user.email, totpEnabled: true },
        setupSecret: null,
        setupQrDataUri: null,
        error: null,
      });
    } catch (error) {
      set({ error: getErrorMessage(error) });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
  disableSecondFactor: async (code) => {
    const email = get().user?.email;
    if (!email) {
      throw new Error("No authenticated Medusa admin session to disable second factor for.");
    }

    set({ loading: true, error: null });
    try {
      await disableMedusaAdminSecondFactor({ email, code: code.trim() });
      set({
        secondFactorStatus: { email, totpEnabled: false },
        setupSecret: null,
        setupQrDataUri: null,
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
    set((state) => ({ token: null, user: null, lastAuthenticatedEmail: state.lastAuthenticatedEmail, error: null, ...clearedSecondFactorState }));
  },
  clearError: () => {
    set({ error: null });
  },
}));
