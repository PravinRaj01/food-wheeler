import { DEFAULT_RADIUS_KM } from "@/lib/decide/types";
import type {
  Candidate,
  Choice,
  EngineId,
  MediatorQuestion,
  RankedResponse,
  SearchCenter,
  Tiebreaker,
  TiebreakerResponse,
} from "@/lib/decide/types";

// results: the ranked list (the couple picks, or spins). mediator: a question -
// either the optional "too close" one raised from the list, or the forced
// which-place-to-search-near one. wheel: an optional weighted spin. reveal:
// the place they ended up with.
export type Phase = "names" | "input" | "submitting" | "results" | "mediator" | "wheel" | "reveal";
/** The only phases a saved session snapshot can resume into - see
 * decide/page.tsx's persistence effect. Anything past "input" depends on a
 * live server response that was never persisted, so it isn't resumable. */
export type ResumablePhase = "names" | "input";

export interface SessionSnapshot {
  phase: ResumablePhase;
  p1Name: string;
  p2Name: string;
  p1Text: string;
  p1Mode: "typed" | "voice";
  p1Sealed: boolean;
  p2Text: string;
  p2Mode: "typed" | "voice";
  p2Sealed: boolean;
  radiusKm: number;
}

export interface DecideState {
  phase: Phase;
  p1Name: string;
  p2Name: string;
  p1Text: string;
  p1Mode: "typed" | "voice";
  p1Sealed: boolean;
  p2Text: string;
  p2Mode: "typed" | "voice";
  p2Sealed: boolean;
  /** Which card's panel is currently morphed open, if any - never
   * persisted (see SessionSnapshot), so a reload always restores both
   * cards collapsed regardless of what was open when the tab closed. */
  openCard: 1 | 2 | null;
  candidates: Candidate[] | null;
  source: "overture" | "osm" | "mock" | null;
  /** The place a partner mentioned by name ("near Mid Valley") the search
   * centred on, if any - echoed back to the server each round exactly like
   * candidates/source above, and cleared whenever they are. */
  searchCenter: SearchCenter | null;
  tiebreakers: Tiebreaker[];
  round: number;
  radiusKm: number;
  engine: EngineId;
  engineLocked: boolean;
  devMode: boolean;
  /** The latest ranked list. Kept while the couple goes on to a question,
   * the wheel or the reveal, so "back to the list" always has it. */
  lastRanked: RankedResponse | null;
  /** The question currently on screen, and what raised it. */
  mediator: { question: MediatorQuestion; kind: "close" | "location"; round: number; engineLabel: string } | null;
  chosen: Choice | null;
  /** The place the weighted draw picked for the wheel to land on - drawn
   * before the spin starts (see START_SPIN), never re-drawn mid-animation. */
  spinWinnerId: string | null;
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
  | { type: "OPEN_CARD"; card: 1 | 2 }
  | { type: "CLOSE_CARD" }
  | { type: "REDO_CARD"; card: 1 | 2 }
  | { type: "SEAL_CARD"; card: 1 | 2 }
  | { type: "SEAL_NO_PREFERENCE"; card: 1 | 2 }
  | { type: "SET_ENGINE"; engine: EngineId }
  | { type: "SET_RADIUS_KM"; km: number }
  | { type: "SEED_CANDIDATES"; candidates: Candidate[]; source: "overture" | "osm" | "mock" }
  | { type: "SET_DEV_MODE"; value: boolean }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_RANKED"; response: RankedResponse }
  | { type: "SUBMIT_TIEBREAKER"; response: TiebreakerResponse }
  | { type: "OPEN_QUESTION" }
  | { type: "PICK"; id: string }
  | { type: "START_SPIN"; winnerId: string }
  | { type: "BACK_TO_RESULTS" }
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
    p1Sealed: false,
    p2Text: "",
    p2Mode: "typed",
    p2Sealed: false,
    openCard: null,
    candidates: null,
    source: null,
    searchCenter: null,
    tiebreakers: [],
    round: 0,
    radiusKm: DEFAULT_RADIUS_KM,
    engine,
    engineLocked: false,
    devMode,
    lastRanked: null,
    mediator: null,
    chosen: null,
    spinWinnerId: null,
    errorMessage: null,
    hydrated: false,
  };
}

/** The couple's pick as a Choice, joined from the ranking (score + position)
 * and the candidate list (the full place) by id - or null if either is
 * missing, which would mean a stale id and is safer to ignore than to guess. */
function choiceFor(state: DecideState, id: string, via: Choice["via"]): Choice | null {
  const ranked = state.lastRanked;
  if (!ranked) return null;
  const index = ranked.ranking.findIndex((r) => r.id === id);
  const candidate = ranked.candidates.find((c) => c.id === id);
  if (index < 0 || !candidate) return null;
  return { candidate, probability: ranked.ranking[index].probability, rank: index + 1, total: ranked.ranking.length, via };
}

export function decideReducer(state: DecideState, action: Action): DecideState {
  switch (action.type) {
    case "SET_NAMES":
      return { ...state, p1Name: action.p1Name, p2Name: action.p2Name, phase: "input", hydrated: true };
    case "SKIP_NAMES":
      return { ...state, phase: "input", hydrated: true };
    case "SET_P1_TEXT":
      return { ...state, p1Text: action.text, p1Mode: action.mode ?? state.p1Mode };
    case "SET_P2_TEXT":
      return { ...state, p2Text: action.text, p2Mode: action.mode ?? state.p2Mode };
    // Opening a card just opens it - whether that shows the normal editable
    // form or a blurred "sealed" peek is entirely up to whether the card is
    // currently sealed, decided at render time (see PartnerCardPanel's
    // `sealed` prop), not by anything this action changes. Neither the seal
    // nor the text is touched here: both partners share one phone, so a
    // sealed card must be safe to just glance at (curiosity, or "did I
    // already answer this?") without that act itself exposing the answer
    // OR silently discarding it - only an explicit REDO_CARD does either.
    // A no-op once the engine is locked (already submitted this round).
    case "OPEN_CARD":
      return state.engineLocked ? state : { ...state, openCard: action.card };
    case "CLOSE_CARD":
      return { ...state, openCard: null };
    // Explicit "throw this answer away and start over" - the only thing
    // that clears a sealed card's text. Leaves it open (now in edit mode,
    // since it's no longer sealed) rather than closing, so the redo lands
    // straight in the textarea.
    case "REDO_CARD":
      return action.card === 1
        ? { ...state, p1Sealed: false, p1Text: "", p1Mode: "typed" }
        : { ...state, p2Sealed: false, p2Text: "", p2Mode: "typed" };
    case "SEAL_CARD":
      if (action.card === 1) {
        if (!state.p1Text.trim()) return state;
        return { ...state, p1Sealed: true, openCard: state.openCard === 1 ? null : state.openCard };
      }
      if (!state.p2Text.trim()) return state;
      return { ...state, p2Sealed: true, openCard: state.openCard === 2 ? null : state.openCard };
    case "SEAL_NO_PREFERENCE":
      return action.card === 1
        ? { ...state, p1Text: "", p1Sealed: true, openCard: state.openCard === 1 ? null : state.openCard }
        : { ...state, p2Text: "", p2Sealed: true, openCard: state.openCard === 2 ? null : state.openCard };
    case "SET_ENGINE":
      return state.engineLocked ? state : { ...state, engine: action.engine };
    case "SET_RADIUS_KM":
      return state.engineLocked
        ? state
        : { ...state, radiusKm: action.km, candidates: null, source: null, searchCenter: null };
    case "SEED_CANDIDATES":
      return { ...state, candidates: action.candidates, source: action.source };
    case "SET_DEV_MODE":
      return { ...state, devMode: action.value };
    case "SUBMIT_START":
      return { ...state, phase: "submitting", engineLocked: true, errorMessage: null };
    case "SUBMIT_RANKED":
      return {
        ...state,
        // Always the list first - even a single surviving place is shown as a
        // list of one (the couple confirms it), rather than skipping ahead.
        phase: "results",
        lastRanked: action.response,
        mediator: null,
        chosen: null,
        spinWinnerId: null,
        candidates: action.response.candidates,
        source: action.response.source,
        searchCenter: action.response.search_center ?? null,
      };
    case "SUBMIT_TIEBREAKER":
      return {
        ...state,
        phase: "mediator",
        // Only the forced which-place-to-search-near question arrives this
        // way now - see app.py's build_location_question.
        mediator: {
          question: action.response.question,
          kind: "location",
          round: action.response.round,
          engineLabel: action.response.engine.label,
        },
        candidates: action.response.candidates,
        searchCenter: action.response.search_center ?? null,
        // "n/a" marks a location_conflict question, asked before anything
        // was ever fetched (see app.py's build_location_question) - nothing
        // real to echo back as a source, so it's kept out of state exactly
        // like the null it effectively means.
        source: action.response.source === "n/a" ? null : action.response.source,
      };
    case "OPEN_QUESTION": {
      const question = state.lastRanked?.question;
      if (!state.lastRanked || !question) return state;
      return {
        ...state,
        phase: "mediator",
        mediator: {
          question,
          kind: "close",
          round: state.lastRanked.round,
          engineLabel: state.lastRanked.engine.label,
        },
      };
    }
    case "PICK": {
      const choice = choiceFor(state, action.id, "picked");
      return choice ? { ...state, phase: "reveal", chosen: choice } : state;
    }
    case "START_SPIN":
      if (!state.lastRanked || !state.lastRanked.ranking.some((r) => r.id === action.winnerId)) return state;
      return { ...state, phase: "wheel", spinWinnerId: action.winnerId, chosen: null };
    case "WHEEL_LANDED": {
      const choice = state.spinWinnerId ? choiceFor(state, state.spinWinnerId, "spun") : null;
      return choice ? { ...state, phase: "reveal", chosen: choice } : state;
    }
    case "BACK_TO_RESULTS":
      return state.lastRanked
        ? { ...state, phase: "results", mediator: null, chosen: null, spinWinnerId: null }
        : state;
    case "SUBMIT_ERROR":
      return {
        ...state,
        // A round-0 error goes back to the two sealed cards (still sealed,
        // text untouched) rather than losing anything typed - there is no
        // more "p2" phase to fall back to. A later error keeps whatever the
        // couple was looking at: the list they already have, or the
        // location question they were answering.
        phase:
          state.phase === "submitting" ? (state.lastRanked ? "results" : state.mediator ? "mediator" : "input") : state.phase,
        errorMessage: action.message,
      };
    case "ANSWER_MEDIATOR":
      return {
        ...state,
        tiebreakers: [...state.tiebreakers, action.tiebreaker],
        round: (state.mediator?.round ?? state.round) + 1,
      };
    case "SPIN_ANYWAY":
      return { ...state, round: 2 };
    case "RESTORE_SESSION":
      return { ...state, ...action.snapshot, hydrated: true };
    case "MARK_HYDRATED":
      return { ...state, hydrated: true };
    case "RESET":
      return {
        ...initialState(state.engine, state.devMode),
        // Names were already asked (or skipped) this session - don't send
        // a couple back through that step for every new round.
        phase: "input",
        p1Name: state.p1Name,
        p2Name: state.p2Name,
        radiusKm: state.radiusKm, // preference across rounds
        hydrated: true, // already resolved this session - not a fresh mount
      };
    default:
      return state;
  }
}

/** Both cards must be sealed, and the backend still requires at least one
 * of them to have said something (EMPTY_INPUT otherwise) - "Anything's
 * fine" on both is the one way to fail this despite two sealed cards. */
export function canSubmit(state: DecideState): boolean {
  return state.p1Sealed && state.p2Sealed && Boolean(state.p1Text.trim() || state.p2Text.trim());
}
