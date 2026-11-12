import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  ApiUnavailableError,
  apiRequest,
  errorMessage,
  isRevisionConflict,
} from "../../src/api/client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("API client", () => {
  it("parses JSON, exposes the ETag revision and sends If-Match", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      expect((init?.headers as Record<string, string>)["If-Match"]).toBe('"4"');
      expect(init?.body).toBe(JSON.stringify({ ok: true }));
      return new Response(JSON.stringify({ revision: 5 }), {
        status: 200,
        headers: { etag: '"5"', "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await apiRequest<{ revision: number }>("/test", {
      method: "PUT",
      body: { ok: true },
      etag: 4,
    });
    expect(result.data.revision).toBe(5);
    expect(result.etag).toBe(5);
  });

  it("maps API errors to ApiError and detects revision conflicts", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "revision_conflict",
              message: "The document changed.",
              details: { currentRevision: 9 },
            },
          }),
          { status: 412, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    const error = await apiRequest("/test").catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(412);
    expect(error.code).toBe("revision_conflict");
    expect(error.details).toEqual({ currentRevision: 9 });
    expect(isRevisionConflict(error)).toBe(true);
    expect(errorMessage(error)).toBe("The document changed.");
  });

  it("maps network failures to ApiUnavailableError", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const error = await apiRequest("/test").catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiUnavailableError);
    expect(errorMessage(error)).toBe("The local API is not reachable.");
  });
});
