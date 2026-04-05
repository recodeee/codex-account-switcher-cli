import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { get } from "@/lib/api-client";

describe("api-client request timeout", () => {
  it("throws ApiError with request_timeout when fetch does not respond", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });

    try {
      const promise = get("/api/slow", z.object({ ok: z.boolean() }));
      const assertion = expect(promise).rejects.toMatchObject({
        name: "ApiError",
        code: "request_timeout",
        status: 0,
      });
      await vi.advanceTimersByTimeAsync(15_001);
      await assertion;
    } finally {
      fetchSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
