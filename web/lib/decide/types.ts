// Mirrors the Flask API's JSON contract exactly (see app.py). Keep these in
// sync by hand - there's no shared schema between the two languages.

export type EngineId = "laya" | "gliner" | "clm_8b";

// Mirrors candidates.py's RADIUS_KM_MIN/MAX/DEFAULT_RADIUS_KM. The search
// radius is a free-form slider, not a fixed set of tiers - every
// Overpass-tuning knob on the backend is derived from this single number.
export const RADIUS_KM_MIN = 1;
export const RADIUS_KM_MAX = 50;
export const DEFAULT_RADIUS_KM = 1.5;
// Quick-pick points the slider can jump to, matching the original 3 tiers'
// values so "Local/City/Road Trip" stay meaningful presets on top of the
// slider rather than disappearing.
export const RADIUS_PRESETS_KM = [
  { km: 1.5, label: "Local" },
  { km: 5, label: "City" },
  { km: 15, label: "Road Trip" },
] as const;

export interface Candidate {
  id: string;
  name: string;
  cuisine: string;
  tags: string[];
  price: string;
  lat: number;
  lng: number;
  address: string;
  distance_km: number;
  /** Real driving distance/time from candidates._route_table(), when OSRM
   * routing succeeded - absent (not null) when it didn't, so callers fall
   * back to the straight-line distance_km. See lib/decide/distance.ts. */
  route_km?: number;
  route_min?: number;
  dims: {
    service: "fast_food" | "sit_down";
    spice: "hot" | "mild";
    setting: "patio" | "indoor";
    price: "low" | "mid" | "high";
    diet: "vegan" | "vegetarian" | "halal" | "gluten_free" | "none";
  };
  color: string;
}

export interface RankingRow {
  id: string;
  name: string;
  probability: number;
  color: string;
}

export interface EngineMeta {
  id: EngineId;
  label: string;
  score_type: "probability";
  raw_top: number | null;
  fallback_from: EngineId | null;
  latency_ms: number;
}

export interface ComparisonEntry {
  top_id?: string;
  top_name?: string;
  top_p?: number;
  winner_p?: number | null;
  latency_ms?: number;
  primary?: boolean;
  agrees?: boolean | null;
  error?: "ENGINE_UNAVAILABLE";
  reason?: string;
}

export interface Tiebreaker {
  question_id: string;
  answer: string;
  text: string;
}

export interface MediatorQuestion {
  id: string;
  prompt: string;
  // No emoji from the backend - the frontend maps (id, answer) to its own
  // lucide icon instead (see mediator-panel.tsx).
  options: { answer: string; label: string; text: string }[];
}

export interface Location {
  lat: number;
  lng: number;
  accuracy_m?: number;
}

export interface DecideRequest {
  engine: EngineId;
  dev_mode: boolean;
  partner1: { text: string; input_mode: "typed" | "voice" };
  partner2: { text: string; input_mode: "typed" | "voice" };
  location: Location | null;
  candidates: Candidate[] | null;
  source: "overture" | "osm" | "mock" | null;
  tiebreakers: Tiebreaker[];
  round: number;
  radius_km: number;
  cross_border: boolean;
}

export interface MatchResponse {
  status: "match";
  reason: "confident" | "fair_spin" | "only_option";
  confidence: number;
  source: "overture" | "osm" | "mock";
  winner: Candidate;
  ranking: RankingRow[];
  candidates: Candidate[];
  round: number;
  latency_ms: number;
  engine: EngineMeta;
  wheel_ids?: string[];
  comparison?: Record<string, ComparisonEntry>;
  /** ISO3166-1 alpha-2 country the search was scoped to, or null if it
   * couldn't be determined (or cross-border was on) - see
   * candidates.detect_country(). Purely informational; nothing in the
   * frontend currently reads it. */
  country?: string | null;
}

export interface TiebreakerResponse {
  status: "tiebreaker";
  reason: "low_confidence" | "exact_tie";
  confidence: number;
  round: number;
  rounds_left: number;
  question: MediatorQuestion;
  contenders: RankingRow[];
  candidates: Candidate[];
  source: "overture" | "osm" | "mock";
  engine: EngineMeta;
  comparison?: Record<string, ComparisonEntry>;
  country?: string | null;
}

export interface ErrorResponse {
  status: "error";
  code: string;
  message: string;
  engine_id?: string;
}

export type DecideResponse = MatchResponse | TiebreakerResponse | ErrorResponse;

export interface EngineListItem {
  id: EngineId;
  label: string;
  available: boolean;
  loaded: boolean;
  default: boolean;
  reason?: string | null;
}

export interface HealthResponse {
  model_ready: boolean;
  model_error: string | null;
  engines_loaded: EngineId[];
  ram_available_mb: number;
}

/** Places are the same shape as Candidate, just from the uncurated /api/places
 * browsing endpoint rather than the AI-curated /api/decide pool. */
export type Place = Candidate;

export interface PlacesResponse {
  places: Place[];
  source: "overture" | "osm" | "mock";
  radius_km: number;
  country?: string | null;
}
