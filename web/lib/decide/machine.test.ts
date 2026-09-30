import { describe, expect, it } from "vitest";
import {
  SESSION_MAX_AGE_MS,
  activeRanking,
  canSubmit,
  decideReducer,
  initialState,
  restoreFromSnapshot,
  snapshotOf,
  viewedResponse,
  withoutRound,
} from "./machine";
import type { SessionSnapshot } from "./machine";
import type { Candidate, RankedResponse, TiebreakerResponse } from "./types";

const candidate = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  name: id,
  cuisine: "thai",
  tags: [],
  price: "$$",
  lat: 3.1,
  lng: 101.6,
  address: "",
  distance_km: 1,
  dims: { service: "sit_down", spice: "mild", setting: "indoor", price: "mid", diet: "none" },
  color: "#fff",
  ...overrides,
});

const engine = { id: "laya" as const, label: "Laya", score_type: "probability" as const, raw_top: 0.4, fallback_from: null, latency_ms: 100 };

const rankedResponse = (overrides: Partial<RankedResponse> = {}): RankedResponse => ({
  status: "ranked",
  ranking: [
    { id: "a", name: "a", probability: 0.4, color: "#fff" },
    { id: "b", name: "b", probability: 0.3, color: "#fff" },
    { id: "c", name: "c", probability: 0.1, color: "#fff" },
  ],
  question: null,
  rounds_left: 2,
  source: "osm",
  candidates: [candidate("a"), candidate("b"), candidate("c")],
  round: 0,
  latency_ms: 100,
  engine,
  ...overrides,
});

const question = { id: "setting", prompt: "?", options: [{ answer: "patio", label: "Patio", text: "Outdoor" }] };

const locationConflict = (overrides: Partial<TiebreakerResponse> = {}): TiebreakerResponse => ({
  status: "tiebreaker",
  reason: "location_conflict",
  confidence: 0,
  round: 0,
  rounds_left: 2,
  question: { id: "location", prompt: "Where?", options: [{ answer: "p1", label: "Mid Valley", text: "Near Mid Valley" }] },
  contenders: [],
  candidates: [],
  source: "n/a",
  engine,
  ...overrides,
});

const withRanked = (overrides: Partial<RankedResponse> = {}) => ({
  ...initialState("laya", false),
  phase: "results" as const,
  lastRanked: rankedResponse(overrides),
});

describe("initialState", () => {
  it("starts on names (always, regardless of any previous session) with the given engine and dev mode", () => {
    // Always "names", never "p1" directly - decide/page.tsx's mount effect
    // is what skips a returning visitor past it via SET_NAMES/SKIP_NAMES,
    // so the server and the first client render always agree on the
    // starting phase before that effect has had a chance to run.
    const s = initialState("gliner", true);
    expect(s.phase).toBe("names");
    expect(s.p1Name).toBe("");
    expect(s.p2Name).toBe("");
    expect(s.engine).toBe("gliner");
    expect(s.devMode).toBe(true);
    expect(s.engineLocked).toBe(false);
    expect(s.radiusKm).toBe(1.5);
  });
});

describe("decideReducer", () => {
  it("SET_NAMES stores both names, moves to input, and marks hydrated", () => {
    const s = decideReducer(initialState("laya", false), { type: "SET_NAMES", p1Name: "Alex", p2Name: "Sam" });
    expect(s.phase).toBe("input");
    expect(s.p1Name).toBe("Alex");
    expect(s.p2Name).toBe("Sam");
    expect(s.hydrated).toBe(true);
  });

  it("SKIP_NAMES moves to input without setting either name, and marks hydrated", () => {
    const s = decideReducer(initialState("laya", false), { type: "SKIP_NAMES" });
    expect(s.phase).toBe("input");
    expect(s.p1Name).toBe("");
    expect(s.p2Name).toBe("");
    expect(s.hydrated).toBe(true);
  });

  it("MARK_HYDRATED only flips the hydrated flag, for a fresh visit with nothing to restore", () => {
    const s = decideReducer(initialState("laya", false), { type: "MARK_HYDRATED" });
    expect(s.hydrated).toBe(true);
    expect(s.phase).toBe("names"); // unlike SET_NAMES/SKIP_NAMES, this doesn't advance the phase
  });

  it("starts un-hydrated, so the session-persistence write effect knows to wait for a restore attempt", () => {
    expect(initialState("laya", false).hydrated).toBe(false);
  });

  it("SET_P1_TEXT updates text and input mode", () => {
    const s = decideReducer(initialState("laya", false), { type: "SET_P1_TEXT", text: "spicy", mode: "voice" });
    expect(s.p1Text).toBe("spicy");
    expect(s.p1Mode).toBe("voice");
  });

  it("SET_P1_TEXT keeps the previous mode when none is given", () => {
    let s = decideReducer(initialState("laya", false), { type: "SET_P1_TEXT", text: "a", mode: "voice" });
    s = decideReducer(s, { type: "SET_P1_TEXT", text: "b" });
    expect(s.p1Mode).toBe("voice");
  });

  it("OPEN_CARD on a SEALED card just opens it - the seal and its text are untouched (a peek, not a leak or a wipe)", () => {
    const sealed = { ...initialState("laya", false), p1Sealed: true, p1Text: "spicy", p1Mode: "voice" as const };
    const s = decideReducer(sealed, { type: "OPEN_CARD", card: 1 });
    expect(s.openCard).toBe(1);
    // Still sealed - PartnerCardPanel renders this as a blurred peek with a
    // Redo option, not the editable form, exactly because it's still true.
    expect(s.p1Sealed).toBe(true);
    expect(s.p1Text).toBe("spicy");
    expect(s.p1Mode).toBe("voice");
  });

  it("OPEN_CARD on an UNSEALED card (a closed-but-not-sealed draft) keeps its text", () => {
    // Closed via x instead of Done - never sealed, so there was nothing
    // "hidden" to protect; reopening should restore the draft as-is.
    const draft = { ...initialState("laya", false), p1Sealed: false, p1Text: "spicy" };
    const s = decideReducer(draft, { type: "OPEN_CARD", card: 1 });
    expect(s.p1Text).toBe("spicy");
  });

  it("OPEN_CARD is a no-op once the engine is locked", () => {
    const locked = { ...initialState("laya", false), engineLocked: true };
    const s = decideReducer(locked, { type: "OPEN_CARD", card: 2 });
    expect(s.openCard).toBeNull();
  });

  it("CLOSE_CARD collapses whichever card is open without sealing it", () => {
    const open = { ...initialState("laya", false), openCard: 1 as const };
    const s = decideReducer(open, { type: "CLOSE_CARD" });
    expect(s.openCard).toBeNull();
    expect(s.p1Sealed).toBe(false);
  });

  it("CLOSE_CARD after peeking at a sealed card (no Redo) leaves it sealed with its answer intact", () => {
    const peeking = { ...initialState("laya", false), openCard: 1 as const, p1Sealed: true, p1Text: "spicy" };
    const s = decideReducer(peeking, { type: "CLOSE_CARD" });
    expect(s.openCard).toBeNull();
    expect(s.p1Sealed).toBe(true);
    expect(s.p1Text).toBe("spicy");
  });

  it("REDO_CARD clears a sealed card's text and un-seals it, leaving it open for editing", () => {
    const sealed = { ...initialState("laya", false), openCard: 1 as const, p1Sealed: true, p1Text: "spicy", p1Mode: "voice" as const };
    const s = decideReducer(sealed, { type: "REDO_CARD", card: 1 });
    expect(s.p1Sealed).toBe(false);
    expect(s.p1Text).toBe("");
    expect(s.p1Mode).toBe("typed");
    // Stays open - the redo lands straight in the (now empty) textarea.
    expect(s.openCard).toBe(1);
  });

  it("SEAL_CARD is a no-op when that card's text is blank", () => {
    const s = decideReducer(initialState("laya", false), { type: "SEAL_CARD", card: 1 });
    expect(s.p1Sealed).toBe(false);
  });

  it("SEAL_CARD rejects whitespace-only text", () => {
    let s = decideReducer(initialState("laya", false), { type: "SET_P2_TEXT", text: "   " });
    s = decideReducer(s, { type: "SEAL_CARD", card: 2 });
    expect(s.p2Sealed).toBe(false);
  });

  it("SEAL_CARD seals the card and closes it if it was the open one", () => {
    let s = decideReducer({ ...initialState("laya", false), openCard: 2 }, { type: "SET_P2_TEXT", text: "casual" });
    s = decideReducer(s, { type: "SEAL_CARD", card: 2 });
    expect(s.p2Sealed).toBe(true);
    expect(s.openCard).toBeNull();
  });

  it("SEAL_CARD doesn't close a DIFFERENT card that happens to be open", () => {
    let s = decideReducer({ ...initialState("laya", false), openCard: 2 }, { type: "SET_P1_TEXT", text: "spicy" });
    s = decideReducer(s, { type: "SEAL_CARD", card: 1 });
    expect(s.p1Sealed).toBe(true);
    expect(s.openCard).toBe(2);
  });

  it("SEAL_NO_PREFERENCE seals a card with empty text regardless of what was typed", () => {
    let s = decideReducer({ ...initialState("laya", false), openCard: 1 }, { type: "SET_P1_TEXT", text: "spicy" });
    s = decideReducer(s, { type: "SEAL_NO_PREFERENCE", card: 1 });
    expect(s.p1Sealed).toBe(true);
    expect(s.p1Text).toBe("");
    expect(s.openCard).toBeNull();
  });

  describe("canSubmit", () => {
    it("is false until both cards are sealed", () => {
      const oneSealed = { ...initialState("laya", false), p1Sealed: true, p1Text: "spicy" };
      expect(canSubmit(oneSealed)).toBe(false);
    });

    it("is true once both are sealed and at least one has text", () => {
      const both = { ...initialState("laya", false), p1Sealed: true, p1Text: "spicy", p2Sealed: true, p2Text: "" };
      expect(canSubmit(both)).toBe(true);
    });

    it("is false when both are sealed but both said 'anything's fine' (blank)", () => {
      const bothBlank = { ...initialState("laya", false), p1Sealed: true, p1Text: "", p2Sealed: true, p2Text: "" };
      expect(canSubmit(bothBlank)).toBe(false);
    });
  });

  it("SET_ENGINE is ignored once locked", () => {
    const locked = { ...initialState("laya", false), engineLocked: true };
    const s = decideReducer(locked, { type: "SET_ENGINE", engine: "gliner" });
    expect(s.engine).toBe("laya");
  });

  it("SET_ENGINE applies when not locked", () => {
    const s = decideReducer(initialState("laya", false), { type: "SET_ENGINE", engine: "gliner" });
    expect(s.engine).toBe("gliner");
  });

  it("SET_RADIUS_KM clears any previously fetched candidates so the next submit re-fetches for the new radius", () => {
    const withCandidates = { ...initialState("laya", false), candidates: [candidate("a")], source: "osm" as const };
    const s = decideReducer(withCandidates, { type: "SET_RADIUS_KM", km: 15 });
    expect(s.radiusKm).toBe(15);
    expect(s.candidates).toBeNull();
    expect(s.source).toBeNull();
  });

  it("SET_RADIUS_KM is ignored once the engine is locked", () => {
    const locked = { ...initialState("laya", false), engineLocked: true };
    const s = decideReducer(locked, { type: "SET_RADIUS_KM", km: 5 });
    expect(s.radiusKm).toBe(1.5);
  });

  it("SEED_CANDIDATES sets candidates and source regardless of lock state", () => {
    const s = decideReducer(initialState("laya", false), {
      type: "SEED_CANDIDATES",
      candidates: [candidate("x")],
      source: "mock",
    });
    expect(s.candidates).toEqual([candidate("x")]);
    expect(s.source).toBe("mock");
  });

  it("SUBMIT_START moves to submitting, locks the engine, and clears any error", () => {
    const withError = { ...initialState("laya", false), errorMessage: "oops" };
    const s = decideReducer(withError, { type: "SUBMIT_START" });
    expect(s.phase).toBe("submitting");
    expect(s.engineLocked).toBe(true);
    expect(s.errorMessage).toBeNull();
  });

  it("SUBMIT_RANKED shows the list first and stores the ranking, candidates and source", () => {
    const response = rankedResponse({ source: "overture" });
    const s = decideReducer(initialState("laya", false), { type: "SUBMIT_RANKED", response });
    expect(s.phase).toBe("results");
    expect(s.lastRanked).toBe(response);
    expect(s.candidates).toEqual(response.candidates);
    expect(s.source).toBe("overture");
    expect(s.chosen).toBeNull();
  });

  it("SUBMIT_RANKED shows a single surviving place as a list of one, not straight to reveal", () => {
    const response = rankedResponse({
      ranking: [{ id: "a", name: "a", probability: 1, color: "#fff" }],
      candidates: [candidate("a")],
    });
    const s = decideReducer(initialState("laya", false), { type: "SUBMIT_RANKED", response });
    expect(s.phase).toBe("results");
  });

  it("SUBMIT_RANKED carries the search centre and clears any earlier choice", () => {
    const centre = { name: "Mid Valley", lat: 1, lng: 2, mentioned_by: "p1" as const };
    const earlier = { ...withRanked(), phase: "wheel" as const, spinWinnerId: "a" };
    const s = decideReducer(earlier, { type: "SUBMIT_RANKED", response: rankedResponse({ search_center: centre }) });
    expect(s.searchCenter).toEqual(centre);
    expect(s.spinWinnerId).toBeNull();
  });

  it("SUBMIT_TIEBREAKER (a location conflict) moves to the mediator with a location-kind question", () => {
    const s = decideReducer(initialState("laya", false), { type: "SUBMIT_TIEBREAKER", response: locationConflict() });
    expect(s.phase).toBe("mediator");
    expect(s.mediator?.kind).toBe("location");
    expect(s.mediator?.question.id).toBe("location");
    expect(s.candidates).toEqual([]);
    expect(s.source).toBeNull(); // "n/a" is not a real source to echo back
  });

  it("OPEN_QUESTION moves from the list to the optional question", () => {
    const s = decideReducer(withRanked({ question }), { type: "OPEN_QUESTION" });
    expect(s.phase).toBe("mediator");
    expect(s.mediator?.kind).toBe("close");
    expect(s.mediator?.question).toBe(question);
  });

  it("OPEN_QUESTION is ignored when no question was offered", () => {
    const start = withRanked({ question: null });
    expect(decideReducer(start, { type: "OPEN_QUESTION" })).toBe(start);
  });

  it("PICK goes to reveal with the place, its score, its rank and how it was chosen", () => {
    const s = decideReducer(withRanked(), { type: "PICK", id: "b" });
    expect(s.phase).toBe("reveal");
    expect(s.chosen).toMatchObject({ rank: 2, total: 3, probability: 0.3, via: "picked" });
    expect(s.chosen?.candidate.id).toBe("b");
  });

  it("PICK ignores an id that isn't in the list", () => {
    const start = withRanked();
    expect(decideReducer(start, { type: "PICK", id: "nope" })).toBe(start);
  });

  it("START_SPIN goes to the wheel with the already-drawn winner", () => {
    const s = decideReducer(withRanked(), { type: "START_SPIN", winnerId: "c" });
    expect(s.phase).toBe("wheel");
    expect(s.spinWinnerId).toBe("c");
  });

  it("START_SPIN ignores a winner that isn't ranked", () => {
    const start = withRanked();
    expect(decideReducer(start, { type: "START_SPIN", winnerId: "nope" })).toBe(start);
  });

  it("WHEEL_LANDED reveals the spun place, marked as spun", () => {
    const spinning = { ...withRanked(), phase: "wheel" as const, spinWinnerId: "c" };
    const s = decideReducer(spinning, { type: "WHEEL_LANDED" });
    expect(s.phase).toBe("reveal");
    expect(s.chosen).toMatchObject({ rank: 3, via: "spun" });
    expect(s.chosen?.candidate.id).toBe("c");
  });

  it("WHEEL_LANDED without a drawn winner does nothing", () => {
    const start = { ...withRanked(), phase: "wheel" as const };
    expect(decideReducer(start, { type: "WHEEL_LANDED" })).toBe(start);
  });

  it("BACK_TO_RESULTS returns to the list from a question, the wheel or the reveal, clearing the choice", () => {
    const revealed = decideReducer(withRanked(), { type: "PICK", id: "a" });
    const s = decideReducer(revealed, { type: "BACK_TO_RESULTS" });
    expect(s.phase).toBe("results");
    expect(s.chosen).toBeNull();
    expect(s.lastRanked).toBe(revealed.lastRanked);
  });

  it("BACK_TO_RESULTS does nothing without a list to go back to", () => {
    const start = initialState("laya", false);
    expect(decideReducer(start, { type: "BACK_TO_RESULTS" })).toBe(start);
  });

  it("SUBMIT_ERROR from a first-round submit falls back to input, keeping both cards sealed so the user can retry", () => {
    const submitting = {
      ...initialState("laya", false),
      phase: "submitting" as const,
      round: 0,
      p1Sealed: true,
      p2Sealed: true,
    };
    const s = decideReducer(submitting, { type: "SUBMIT_ERROR", message: "network" });
    expect(s.phase).toBe("input");
    expect(s.errorMessage).toBe("network");
    expect(s.p1Sealed).toBe(true);
    expect(s.p2Sealed).toBe(true);
  });

  it("SUBMIT_ERROR after a list exists falls back to that list instead of losing it", () => {
    const submitting = { ...withRanked(), phase: "submitting" as const, round: 1 };
    const s = decideReducer(submitting, { type: "SUBMIT_ERROR", message: "network" });
    expect(s.phase).toBe("results");
  });

  it("SUBMIT_ERROR while answering the location question falls back to that question", () => {
    const asked = decideReducer(initialState("laya", false), { type: "SUBMIT_TIEBREAKER", response: locationConflict() });
    const s = decideReducer({ ...asked, phase: "submitting" as const, round: 1 }, { type: "SUBMIT_ERROR", message: "x" });
    expect(s.phase).toBe("mediator");
  });

  it("SUBMIT_ERROR outside of submitting leaves the phase alone", () => {
    const s = decideReducer({ ...initialState("laya", false), phase: "wheel" }, { type: "SUBMIT_ERROR", message: "x" });
    expect(s.phase).toBe("wheel");
  });

  it("ANSWER_MEDIATOR appends the tiebreaker and advances the round from the question's round", () => {
    const asking = decideReducer(withRanked({ question, round: 1 }), { type: "OPEN_QUESTION" });
    const answer = { question_id: "setting", answer: "patio", text: "Outdoor" };
    const s = decideReducer(asking, { type: "ANSWER_MEDIATOR", tiebreaker: answer });
    expect(s.tiebreakers).toEqual([answer]);
    expect(s.round).toBe(2);
  });

  it("SPIN_ANYWAY forces round to 2 so an unanswered location question defaults instead of repeating", () => {
    const s = decideReducer(initialState("laya", false), { type: "SPIN_ANYWAY" });
    expect(s.round).toBe(2);
  });

  it("RESTORE_SESSION overlays a saved snapshot onto the current state", () => {
    const s = decideReducer(initialState("laya", false), {
      type: "RESTORE_SESSION",
      snapshot: {
        phase: "input",
        p1Name: "Alex",
        p2Name: "Sam",
        p1Text: "spicy",
        p1Mode: "voice",
        p1Sealed: true,
        p2Text: "",
        p2Mode: "typed",
        p2Sealed: false,
        radiusKm: 5,
      },
      now: 0,
    });
    expect(s.phase).toBe("input");
    expect(s.p1Name).toBe("Alex");
    expect(s.p2Name).toBe("Sam");
    expect(s.p1Text).toBe("spicy");
    expect(s.p1Mode).toBe("voice");
    expect(s.p1Sealed).toBe(true);
    expect(s.p2Sealed).toBe(false);
    expect(s.radiusKm).toBe(5);
    // Not part of the snapshot - a reload always restores both cards
    // collapsed regardless of what was open when the tab closed.
    expect(s.openCard).toBeNull();
    // Everything not in the snapshot (engine, devMode, etc.) is untouched.
    expect(s.engine).toBe("laya");
    expect(s.hydrated).toBe(true);
  });

  it("RESET returns to input (not names - already asked this session), keeping names and the radius preference", () => {
    const played = {
      ...initialState("laya", true),
      phase: "reveal" as const,
      p1Name: "Alex",
      p2Name: "Sam",
      p1Text: "spicy",
      p1Sealed: true,
      p2Text: "casual",
      p2Sealed: true,
      engineLocked: true,
      radiusKm: 15,
      tiebreakers: [{ question_id: "q", answer: "a", text: "A" }],
    };
    const s = decideReducer(played, { type: "RESET" });
    expect(s.phase).toBe("input");
    expect(s.p1Name).toBe("Alex");
    expect(s.p2Name).toBe("Sam");
    expect(s.p1Text).toBe("");
    expect(s.p2Text).toBe("");
    expect(s.p1Sealed).toBe(false);
    expect(s.p2Sealed).toBe(false);
    expect(s.openCard).toBeNull();
    expect(s.engineLocked).toBe(false);
    expect(s.tiebreakers).toEqual([]);
    expect(s.radiusKm).toBe(15);
    // devMode and engine survive RESET too, since initialState is seeded from them.
    expect(s.devMode).toBe(true);
    // Already resolved this session - RESET must not reset this back to
    // false and re-arm the "wait for a restore attempt" gate for no reason.
    expect(s.hydrated).toBe(true);
  });

  it("ignores unknown action types", () => {
    const s = initialState("laya", false);
    // @ts-expect-error - deliberately invalid action for the default branch
    expect(decideReducer(s, { type: "NOT_REAL" })).toBe(s);
  });
});

describe("Dev Mode engine view", () => {
  // Laya (primary) ranks a > b > c; GLiNER reverses it. GLiNER's entry has its
  // own full ranking - that is what VIEW_ENGINE flips the list to.
  const glinerRanking = [
    { id: "c", name: "c", probability: 0.6, color: "#fff" },
    { id: "b", name: "b", probability: 0.3, color: "#fff" },
    { id: "a", name: "a", probability: 0.1, color: "#fff" },
  ];
  const devState = () =>
    withRanked({
      comparison: {
        laya: { top_id: "a", top_p: 0.4, latency_ms: 100, primary: true, agrees: true },
        gliner: { top_id: "c", top_p: 0.6, latency_ms: 4000, primary: false, agrees: false, ranking: glinerRanking },
        clm_8b: { error: "ENGINE_UNAVAILABLE" },
      },
      question,
    } as Partial<RankedResponse>);

  it("shows the primary's ranking until another engine is selected", () => {
    const s = devState();
    expect(viewedResponse(s)).toBe(s.lastRanked);
    expect(activeRanking(s).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("VIEW_ENGINE flips the viewed ranking, label and id to that engine's - and drops the primary's question", () => {
    const s = decideReducer(devState(), { type: "VIEW_ENGINE", engine: "gliner" });
    const v = viewedResponse(s)!;
    expect(v.ranking.map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(v.engine.id).toBe("gliner");
    expect(v.engine.label).toBe("GLiNER");
    expect(v.question).toBeNull(); // built from the primary's top two
    expect(s.lastRanked!.ranking[0].id).toBe("a"); // the primary's answer itself is untouched
  });

  it("selecting the primary again returns to it", () => {
    const flipped = decideReducer(devState(), { type: "VIEW_ENGINE", engine: "gliner" });
    const back = decideReducer(flipped, { type: "VIEW_ENGINE", engine: "laya" });
    expect(back.viewEngine).toBeNull();
    expect(viewedResponse(back)).toBe(back.lastRanked);
    expect(viewedResponse(back)!.question).not.toBeNull();
  });

  it("ignores an engine with no ranking (unavailable or never ran)", () => {
    const s = devState();
    expect(decideReducer(s, { type: "VIEW_ENGINE", engine: "clm_8b" })).toBe(s);
  });

  it("ignores VIEW_ENGINE outside the list", () => {
    const s = { ...devState(), phase: "reveal" as const };
    expect(decideReducer(s, { type: "VIEW_ENGINE", engine: "gliner" })).toBe(s);
  });

  it("PICK records the viewed engine's score, rank and list size", () => {
    const s = decideReducer(devState(), { type: "VIEW_ENGINE", engine: "gliner" });
    const picked = decideReducer(s, { type: "PICK", id: "c" });
    expect(picked.chosen).toMatchObject({ rank: 1, probability: 0.6, total: 3, via: "picked" });
    // The same place was #3 in the primary's list - the view decides.
    const primaryPick = decideReducer(devState(), { type: "PICK", id: "c" });
    expect(primaryPick.chosen).toMatchObject({ rank: 3, probability: 0.1 });
  });

  it("the view survives going to the reveal and back, and resets on the next result", () => {
    let s = decideReducer(devState(), { type: "VIEW_ENGINE", engine: "gliner" });
    s = decideReducer(s, { type: "PICK", id: "b" });
    s = decideReducer(s, { type: "BACK_TO_RESULTS" });
    expect(s.viewEngine).toBe("gliner");
    s = decideReducer(s, { type: "SUBMIT_RANKED", response: rankedResponse() });
    expect(s.viewEngine).toBeNull();
  });
});

describe("session persistence", () => {
  const NOW = 1_000_000_000_000;
  const cards = {
    p1Name: "Alex",
    p2Name: "Sam",
    p1Text: "spicy",
    p1Mode: "typed" as const,
    p1Sealed: true,
    p2Text: "anything",
    p2Mode: "typed" as const,
    p2Sealed: true,
    radiusKm: 5,
  };
  const played = (phase: "results" | "mediator" | "wheel" | "reveal") => {
    const ranked = rankedResponse({ question, round: 1 });
    return {
      ...initialState("laya", false),
      ...cards,
      hydrated: true,
      phase,
      engineLocked: true,
      lastRanked: ranked,
      candidates: ranked.candidates,
      source: "osm" as const,
      round: 1,
      tiebreakers: [{ question_id: "setting", answer: "patio", text: "Outdoor" }],
      mediator: phase === "mediator" ? { question, kind: "close" as const, round: 1, engineLabel: "Laya" } : null,
      chosen:
        phase === "reveal"
          ? { candidate: candidate("b"), probability: 0.3, rank: 2, total: 3, via: "picked" as const }
          : null,
      spinWinnerId: phase === "wheel" ? "b" : null,
      savedKey: phase === "reveal" ? "b-picked-laya-1-100" : null,
    };
  };
  const roundTrip = (state: ReturnType<typeof played>, later = 60_000) => {
    // Through JSON, as sessionStorage would.
    const snap = JSON.parse(JSON.stringify(snapshotOf(state, NOW))) as SessionSnapshot;
    return decideReducer(initialState("laya", false), { type: "RESTORE_SESSION", snapshot: snap, now: NOW + later });
  };

  it("writes nothing while a request is in flight, so the previous snapshot stands", () => {
    expect(snapshotOf({ ...played("results"), phase: "submitting" }, NOW)).toBeNull();
  });

  it("restores the ranked list exactly, with the round it was on", () => {
    const s = roundTrip(played("results"));
    expect(s.phase).toBe("results");
    expect(s.lastRanked!.ranking.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(s.round).toBe(1);
    expect(s.tiebreakers).toHaveLength(1);
    expect(s.engineLocked).toBe(true);
    expect(s.candidates).toHaveLength(3);
    expect(s.hydrated).toBe(true);
  });

  it("restores an open question", () => {
    const s = roundTrip(played("mediator"));
    expect(s.phase).toBe("mediator");
    expect(s.mediator).toMatchObject({ kind: "close", round: 1 });
    expect(s.lastRanked).not.toBeNull();
  });

  it("restores the reveal with its choice and its saved-key, so it isn't saved to History twice", () => {
    const s = roundTrip(played("reveal"));
    expect(s.phase).toBe("reveal");
    expect(s.chosen).toMatchObject({ rank: 2, via: "picked" });
    expect(s.savedKey).toBe("b-picked-laya-1-100");
  });

  it("brings a mid-spin wheel back to its list rather than replaying the animation", () => {
    const s = roundTrip(played("wheel"));
    expect(s.phase).toBe("results");
    expect(s.spinWinnerId).toBeNull();
    expect(s.chosen).toBeNull();
  });

  it("keeps the engine view a Dev Mode user had selected", () => {
    const s = roundTrip({ ...played("results"), viewEngine: "gliner" });
    expect(s.viewEngine).toBe("gliner");
  });

  it("a round older than the age limit falls back to the sealed cards, keeping their text", () => {
    const s = roundTrip(played("results"), SESSION_MAX_AGE_MS + 1);
    expect(s.phase).toBe("input");
    expect(s.p1Text).toBe("spicy");
    expect(s.p1Sealed).toBe(true);
    expect(s.lastRanked).toBeNull();
    expect(s.round).toBe(0);
    expect(s.tiebreakers).toEqual([]);
    expect(s.engineLocked).toBe(false);
  });

  it("a snapshot missing what its phase needs falls back to input instead of a blank screen", () => {
    const noList = { ...snapshotOf(played("results"), NOW)!, lastRanked: null };
    expect(restoreFromSnapshot(noList, NOW).phase).toBe("input");
    const noChoice = { ...snapshotOf(played("reveal"), NOW)!, chosen: null };
    expect(restoreFromSnapshot(noChoice, NOW).phase).toBe("input");
    const noQuestion = { ...snapshotOf(played("mediator"), NOW)!, mediator: null };
    expect(restoreFromSnapshot(noQuestion, NOW).phase).toBe("input");
    const garbled = { ...snapshotOf(played("results"), NOW)!, lastRanked: { nope: true } as never };
    expect(restoreFromSnapshot(garbled, NOW).phase).toBe("input");
  });

  it("a snapshot written before rounds were persisted still restores its cards", () => {
    const old: SessionSnapshot = { ...cards, phase: "input" };
    const s = restoreFromSnapshot(old, NOW);
    expect(s.phase).toBe("input");
    expect(s.p1Text).toBe("spicy");
    expect(s.lastRanked).toBeNull();
  });

  it("names-phase snapshots stay on names", () => {
    const s = restoreFromSnapshot({ ...cards, phase: "names", savedAt: NOW }, NOW);
    expect(s.phase).toBe("names");
  });

  it("withoutRound drops the round (for a fresh Explore handoff) but keeps the cards", () => {
    const snap = withoutRound(snapshotOf(played("reveal"), NOW)!);
    const s = restoreFromSnapshot(snap, NOW);
    expect(s.phase).toBe("input");
    expect(s.p1Text).toBe("spicy");
    expect(s.lastRanked).toBeNull();
    expect(s.chosen).toBeNull();
    expect(s.candidates).toBeNull(); // none restored - the seeding handoff sets them next
  });

  it("MARK_SAVED records the key, and RESET clears it for the next round", () => {
    const s = decideReducer(played("reveal"), { type: "MARK_SAVED", key: "k" });
    expect(s.savedKey).toBe("k");
    expect(decideReducer(s, { type: "RESET" }).savedKey).toBeNull();
  });
});

describe("meal choice", () => {
  it("starts unset, meaning: let the server guess from the text and the clock", () => {
    expect(initialState("laya", false).mealChoice).toBeNull();
  });

  it("SET_MEAL records the couple's pick while they're setting up, and null goes back to auto", () => {
    const input = { ...initialState("laya", false), phase: "input" as const };
    const picked = decideReducer(input, { type: "SET_MEAL", meal: "dinner" });
    expect(picked.mealChoice).toBe("dinner");
    expect(decideReducer(picked, { type: "SET_MEAL", meal: null }).mealChoice).toBeNull();
  });

  it("SET_MEAL is ignored once a round is under way - its shortlist is already kept to one meal", () => {
    for (const phase of ["submitting", "results", "mediator", "wheel", "reveal"] as const) {
      const s = { ...initialState("laya", false), phase };
      expect(decideReducer(s, { type: "SET_MEAL", meal: "snack" })).toBe(s);
    }
  });

  it("survives leaving the page and coming back", () => {
    const s = { ...initialState("laya", false), phase: "input" as const, hydrated: true, mealChoice: "supper" as const };
    const snap = JSON.parse(JSON.stringify(snapshotOf(s, 1_000))) as SessionSnapshot;
    const back = decideReducer(initialState("laya", false), { type: "RESTORE_SESSION", snapshot: snap, now: 2_000 });
    expect(back.mealChoice).toBe("supper");
  });

  it("is kept even when a stale round falls back to the sealed cards, and for old snapshots without it", () => {
    const base = { ...initialState("laya", false), phase: "input" as const, hydrated: true, mealChoice: "breakfast" as const };
    const stale = restoreFromSnapshot({ ...snapshotOf(base, 0)!, phase: "results" }, SESSION_MAX_AGE_MS + 1);
    expect(stale.mealChoice).toBe("breakfast");
    const { mealChoice: _omit, ...legacy } = snapshotOf(base, 0)!;
    void _omit;
    expect(restoreFromSnapshot(legacy as SessionSnapshot, 0).mealChoice).toBeNull();
  });

  it("a new round (RESET) goes back to auto rather than carrying the last meal over", () => {
    const s = { ...initialState("laya", false), phase: "reveal" as const, mealChoice: "lunch" as const };
    expect(decideReducer(s, { type: "RESET" }).mealChoice).toBeNull();
  });
});
