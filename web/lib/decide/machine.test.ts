import { describe, expect, it } from "vitest";
import { canSubmit, decideReducer, initialState } from "./machine";
import type { Candidate, MatchResponse, TiebreakerResponse } from "./types";

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

const matchResponse = (overrides: Partial<MatchResponse> = {}): MatchResponse => ({
  status: "match",
  reason: "confident",
  confidence: 0.9,
  source: "osm",
  winner: candidate("a"),
  ranking: [{ id: "a", name: "a", probability: 0.9, color: "#fff" }],
  candidates: [candidate("a")],
  round: 0,
  latency_ms: 100,
  engine: { id: "laya", label: "Laya", score_type: "probability", raw_top: 0.9, fallback_from: null, latency_ms: 100 },
  ...overrides,
});

const tiebreakerResponse = (overrides: Partial<TiebreakerResponse> = {}): TiebreakerResponse => ({
  status: "tiebreaker",
  reason: "low_confidence",
  confidence: 0.3,
  round: 0,
  rounds_left: 1,
  question: { id: "q1", prompt: "?", options: [{ answer: "a", label: "A", text: "a" }] },
  contenders: [],
  candidates: [],
  source: "osm",
  engine: { id: "laya", label: "Laya", score_type: "probability", raw_top: 0.3, fallback_from: null, latency_ms: 100 },
  ...overrides,
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

  it("OPEN_CARD reopening a SEALED card clears its text - no peeking at what was typed", () => {
    const sealed = { ...initialState("laya", false), p1Sealed: true, p1Text: "spicy", p1Mode: "voice" as const };
    const s = decideReducer(sealed, { type: "OPEN_CARD", card: 1 });
    expect(s.openCard).toBe(1);
    expect(s.p1Sealed).toBe(false);
    expect(s.p1Text).toBe("");
    expect(s.p1Mode).toBe("typed");
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

  it("SUBMIT_MATCH moves to wheel and stores the response, candidates and source", () => {
    const response = matchResponse({ candidates: [candidate("a"), candidate("b")], source: "mock" });
    const s = decideReducer(initialState("laya", false), { type: "SUBMIT_MATCH", response });
    expect(s.phase).toBe("wheel");
    expect(s.lastMatch).toBe(response);
    expect(s.candidates).toEqual(response.candidates);
    expect(s.source).toBe("mock");
  });

  it("SUBMIT_MATCH skips the wheel and goes straight to reveal when only one candidate survived", () => {
    const response = matchResponse({ reason: "only_option", candidates: [candidate("a")], source: "mock" });
    const s = decideReducer(initialState("laya", false), { type: "SUBMIT_MATCH", response });
    expect(s.phase).toBe("reveal");
    expect(s.lastMatch).toBe(response);
  });

  it("SUBMIT_TIEBREAKER moves to mediator and stores the response, candidates and source", () => {
    const response = tiebreakerResponse({ candidates: [candidate("a")], source: "osm" });
    const s = decideReducer(initialState("laya", false), { type: "SUBMIT_TIEBREAKER", response });
    expect(s.phase).toBe("mediator");
    expect(s.lastTiebreaker).toBe(response);
    expect(s.candidates).toEqual(response.candidates);
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

  it("SUBMIT_ERROR from a later round falls back to mediator instead of losing the tiebreaker context", () => {
    const submitting = { ...initialState("laya", false), phase: "submitting" as const, round: 1 };
    const s = decideReducer(submitting, { type: "SUBMIT_ERROR", message: "network" });
    expect(s.phase).toBe("mediator");
  });

  it("SUBMIT_ERROR outside of submitting leaves the phase alone", () => {
    const s = decideReducer({ ...initialState("laya", false), phase: "wheel" }, { type: "SUBMIT_ERROR", message: "x" });
    expect(s.phase).toBe("wheel");
  });

  it("ANSWER_MEDIATOR appends the tiebreaker and advances the round from the response", () => {
    const withTiebreaker = { ...initialState("laya", false), lastTiebreaker: tiebreakerResponse({ round: 1 }) };
    const answer = { question_id: "q1", answer: "a", text: "A" };
    const s = decideReducer(withTiebreaker, { type: "ANSWER_MEDIATOR", tiebreaker: answer });
    expect(s.tiebreakers).toEqual([answer]);
    expect(s.round).toBe(2);
  });

  it("SPIN_ANYWAY forces round to 2 so the next submit is treated as a fair spin", () => {
    const s = decideReducer(initialState("laya", false), { type: "SPIN_ANYWAY" });
    expect(s.round).toBe(2);
  });

  it("WHEEL_LANDED moves to reveal", () => {
    const s = decideReducer({ ...initialState("laya", false), phase: "wheel" }, { type: "WHEEL_LANDED" });
    expect(s.phase).toBe("reveal");
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
