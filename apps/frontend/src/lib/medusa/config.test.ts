import { afterEach, describe, expect, it } from "vitest";

import { getMedusaRuntimeConfig } from "@/lib/medusa/config";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_URL = window.location.href;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  window.history.replaceState({}, "", ORIGINAL_URL);
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

    window.history.replaceState({}, "", "https://dashboard.example.com/settings");

    expect(getMedusaRuntimeConfig()).toEqual({
      backendUrl: "https://dashboard.example.com:9000",
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
});
