import type {
  DecideRequest,
  DecideResponse,
  EngineListItem,
  HealthResponse,
  Location,
  PlacesResponse,
} from "@/lib/decide/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

if (!API_URL && typeof window !== "undefined") {
  console.warn("NEXT_PUBLIC_API_URL is not set - API calls will fail.");
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

// Cloud Run scales to zero when idle, so a cold start plus a real Overpass
// query (up to 25s, see candidates.py) can legitimately take a while -
// these are generous on purpose. Without any timeout at all, a stalled
// connection (not an error, just silence) would leave the deciding
// animation spinning forever with no way out.
const TIMEOUT_MS = { decide: 45_000, listPlaces: 30_000, default: 10_000 } as const;

/** Combines a caller-supplied AbortSignal (if any) with an internal
 * timeout, so callers that already care about cancellation (e.g.
 * unmounting) keep working, and every call gets a hang-safety net either
 * way. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

/** POST /api/decide, with backoff retry on a 503 MODEL_LOADING response
 * (matches the retry the v1 vanilla-JS client did). */
export async function decide(body: DecideRequest, signal?: AbortSignal): Promise<DecideResponse> {
  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(`${API_URL}/api/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: withTimeout(signal, TIMEOUT_MS.decide),
    });
    const data = (await res.json()) as DecideResponse;
    if (data.status === "error" && data.code === "MODEL_LOADING" && attempt < maxRetries) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    return data;
  }
  throw new ApiError("Exhausted retries waiting for the model to load.", "MODEL_LOADING");
}

export async function listEngines(signal?: AbortSignal): Promise<EngineListItem[]> {
  const res = await fetch(`${API_URL}/api/engines`, { signal: withTimeout(signal, TIMEOUT_MS.default) });
  if (!res.ok) throw new ApiError(`Failed to load engines (${res.status})`);
  return res.json();
}

export async function warmEngine(engineId: string, signal?: AbortSignal): Promise<{ id: string; loaded: boolean; error?: string }> {
  const res = await fetch(`${API_URL}/api/engines/${engineId}/warm`, {
    method: "POST",
    headers: { "Content-Length": "0" },
    signal: withTimeout(signal, TIMEOUT_MS.default),
  });
  return res.json();
}

export async function health(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch(`${API_URL}/api/health`, { signal: withTimeout(signal, TIMEOUT_MS.default) });
  if (!res.ok) throw new ApiError(`Health check failed (${res.status})`);
  return res.json();
}

export function apiUrl(path: string) {
  return `${API_URL}${path}`;
}

export async function listPlaces(
  location: Location | null,
  radiusKm: number,
  filters?: { cuisine?: string; diet?: string },
  signal?: AbortSignal,
): Promise<PlacesResponse> {
  const params = new URLSearchParams({ radius_km: String(radiusKm) });
  if (location) {
    params.set("lat", String(location.lat));
    params.set("lng", String(location.lng));
  }
  if (filters?.cuisine) params.set("cuisine", filters.cuisine);
  if (filters?.diet) params.set("diet", filters.diet);

  const res = await fetch(`${API_URL}/api/places?${params.toString()}`, {
    signal: withTimeout(signal, TIMEOUT_MS.listPlaces),
  });
  if (!res.ok) throw new ApiError(`Failed to load places (${res.status})`);
  return res.json();
}
