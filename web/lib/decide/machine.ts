import { DEFAULT_RADIUS_KM } from "@/lib/decide/types";
import type { Candidate, EngineId, MatchResponse, Tiebreaker, TiebreakerResponse } from "@/lib/decide/types";

export type Phase = "names" | "p1" | "handoff" | "p2" | "submitting" | "wheel" | "mediator" | "reveal";
/** The only phases a saved session snapshot can resume into - see
 * decide/page.tsx's persistence effect. Anything past "p2" depends on a
 * live server response that was never persisted, so it isn't resumable. */
export type ResumablePhase = "names" | "p1" | "p2";

export interface SessionSnapshot {
  phase: ResumablePhase;
  p1Name: string;
  p2Name: string;
  p1Text: string;
  p1Mode: "typed" | "voice";
  p2Text: string;
  p2Mode: "typed" | "voice";
  radiusKm: number;
}

export interface DecideState {
  phase: Phase;
  p1Name: string;
  p2Name: string;
  p1Text: string;
  p1Mode: "typed" | "voice";
  p2Text: string;
  p2Mode: "typed" | "voice";
  candidates: Candidate[] | null;
  source: "osm" | "mock" | null;
  tiebreakers: Tiebreaker[];
  round: number;
  radiusKm: number;
  engine: EngineId;
  engineLocked: boolean;
  devMode: boolean;
  lastMatch: MatchResponse | null;
  lastTiebreaker: TiebreakerResponse | null;
  errorMessage: string | null;
  /** False until decide/page.tsx's mount effect has attempted a restore
   * (names and/or an in-progress session snapshot) and dispatched
   * something - even a no-op MARK_HYDRATED when there was nothing to
   * restore. The session-persistence write effect gates on this via
   * state (not a ref or a second piece of component state) specifically
   * so it can never fire on the pre-restore default render and clobber a
   * real saved snapshot with blanks before the restore's own dispatch has
   * had a chance to land - a real race this app hit once already. */
  hydrated: boolean;
}

export type Action =
  | { type: "SET_NAMES"; p1Name: string; p2Name: string }
  | { type: "SKIP_NAMES" }
  | { type: "SET_P1_TEXT"; text: string; mode?: "typed" | "voice" }
  | { type: "SET_P2_TEXT"; text: string; mode?: "typed" | "voice" }
  | { type: "PASS_TO_P2" }
  | { type: "HANDOFF_DONE" }
  | { type: "SET_ENGINE"; engine: EngineId }
  | { type: "SET_RADIUS_KM"; km: number }
  | { type: "SEED_CANDIDATES"; candidates: Candidate[]; source: "osm" | "mock" }
  | { type: "SET_DEV_MODE"; value: boolean }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_MATCH"; response: MatchResponse }
  | { type: "SUBMIT_TIEBREAKER"; response: TiebreakerResponse }
  | { type: "SUBMIT_ERROR"; message: string }
  | { type: "ANSWER_MEDIATOR"; tiebreaker: Tiebreaker }
  | { type: "SPIN_ANYWAY" }
  | { type: "WHEEL_LANDED" }
  | { type: "RESTORE_SESSION"; snapshot: SessionSnapshot }
  | { type: "MARK_HYDRATED" }
  | { type: "RESET" };

export function initialState(engine: EngineId, devMode: boolean): DecideState {
  return {
    // Always starts here regardless of whether names were set on a
    // previous visit, so the server and first client render always agree
    // (see decide/page.tsx's mount effect) - a returning user is skipped
    // straight past it a moment later via SET_NAMES/SKIP_NAMES, a new one
    // sees it as the very first thing.
    phase: "names",
    p1Name: "",
    p2Name: "",
    p1Text: "",
    p1Mode: "typed",
    p2Text: "",
    p2Mode: "typed",
    candidates: null,
    source: null,
    tiebreakers: [],
    round: 0,
    radiusKm: DEFAULT_RADIUS_KM,
    engine,
    engineLocked: false,
    devMode,
    lastMatch: null,
    lastTiebreaker: null,
    errorMessage: null,
    hydrated: false,
  };
}

export function decideReducer(state: DecideState, action: Action): DecideState {
  switch (action.type) {
    case "SET_NAMES":
      return { ...state, p1Name: action.p1Name, p2Name: action.p2Name, phase: "p1", hydrated: true };
    case "SKIP_NAMES":
      return { ...state, phase: "p1", hydrated: true };
    case "SET_P1_TEXT":
      return { ...state, p1Text: action.text, p1Mode: action.mode ?? state.p1Mode };
    case "SET_P2_TEXT":
      return { ...state, p2Text: action.text, p2Mode: action.mode ?? state.p2Mode };
    case "PASS_TO_P2":
      return state.p1Text.trim() ? { ...state, phase: "handoff" } : state;
    case "HANDOFF_DONE":
      return { ...state, phase: "p2" };
    case "SET_ENGINE":
      return state.engineLocked ? state : { ...state, engine: action.engine };
    case "SET_RADIUS_KM":
      return state.engineLocked ? state : { ...state, radiusKm: action.km, candidates: null, source: null };
    case "SEED_CANDIDATES":
      return { ...state, candidates: action.candidates, source: action.source };
    case "SET_DEV_MODE":
      return { ...state, devMode: action.value };
    case "SUBMIT_START":
      return { ...state, phase: "submitting", engineLocked: true, errorMessage: null };
    case "SUBMIT_MATCH":
      return {
        ...state,
        // A single surviving candidate (every other option got excluded by
        // a guard) has nothing to spin for - go straight to reveal instead
        // of animating a one-slice wheel.
        phase: action.response.reason === "only_option" ? "reveal" : "wheel",
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
    case "RESTORE_SESSION":
      return { ...state, ...action.snapshot, hydrated: true };
    case "MARK_HYDRATED":
      return { ...state, hydrated: true };
    case "RESET":
      return {
        ...initialState(state.engine, state.devMode),
        // Names were already asked (or skipped) this session - don't send
        // a couple back through that step for every new round.
        phase: "p1",
        p1Name: state.p1Name,
        p2Name: state.p2Name,
        radiusKm: state.radiusKm, // preference across rounds
        hydrated: true, // already resolved this session - not a fresh mount
      };
    default:
      return state;
  }
}
