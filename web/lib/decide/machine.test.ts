import { describe, expect, it } from "vitest";
import { decideReducer, initialState } from "./machine";
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
  question: { id: "q1", prompt: "?", options: [{ answer: "a", label: "A", emoji: "🍜", text: "a" }] },
  contenders: [],
  candidates: [],
  source: "osm",
  engine: { id: "laya", label: "Laya", score_type: "probability", raw_top: 0.3, fallback_from: null, latency_ms: 100 },
  ...overrides,
});

describe("initialState", () => {
  it("starts on p1 with the given engine and dev mode", () => {
    const s = initialState("gliner", true);
    expect(s.phase).toBe("p1");
    expect(s.engine).toBe("gliner");
    expect(s.devMode).toBe(true);
    expect(s.engineLocked).toBe(false);
    expect(s.radiusKm).toBe(1.5);
  });
});

describe("decideReducer", () => {
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

  it("PASS_TO_P2 is a no-op when partner one's text is blank", () => {
    const s = decideReducer(initialState("laya", false), { type: "PASS_TO_P2" });
    expect(s.phase).toBe("p1");
  });

  it("PASS_TO_P2 moves to handoff once partner one has typed something", () => {
    let s = decideReducer(initialState("laya", false), { type: "SET_P1_TEXT", text: "spicy" });
    s = decideReducer(s, { type: "PASS_TO_P2" });
    expect(s.phase).toBe("handoff");
  });

  it("PASS_TO_P2 rejects whitespace-only text", () => {
    let s = decideReducer(initialState("laya", false), { type: "SET_P1_TEXT", text: "   " });
    s = decideReducer(s, { type: "PASS_TO_P2" });
    expect(s.phase).toBe("p1");
  });

  it("HANDOFF_DONE moves from handoff to p2", () => {
    const s = decideReducer({ ...initialState("laya", false), phase: "handoff" }, { type: "HANDOFF_DONE" });
    expect(s.phase).toBe("p2");
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

  it("TOGGLE_DEV_MODE flips devMode", () => {
    let s = decideReducer(initialState("laya", false), { type: "TOGGLE_DEV_MODE" });
    expect(s.devMode).toBe(true);
    s = decideReducer(s, { type: "TOGGLE_DEV_MODE" });
    expect(s.devMode).toBe(false);
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

  it("SUBMIT_TIEBREAKER moves to mediator and stores the response, candidates and source", () => {
    const response = tiebreakerResponse({ candidates: [candidate("a")], source: "osm" });
    const s = decideReducer(initialState("laya", false), { type: "SUBMIT_TIEBREAKER", response });
    expect(s.phase).toBe("mediator");
    expect(s.lastTiebreaker).toBe(response);
    expect(s.candidates).toEqual(response.candidates);
  });

  it("SUBMIT_ERROR from a first-round submit falls back to p2 so the user can retry", () => {
    const submitting = { ...initialState("laya", false), phase: "submitting" as const, round: 0 };
    const s = decideReducer(submitting, { type: "SUBMIT_ERROR", message: "network" });
    expect(s.phase).toBe("p2");
    expect(s.errorMessage).toBe("network");
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

  it("RESET returns to a fresh p1 state but keeps location and radius tier preferences", () => {
    const played = {
      ...initialState("laya", true),
      phase: "reveal" as const,
      p1Text: "spicy",
      p2Text: "casual",
      engineLocked: true,
      location: { lat: 1, lng: 2 },
      radiusKm: 15,
      tiebreakers: [{ question_id: "q", answer: "a", text: "A" }],
    };
    const s = decideReducer(played, { type: "RESET" });
    expect(s.phase).toBe("p1");
    expect(s.p1Text).toBe("");
    expect(s.p2Text).toBe("");
    expect(s.engineLocked).toBe(false);
    expect(s.tiebreakers).toEqual([]);
    expect(s.location).toEqual({ lat: 1, lng: 2 });
    expect(s.radiusKm).toBe(15);
    // devMode and engine survive RESET too, since initialState is seeded from them.
    expect(s.devMode).toBe(true);
  });

  it("ignores unknown action types", () => {
    const s = initialState("laya", false);
    // @ts-expect-error - deliberately invalid action for the default branch
    expect(decideReducer(s, { type: "NOT_REAL" })).toBe(s);
  });
});
