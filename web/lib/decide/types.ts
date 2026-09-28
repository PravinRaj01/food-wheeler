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
  dims: {
    service: "fast_food" | "sit_down";
    spice: "hot" | "mild";
    setting: "patio" | "indoor";
    price: "low" | "mid" | "high";
    diet: "vegan" | "halal" | "gluten_free" | "none";
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
  options: { answer: string; label: string; emoji: string; text: string }[];
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
  source: "osm" | "mock" | null;
  tiebreakers: Tiebreaker[];
  round: number;
  radius_km: number;
}

export interface MatchResponse {
  status: "match";
  reason: "confident" | "fair_spin" | "only_option";
  confidence: number;
  source: "osm" | "mock";
  winner: Candidate;
  ranking: RankingRow[];
  candidates: Candidate[];
  round: number;
  latency_ms: number;
  engine: EngineMeta;
  wheel_ids?: string[];
  comparison?: Record<string, ComparisonEntry>;
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
  source: "osm" | "mock";
  engine: EngineMeta;
  comparison?: Record<string, ComparisonEntry>;
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
  source: "osm" | "mock";
  radius_km: number;
}
