import { DEFAULT_RADIUS_KM } from "@/lib/decide/types";
import { ENGINE_LABELS } from "@/lib/decide/engine-labels";
import type {
  Candidate,
  Choice,
  EngineId,
  MealId,
  MediatorQuestion,
  RankedResponse,
  RankingRow,
  SearchCenter,
  Tiebreaker,
  TiebreakerResponse,
} from "@/lib/decide/types";

// results: the ranked list (the couple picks, or spins). mediator: a question -
// either the optional "too close" one raised from the list, or the forced
// which-place-to-search-near one. wheel: an optional weighted spin. reveal:
// the place they ended up with.
export type Phase = "names" | "input" | "submitting" | "results" | "mediator" | "wheel" | "reveal";
/** A saved round older than this is not resumed into its list/question/
 * reveal - the couple has moved on, and the places may have changed - only the
 * two sealed cards' text is kept. */
export const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** What decide/page.tsx keeps in sessionStorage so leaving the page (or a
 * reload, or a backgrounded PWA being killed) and coming back lands on the
 * same step. Everything past `radiusKm` is optional: a snapshot written
 * before rounds were persisted has none of it and restores as before. */
export interface SessionSnapshot {
  /** Any phase except "submitting" - an in-flight request can't survive a
   * navigation, so snapshotOf() writes nothing while one is running. */
  phase: Exclude<Phase, "submitting">;
  p1Name: string;
  p2Name: string;
  p1Text: string;
  p1Mode: "typed" | "voice";
  p1Sealed: boolean;
  p2Text: string;
  p2Mode: "typed" | "voice";
  p2Sealed: boolean;
  radiusKm: number;
  mealChoice?: MealId | null;
  lastRanked?: RankedResponse | null;
  viewEngine?: EngineId | null;
  mediator?: DecideState["mediator"];
  chosen?: Choice | null;
  spinWinnerId?: string | null;
  candidates?: Candidate[] | null;
  source?: DecideState["source"];
  searchCenter?: SearchCenter | null;
  tiebreakers?: Tiebreaker[];
  round?: number;
  engineLocked?: boolean;
  savedKey?: string | null;
  /** Epoch ms of the write, for SESSION_MAX_AGE_MS. */
  savedAt?: number;
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
  /** The meal the couple picked on the "Looking for" chip, or null to let the
   * server guess from what they typed and the time of day. */
  mealChoice: MealId | null;
  engine: EngineId;
  engineLocked: boolean;
  devMode: boolean;
  /** The latest ranked list. Kept while the couple goes on to a question,
   * the wheel or the reveal, so "back to the list" always has it. */
  lastRanked: RankedResponse | null;
  /** Dev Mode only: which engine's ranking the list is showing instead of the
   * primary's (null = the primary's). See viewedResponse(). */
  viewEngine: EngineId | null;
  /** The question currently on screen, and what raised it. */
  mediator: { question: MediatorQuestion; kind: "close" | "location"; round: number; engineLabel: string } | null;
  chosen: Choice | null;
  /** The place the weighted draw picked for the wheel to land on - drawn
   * before the spin starts (see START_SPIN), never re-drawn mid-animation. */
  spinWinnerId: string | null;
  errorMessage: string | null;
  /** Key of the decision last saved to History (see decide/page.tsx). Lives in
   * state, not a ref, so it survives a restored session - otherwise coming
   * back to a reveal would save the same decision a second time. */
  savedKey: string | null;
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
  | { type: "SET_MEAL"; meal: MealId | null }
  | { type: "SEED_CANDIDATES"; candidates: Candidate[]; source: "overture" | "osm" | "mock" }
  | { type: "SET_DEV_MODE"; value: boolean }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_RANKED"; response: RankedResponse }
  | { type: "SUBMIT_TIEBREAKER"; response: TiebreakerResponse }
  | { type: "OPEN_QUESTION" }
  | { type: "VIEW_ENGINE"; engine: EngineId | null }
  | { type: "PICK"; id: string }
  | { type: "START_SPIN"; winnerId: string }
  | { type: "BACK_TO_RESULTS" }
  | { type: "SUBMIT_ERROR"; message: string }
  | { type: "ANSWER_MEDIATOR"; tiebreaker: Tiebreaker }
  | { type: "SPIN_ANYWAY" }
  | { type: "WHEEL_LANDED" }
  | { type: "RESTORE_SESSION"; snapshot: SessionSnapshot; now: number }
  | { type: "MARK_SAVED"; key: string }
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
    mealChoice: null,
    engine,
    engineLocked: false,
    devMode,
    lastRanked: null,
    viewEngine: null,
    mediator: null,
    chosen: null,
    spinWinnerId: null,
    errorMessage: null,
    savedKey: null,
    hydrated: false,
  };
}

/** The couple's pick as a Choice, joined from the ranking (score + position)
 * and the candidate list (the full place) by id - or null if either is
 * missing, which would mean a stale id and is safer to ignore than to guess. */
function choiceFor(state: DecideState, id: string, via: Choice["via"]): Choice | null {
  // The viewed engine's ranking, so a pick made while Dev Mode is showing
  // GLiNER's list records GLiNER's rank and score for it, not the primary's.
  const ranked = viewedResponse(state);
  if (!ranked) return null;
  const index = ranked.ranking.findIndex((r) => r.id === id);
  const candidate = ranked.candidates.find((c) => c.id === id);
  if (index < 0 || !candidate) return null;
  return { candidate, probability: ranked.ranking[index].probability, rank: index + 1, total: ranked.ranking.length, via };
}

/** The ranked response as the screen should show it. Normally just
 * `lastRanked`; in Dev Mode with another engine selected, that engine's own
 * ranking, label and id are swapped in - so the list, the wheel, the reveal
 * and the History save all read one object and none of them needs to know
 * engine switching exists. The "settle it with one question" offer is dropped
 * for a non-primary view: it was built from the PRIMARY engine's top two. */
export function viewedResponse(state: DecideState): RankedResponse | null {
  const ranked = state.lastRanked;
  if (!ranked) return null;
  const id = state.viewEngine;
  const entry = id ? ranked.comparison?.[id] : undefined;
  if (!id || id === ranked.engine.id || !entry?.ranking?.length) return ranked;
  return {
    ...ranked,
    ranking: entry.ranking,
    question: null,
    engine: { ...ranked.engine, id, label: ENGINE_LABELS[id], fallback_from: null, latency_ms: entry.latency_ms ?? 0 },
  };
}

/** Rows to render/spin for the current view - see viewedResponse(). */
export function activeRanking(state: DecideState): RankingRow[] {
  return viewedResponse(state)?.ranking ?? [];
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
    case "SET_MEAL":
      // Only while the couple are still setting up - once a round is running
      // the shortlist has already been kept to one meal.
      return state.phase === "input" ? { ...state, mealChoice: action.meal } : state;
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
        viewEngine: null,
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
    case "VIEW_ENGINE": {
      const ranked = state.lastRanked;
      if (!ranked || state.phase !== "results") return state;
      const next = action.engine === ranked.engine.id ? null : action.engine;
      if (next && !ranked.comparison?.[next]?.ranking?.length) return state;
      return { ...state, viewEngine: next };
    }
    case "PICK": {
      const choice = choiceFor(state, action.id, "picked");
      return choice ? { ...state, phase: "reveal", chosen: choice } : state;
    }
    case "START_SPIN":
      if (!activeRanking(state).some((r) => r.id === action.winnerId)) return state;
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
      return { ...state, ...restoreFromSnapshot(action.snapshot, action.now), hydrated: true };
    case "MARK_SAVED":
      return { ...state, savedKey: action.key };
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

/** The state to persist, or null while a request is in flight (the previous
 * snapshot is then left alone, so coming back mid-request resumes from
 * before it). */
export function snapshotOf(state: DecideState, now: number): SessionSnapshot | null {
  if (state.phase === "submitting") return null;
  return {
    phase: state.phase,
    p1Name: state.p1Name,
    p2Name: state.p2Name,
    p1Text: state.p1Text,
    p1Mode: state.p1Mode,
    p1Sealed: state.p1Sealed,
    p2Text: state.p2Text,
    p2Mode: state.p2Mode,
    p2Sealed: state.p2Sealed,
    radiusKm: state.radiusKm,
    mealChoice: state.mealChoice,
    lastRanked: state.lastRanked,
    viewEngine: state.viewEngine,
    mediator: state.mediator,
    chosen: state.chosen,
    spinWinnerId: state.spinWinnerId,
    candidates: state.candidates,
    source: state.source,
    searchCenter: state.searchCenter,
    tiebreakers: state.tiebreakers,
    round: state.round,
    engineLocked: state.engineLocked,
    savedKey: state.savedKey,
    savedAt: now,
  };
}

const isRanked = (r: unknown): r is RankedResponse =>
  !!r && Array.isArray((r as RankedResponse).ranking) && Array.isArray((r as RankedResponse).candidates);

/** A snapshot turned back into state. What survives depends on how far the
 * round had got: the list, an open question and the reveal come back as they
 * were; a spin was mid-animation so it returns to the list it came from; and
 * anything stale, or missing what its phase needs, falls back to the two
 * sealed cards with their text kept. */
export function restoreFromSnapshot(snap: SessionSnapshot, now: number): Partial<DecideState> {
  const cards = {
    p1Name: snap.p1Name,
    p2Name: snap.p2Name,
    p1Text: snap.p1Text,
    p1Mode: snap.p1Mode,
    p1Sealed: snap.p1Sealed,
    p2Text: snap.p2Text,
    p2Mode: snap.p2Mode,
    p2Sealed: snap.p2Sealed,
    radiusKm: snap.radiusKm,
    mealChoice: snap.mealChoice ?? null,
  };
  const noRound = {
    lastRanked: null,
    viewEngine: null,
    mediator: null,
    chosen: null,
    spinWinnerId: null,
    tiebreakers: [],
    round: 0,
    engineLocked: false,
    savedKey: null,
  };
  const cardsOnly: Partial<DecideState> = { ...cards, ...noRound, phase: snap.phase === "names" ? "names" : "input" };

  if (snap.phase === "names") return cardsOnly;
  // Written before rounds were persisted (no savedAt): only ever input.
  if (snap.savedAt === undefined) return { ...cardsOnly, phase: "input" };
  if (now - snap.savedAt > SESSION_MAX_AGE_MS) return cardsOnly;

  const round = {
    ...cards,
    candidates: snap.candidates ?? null,
    source: snap.source ?? null,
    searchCenter: snap.searchCenter ?? null,
    tiebreakers: snap.tiebreakers ?? [],
    round: snap.round ?? 0,
    engineLocked: snap.engineLocked ?? false,
    lastRanked: snap.lastRanked ?? null,
    viewEngine: snap.viewEngine ?? null,
    mediator: null,
    chosen: null,
    spinWinnerId: null,
    savedKey: snap.savedKey ?? null,
  };

  switch (snap.phase) {
    case "results":
    case "wheel": // a spin isn't replayed mid-animation - back to its list
      return isRanked(snap.lastRanked) ? { ...round, phase: "results" } : cardsOnly;
    case "mediator":
      return snap.mediator ? { ...round, phase: "mediator", mediator: snap.mediator } : cardsOnly;
    case "reveal":
      return isRanked(snap.lastRanked) && snap.chosen?.candidate
        ? { ...round, phase: "reveal", chosen: snap.chosen }
        : cardsOnly;
    default: // "input"
      return { ...round, phase: "input" };
  }
}

/** The same snapshot, minus any round in progress - used when something new
 * (Explore's "Add to tonight's wheel") starts a fresh round, so a leftover
 * list from before can't sit on top of it. */
export function withoutRound(snap: SessionSnapshot): SessionSnapshot {
  return {
    ...snap,
    phase: snap.phase === "names" ? "names" : "input",
    lastRanked: null,
    viewEngine: null,
    mediator: null,
    chosen: null,
    spinWinnerId: null,
    candidates: null,
    source: null,
    searchCenter: null,
    tiebreakers: [],
    round: 0,
    engineLocked: false,
    savedKey: null,
  };
}

/** Both cards must be sealed, and the backend still requires at least one
 * of them to have said something (EMPTY_INPUT otherwise) - "Anything's
 * fine" on both is the one way to fail this despite two sealed cards. */
export function canSubmit(state: DecideState): boolean {
  return state.p1Sealed && state.p2Sealed && Boolean(state.p1Text.trim() || state.p2Text.trim());
}
