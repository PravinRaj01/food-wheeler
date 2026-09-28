import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// api.ts reads NEXT_PUBLIC_API_URL at module load time, so it must be set
// before the module is imported.
process.env.NEXT_PUBLIC_API_URL = "http://api.test";

const { ApiError, decide, health, listEngines, listPlaces, warmEngine } = await import("./api");

function jsonResponse(body: unknown, init: Partial<Response> = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("decide", () => {
  it("posts the body to /api/decide and returns the parsed response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "match" }));
    vi.stubGlobal("fetch", fetchMock);

    const body = { engine: "laya", partner1: { text: "a", input_mode: "typed" } } as Parameters<typeof decide>[0];
    const result = await decide(body);

    expect(result).toEqual({ status: "match" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/decide",
      expect.objectContaining({ method: "POST", body: JSON.stringify(body) }),
    );
  });

  it("retries with backoff on a MODEL_LOADING error and returns the eventual success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "error", code: "MODEL_LOADING" }))
      .mockResolvedValueOnce(jsonResponse({ status: "match" }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = decide({} as Parameters<typeof decide>[0]);
    await vi.advanceTimersByTimeAsync(800);
    const result = await promise;

    expect(result).toEqual({ status: "match" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting retries and returns the last MODEL_LOADING response as-is", async () => {
    // The final attempt (attempt === maxRetries) always falls through to
    // `return data` before the trailing `throw new ApiError` - that throw
    // only exists to satisfy TypeScript's return-path check on the for loop
    // and is unreachable in practice. The caller (decide/page.tsx) already
    // handles an error-status response by toasting `message`, so this is
    // harmless - this test documents the actual behavior.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "error", code: "MODEL_LOADING" }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = decide({} as Parameters<typeof decide>[0]);
    // 3 retries: waits of 800ms, 1600ms, 2400ms between the 4 attempts.
    await vi.advanceTimersByTimeAsync(800 + 1600 + 2400);
    const result = await promise;

    expect(result).toEqual({ status: "error", code: "MODEL_LOADING" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry a non-MODEL_LOADING error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "error", code: "BAD_REQUEST" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await decide({} as Parameters<typeof decide>[0]);
    expect(result).toEqual({ status: "error", code: "BAD_REQUEST" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("listEngines", () => {
  it("returns the parsed engine list on success", async () => {
    const engines = [{ id: "laya", label: "Laya", available: true, loaded: true, default: true }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(engines)));
    expect(await listEngines()).toEqual(engines);
  });

  it("throws an ApiError on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 })));
    await expect(listEngines()).rejects.toThrow(ApiError);
  });
});

describe("health", () => {
  it("throws an ApiError on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 503 })));
    await expect(health()).rejects.toThrow(ApiError);
  });

  it("returns the parsed body on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "ok" })));
    expect(await health()).toEqual({ status: "ok" });
  });
});

describe("warmEngine", () => {
  it("posts to the engine's warm endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "laya", loaded: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await warmEngine("laya");
    expect(result).toEqual({ id: "laya", loaded: true });
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/engines/laya/warm", expect.objectContaining({ method: "POST" }));
  });
});

describe("listPlaces", () => {
  it("builds query params from the radius, location and filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ places: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listPlaces({ lat: 3.1, lng: 101.6 }, 5, { cuisine: "thai", diet: "halal" });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("radius_km")).toBe("5");
    expect(url.searchParams.get("lat")).toBe("3.1");
    expect(url.searchParams.get("lng")).toBe("101.6");
    expect(url.searchParams.get("cuisine")).toBe("thai");
    expect(url.searchParams.get("diet")).toBe("halal");
  });

  it("omits lat/lng when there is no location", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ places: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listPlaces(null, 1.5);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.has("lat")).toBe(false);
    expect(url.searchParams.has("lng")).toBe(false);
  });

  it("throws an ApiError on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 })));
    await expect(listPlaces(null, 1.5)).rejects.toThrow(ApiError);
  });
});
