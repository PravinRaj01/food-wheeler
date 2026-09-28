import type { Candidate, EngineId, Location, MatchResponse, RadiusTier, Tiebreaker, TiebreakerResponse } from "@/lib/decide/types";

export type Phase = "p1" | "handoff" | "p2" | "submitting" | "wheel" | "mediator" | "reveal";

export interface DecideState {
  phase: Phase;
  p1Text: string;
  p1Mode: "typed" | "voice";
  p2Text: string;
  p2Mode: "typed" | "voice";
  location: Location | null;
  candidates: Candidate[] | null;
  source: "osm" | "mock" | null;
  tiebreakers: Tiebreaker[];
  round: number;
  radiusTier: RadiusTier;
  engine: EngineId;
  engineLocked: boolean;
  devMode: boolean;
  lastMatch: MatchResponse | null;
  lastTiebreaker: TiebreakerResponse | null;
  errorMessage: string | null;
}

export type Action =
  | { type: "SET_P1_TEXT"; text: string; mode?: "typed" | "voice" }
  | { type: "SET_P2_TEXT"; text: string; mode?: "typed" | "voice" }
  | { type: "PASS_TO_P2" }
  | { type: "HANDOFF_DONE" }
  | { type: "SET_LOCATION"; location: Location | null }
  | { type: "SET_ENGINE"; engine: EngineId }
  | { type: "SET_RADIUS_TIER"; tier: RadiusTier }
  | { type: "SEED_CANDIDATES"; candidates: Candidate[]; source: "osm" | "mock" }
  | { type: "TOGGLE_DEV_MODE" }
  | { type: "SET_DEV_MODE"; value: boolean }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_MATCH"; response: MatchResponse }
  | { type: "SUBMIT_TIEBREAKER"; response: TiebreakerResponse }
  | { type: "SUBMIT_ERROR"; message: string }
  | { type: "ANSWER_MEDIATOR"; tiebreaker: Tiebreaker }
  | { type: "SPIN_ANYWAY" }
  | { type: "WHEEL_LANDED" }
  | { type: "RESET" };

export function initialState(engine: EngineId, devMode: boolean): DecideState {
  return {
    phase: "p1",
    p1Text: "",
    p1Mode: "typed",
    p2Text: "",
    p2Mode: "typed",
    location: null,
    candidates: null,
    source: null,
    tiebreakers: [],
    round: 0,
    radiusTier: "local",
    engine,
    engineLocked: false,
    devMode,
    lastMatch: null,
    lastTiebreaker: null,
    errorMessage: null,
  };
}

export function decideReducer(state: DecideState, action: Action): DecideState {
  switch (action.type) {
    case "SET_P1_TEXT":
      return { ...state, p1Text: action.text, p1Mode: action.mode ?? state.p1Mode };
    case "SET_P2_TEXT":
      return { ...state, p2Text: action.text, p2Mode: action.mode ?? state.p2Mode };
    case "PASS_TO_P2":
      return state.p1Text.trim() ? { ...state, phase: "handoff" } : state;
    case "HANDOFF_DONE":
      return { ...state, phase: "p2" };
    case "SET_LOCATION":
      return { ...state, location: action.location };
    case "SET_ENGINE":
      return state.engineLocked ? state : { ...state, engine: action.engine };
    case "SET_RADIUS_TIER":
      return state.engineLocked ? state : { ...state, radiusTier: action.tier, candidates: null, source: null };
    case "SEED_CANDIDATES":
      return { ...state, candidates: action.candidates, source: action.source };
    case "TOGGLE_DEV_MODE":
      return { ...state, devMode: !state.devMode };
    case "SET_DEV_MODE":
      return { ...state, devMode: action.value };
    case "SUBMIT_START":
      return { ...state, phase: "submitting", engineLocked: true, errorMessage: null };
    case "SUBMIT_MATCH":
      return {
        ...state,
        phase: "wheel",
        lastMatch: action.response,
        candidates: action.response.candidates,
        source: action.response.source,
      };
    case "SUBMIT_TIEBREAKER":
      return {
        ...state,
        phase: "mediator",
        lastTiebreaker: action.response,
        candidates: action.response.candidates,
        source: action.response.source,
      };
    case "SUBMIT_ERROR":
      return {
        ...state,
        phase: state.phase === "submitting" ? (state.round > 0 ? "mediator" : "p2") : state.phase,
        errorMessage: action.message,
      };
    case "ANSWER_MEDIATOR":
      return {
        ...state,
        tiebreakers: [...state.tiebreakers, action.tiebreaker],
        round: (state.lastTiebreaker?.round ?? state.round) + 1,
      };
    case "SPIN_ANYWAY":
      return { ...state, round: 2 };
    case "WHEEL_LANDED":
      return { ...state, phase: "reveal" };
    case "RESET":
      return {
        ...initialState(state.engine, state.devMode),
        location: state.location, // keep location permission and radius
        radiusTier: state.radiusTier, // preference across rounds
      };
    default:
      return state;
  }
}
