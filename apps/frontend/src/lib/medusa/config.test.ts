import { afterEach, describe, expect, it, vi } from "vitest";

import { getMedusaRuntimeConfig } from "@/lib/medusa/config";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("getMedusaRuntimeConfig", () => {
  it("returns localhost fallback when env vars are missing", () => {
    delete process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL;
    delete process.env.MEDUSA_BACKEND_URL;
    delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY;
    delete process.env.MEDUSA_PUBLISHABLE_KEY;

    expect(getMedusaRuntimeConfig()).toEqual({
      backendUrl: "http://localhost:9000",
      publishableKey: null,
    });
  });

  it("uses the current browser hostname for fallback backend URL", () => {
    delete process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL;
    delete process.env.MEDUSA_BACKEND_URL;
    delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY;
    delete process.env.MEDUSA_PUBLISHABLE_KEY;

    vi.stubGlobal("window", {
      location: {
        hostname: "dashboard.example.com",
        protocol: "https:",
      },
    } as unknown as Window & typeof globalThis);

    expect(getMedusaRuntimeConfig()).toEqual({
      backendUrl: "https://dashboard.example.com:9000",
      publishableKey: null,
    });
  });

  it("normalizes 0.0.0.0 browser origins back to localhost for backend fallback", () => {
    delete process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL;
    delete process.env.MEDUSA_BACKEND_URL;
    delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY;
    delete process.env.MEDUSA_PUBLISHABLE_KEY;

    vi.stubGlobal("window", {
      location: {
        hostname: "0.0.0.0",
        protocol: "http:",
      },
    } as unknown as Window & typeof globalThis);

    expect(getMedusaRuntimeConfig()).toEqual({
      backendUrl: "http://localhost:9000",
      publishableKey: null,
    });
  });

  it("prefers NEXT_PUBLIC values and trims trailing slash", () => {
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL = "https://commerce.example.com/";
    process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY = "pk_live_123";
    process.env.MEDUSA_BACKEND_URL = "http://ignored.local";
    process.env.MEDUSA_PUBLISHABLE_KEY = "pk_ignored";

    expect(getMedusaRuntimeConfig()).toEqual({
      backendUrl: "https://commerce.example.com",
      publishableKey: "pk_live_123",
    });
  });

  it("rewrites localhost env URLs to the current browser hostname for non-local access", () => {
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL = "http://localhost:9000";
    delete process.env.MEDUSA_BACKEND_URL;
    delete process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY;
    delete process.env.MEDUSA_PUBLISHABLE_KEY;

    vi.stubGlobal("window", {
      location: {
        hostname: "dashboard.example.com",
        protocol: "https:",
      },
    } as unknown as Window & typeof globalThis);

    expect(getMedusaRuntimeConfig()).toEqual({
      backendUrl: "https://dashboard.example.com:9000",
      publishableKey: null,
    });
  });
});
