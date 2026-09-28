"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { MapPin } from "lucide-react";
import { decideReducer, initialState } from "@/lib/decide/machine";
import { decide, listEngines, warmEngine } from "@/lib/api";
import type { Candidate, DecideRequest, EngineId, EngineListItem } from "@/lib/decide/types";
import { useGeolocation } from "@/lib/hooks/use-geolocation";
import { useToast } from "@/lib/hooks/use-toast";
import { useDevModeTrigger } from "@/lib/hooks/use-dev-mode-trigger";
import { local, session } from "@/lib/safe-storage";
import { getCurrentUserId } from "@/lib/actions/user";
import { enqueueDecision } from "@/lib/sync/outbox";
import { ToastStack } from "@/components/toast-stack";
import { PartnerCard } from "@/components/decide/partner-card";
import { EngineToggle } from "@/components/decide/engine-toggle";
import { RadiusTierChips } from "@/components/decide/radius-tier-chips";
import { HandoffScreen } from "@/components/decide/handoff-screen";
import { Wheel, slicesFromRanking } from "@/components/decide/wheel";
import { MediatorPanel } from "@/components/decide/mediator-panel";
import { RevealPanel } from "@/components/decide/reveal-panel";

const SEED_KEY = "fw_seeded_candidates";

const P1_CHIPS = ["Spicy", "Outdoor patio", "Under $30", "Vegan-friendly"];
const P2_CHIPS = ["Casual", "No burgers", "Halal", "Gluten-free"];

export default function DecidePage() {
  const [state, dispatch] = useReducer(decideReducer, undefined, () => initialState("laya", false));
  const [engines, setEngines] = useState<EngineListItem[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const geo = useGeolocation();
  const { toasts, toast } = useToast();
  const devTrigger = useDevModeTrigger(() => {
    dispatch({ type: "TOGGLE_DEV_MODE" });
  });

  useEffect(() => {
    getCurrentUserId().then(setUserId).catch(() => setUserId(null));
  }, []);

  // Save every reveal to the local-first outbox (see lib/sync/outbox.ts) -
  // guests get it too (ownerId: null), claimed automatically on their next
  // login. Guarded by clientId so a re-render on the reveal screen (e.g.
  // toggling Dev Mode) can't enqueue the same decision twice.
  const savedClientIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.phase !== "reveal" || !state.lastMatch) return;
    const clientId = `${state.lastMatch.winner.id}-${state.lastMatch.round}-${state.lastMatch.latency_ms}`;
    if (savedClientIdRef.current === clientId) return;
    savedClientIdRef.current = clientId;

    const m = state.lastMatch;
    enqueueDecision(userId, {
      clientId: crypto.randomUUID(),
      partner1Text: state.p1Text.trim(),
      partner2Text: state.p2Text.trim(),
      engine: m.engine.id,
      confidence: m.confidence,
      reason: m.reason,
      radiusTier: state.radiusTier,
      source: m.source,
      winner: m.winner,
      runnerUps: m.ranking.filter((r) => r.id !== m.winner.id).slice(0, 5),
      tiebreakers: state.tiebreakers,
    }).catch(() => {
      /* the outbox write itself failing (e.g. IndexedDB unavailable) just
         means this one decision won't be in History - never block the UI */
    });
  }, [state.phase, state.lastMatch, state.p1Text, state.p2Text, state.radiusTier, state.tiebreakers, userId]);

  // Restore stored preferences post-mount only, so server and the first
  // client render match (see lib/safe-storage.ts) and there's no hydration
  // mismatch from a value baked into the initial render.
  useEffect(() => {
    const storedEngine = local.get("fw_engine", "laya") as EngineId;
    if (storedEngine !== "laya") dispatch({ type: "SET_ENGINE", engine: storedEngine });
    if (session.get("fw_dev_mode", "0") === "1") dispatch({ type: "SET_DEV_MODE", value: true });

    // One-time handoff from Explore's "Add to tonight's wheel" - see
    // components/explore/place-card.tsx for the write side.
    const raw = session.get(SEED_KEY, "");
    if (raw) {
      try {
        const seeded = JSON.parse(raw) as { candidates: Candidate[]; source: "osm" | "mock" };
        if (seeded.candidates?.length) {
          dispatch({ type: "SEED_CANDIDATES", candidates: seeded.candidates, source: seeded.source });
          toast(`Added ${seeded.candidates[0].name} to tonight's wheel`);
        }
      } catch {
        /* malformed - ignore */
      }
      try {
        window.sessionStorage.removeItem(SEED_KEY);
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listEngines()
      .then((list) => {
        setEngines(list);
        const current = list.find((e) => e.id === state.engine);
        if (!current?.available) {
          const fallback = list.find((e) => e.default)?.id ?? list[0]?.id;
          if (fallback) dispatch({ type: "SET_ENGINE", engine: fallback });
        }
        warmEngine(state.engine).catch(() => {});
      })
      .catch(() => setEngines([{ id: "laya", label: "Laya", available: true, loaded: false, default: true }]));
    // Only on mount - engine availability is refreshed here, not polled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    session.set("fw_dev_mode", state.devMode ? "1" : "0");
    if (state.devMode) toast("Developer mode enabled");
  }, [state.devMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectEngine = (id: EngineId) => {
    if (state.engineLocked) return;
    const entry = engines.find((e) => e.id === id);
    if (!entry?.available) {
      toast(entry?.reason ?? "That engine is unavailable.");
      return;
    }
    dispatch({ type: "SET_ENGINE", engine: id });
    local.set("fw_engine", id);
    if (!entry.loaded) {
      toast(`Warming up ${entry.label}…`);
      warmEngine(id).catch(() => {});
    }
  };

  const submit = useCallback(
    async (overrides?: { tiebreakers?: typeof state.tiebreakers; round?: number }) => {
      dispatch({ type: "SUBMIT_START" });
      const body: DecideRequest = {
        engine: state.engine,
        dev_mode: state.devMode,
        partner1: { text: state.p1Text.trim(), input_mode: state.p1Mode },
        partner2: { text: state.p2Text.trim(), input_mode: state.p2Mode },
        location: geo.location,
        candidates: state.candidates,
        source: state.source,
        tiebreakers: overrides?.tiebreakers ?? state.tiebreakers,
        round: overrides?.round ?? state.round,
        radius_tier: state.radiusTier,
      };
      try {
        const res = await decide(body);
        if (res.status === "match") dispatch({ type: "SUBMIT_MATCH", response: res });
        else if (res.status === "tiebreaker") dispatch({ type: "SUBMIT_TIEBREAKER", response: res });
        else {
          toast(res.message || "Something went wrong.");
          dispatch({ type: "SUBMIT_ERROR", message: res.message });
        }
      } catch {
        toast("Could not reach the server. Check your connection and try again.");
        dispatch({ type: "SUBMIT_ERROR", message: "network" });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.engine, state.devMode, state.p1Text, state.p1Mode, state.p2Text, state.p2Mode, geo.location, state.candidates, state.source, state.tiebreakers, state.round, state.radiusTier],
  );

  const resetGame = () => dispatch({ type: "RESET" });

  return (
    <div className="mx-auto max-w-lg px-5 py-6">
      <ToastStack toasts={toasts} />

      <header className="mb-6">
        {engines.length > 0 && (
          <EngineToggle engines={engines} selected={state.engine} locked={state.engineLocked} onSelect={selectEngine} />
        )}
        <div className="mt-4 flex items-center justify-between">
          <h1
            className="font-display cursor-default text-lg font-semibold tracking-tight select-none"
            onClick={devTrigger.onClick}
            onTouchEnd={devTrigger.onTouchEnd}
          >
            Food Wheeler{state.devMode && <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] tracking-wide text-cream/50 uppercase">Dev</span>}
          </h1>
        </div>
        <button
          type="button"
          onClick={geo.request}
          className="mt-3 flex items-center gap-1.5 rounded-full bg-glass px-3 py-1.5 text-xs text-cream/60"
        >
          <MapPin className="h-3.5 w-3.5" />
          {geo.status === "locating" ? "Locating…" : geo.status === "granted" ? "Near you" : geo.status === "denied" ? "Demo location" : "Use my location"}
        </button>

        {(state.phase === "p1" || state.phase === "p2") && (
          <div className="mt-4">
            <RadiusTierChips
              selected={state.radiusTier}
              locked={state.engineLocked}
              onSelect={(tier) => dispatch({ type: "SET_RADIUS_TIER", tier })}
            />
          </div>
        )}
      </header>

      <AnimatePresence mode="wait">
        {(state.phase === "p1" || state.phase === "p2") && (
          <div key="input" className="space-y-4">
            <PartnerCard
              number={1}
              label="Partner One"
              text={state.p1Text}
              onTextChange={(text, mode) => dispatch({ type: "SET_P1_TEXT", text, mode })}
              placeholder="Spicy, under $30, somewhere close…"
              chips={P1_CHIPS}
              state={state.phase === "p1" ? "active" : "locked"}
              accentVar="--p1"
              onSpeechError={toast}
            />
            <PartnerCard
              number={2}
              label="Partner Two"
              text={state.p2Text}
              onTextChange={(text, mode) => dispatch({ type: "SET_P2_TEXT", text, mode })}
              placeholder="Casual, a patio if possible, no burgers…"
              chips={P2_CHIPS}
              state={state.phase === "p2" ? "active" : "waiting"}
              accentVar="--p2"
              onSpeechError={toast}
            />
            {state.phase === "p1" ? (
              <button
                type="button"
                disabled={!state.p1Text.trim()}
                onClick={() => dispatch({ type: "PASS_TO_P2" })}
                className="w-full rounded-xl bg-ember py-3 text-sm font-medium text-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
              >
                Pass to Partner Two
              </button>
            ) : (
              <button
                type="button"
                disabled={!state.p1Text.trim() && !state.p2Text.trim()}
                onClick={() => submit()}
                className="w-full rounded-xl bg-ember py-3 text-base font-medium text-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
              >
                Find Our Table
              </button>
            )}
          </div>
        )}

        {state.phase === "handoff" && (
          <HandoffScreen key="handoff" onDone={() => dispatch({ type: "HANDOFF_DONE" })} />
        )}

        {state.phase === "submitting" && (
          <div key="submitting" role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-24 text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-ember" />
            <p className="text-sm text-cream/60">Finding your table…</p>
          </div>
        )}

        {state.phase === "wheel" && state.lastMatch && (
          <div key="wheel" className="py-8">
            <Wheel
              slices={slicesFromRanking(state.lastMatch.ranking, state.lastMatch.wheel_ids)}
              winnerId={state.lastMatch.winner.id}
              fair={state.lastMatch.reason === "fair_spin"}
              engineLabel={state.lastMatch.engine.label}
              onLanded={() => dispatch({ type: "WHEEL_LANDED" })}
            />
          </div>
        )}

        {state.phase === "mediator" && state.lastTiebreaker && (
          <MediatorPanel
            key="mediator"
            response={state.lastTiebreaker}
            devMode={state.devMode}
            onAnswer={(tb) => {
              const round = state.lastTiebreaker!.round + 1;
              dispatch({ type: "ANSWER_MEDIATOR", tiebreaker: tb });
              submit({ tiebreakers: [...state.tiebreakers, tb], round });
            }}
            onSpinAnyway={() => {
              dispatch({ type: "SPIN_ANYWAY" });
              submit({ round: 2 });
            }}
          />
        )}

        {state.phase === "reveal" && state.lastMatch && (
          <RevealPanel
            key="reveal"
            response={state.lastMatch}
            p1Text={state.p1Text}
            p2Text={state.p2Text}
            userLocation={geo.location}
            devMode={state.devMode}
            onStartOver={resetGame}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
