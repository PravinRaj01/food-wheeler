"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { MapPin } from "lucide-react";
import { decideReducer, initialState, canSubmit } from "@/lib/decide/machine";
import type { SessionSnapshot } from "@/lib/decide/machine";
import { decide, listEngines, listPlaces, warmEngine } from "@/lib/api";
import type { Candidate, DecideRequest, EngineId, Location } from "@/lib/decide/types";
import { CUISINES } from "@/lib/decide/cuisines";
import { useLocation } from "@/lib/location/location-provider";
import { useOnline } from "@/lib/hooks/use-online";
import { useToast } from "@/lib/hooks/use-toast";
import { isDevModeEnabled } from "@/lib/dev-mode";
import { isCrossBorderEnabled } from "@/lib/cross-border";
import { local, session } from "@/lib/safe-storage";
import { getCurrentUserId } from "@/lib/actions/user";
import { enqueueDecision } from "@/lib/sync/outbox";
import { ToastStack } from "@/components/toast-stack";
import { PartnerCardCollapsed, PartnerCardPanel } from "@/components/decide/partner-card";
import { RadiusSlider } from "@/components/decide/radius-slider";
import { NamesStep } from "@/components/decide/names-step";
import { DecidingSequence } from "@/components/decide/deciding-sequence";
import type { PendingDecideResult } from "@/components/decide/deciding-sequence";
import { LocationPrompt } from "@/components/decide/location-prompt";
import { Wheel, slicesFromRanking } from "@/components/decide/wheel";
import { MediatorPanel } from "@/components/decide/mediator-panel";
import { RevealPanel } from "@/components/decide/reveal-panel";

const SEED_KEY = "fw_seeded_candidates";
const NAMES_KEY = "fw_names";
const NAMES_SKIPPED_KEY = "fw_names_skipped";
const SESSION_KEY = "fw_session";

// Shown identically to both partners - each chip either becomes visible
// text the engine reads (Craving/Mood/Heat/Budget) or trips a hard guard in
// apply_guards() (app.py): Budget/Treat ourselves match the budget-tier
// regexes, Halal/Vegetarian match the diet patterns, and the Nope group's
// "No X" phrasing matches the exclusion regex the same way free-typed text
// already does.
const CHIP_GROUPS = [
  { label: "Craving", chips: CUISINES.map((c) => c.label) },
  { label: "Mood", chips: ["Quick bite", "Sit-down"] },
  { label: "Heat", chips: ["Spicy", "Mild"] },
  { label: "Budget", chips: ["Budget", "Mid-range", "Treat ourselves"] },
  { label: "Must", chips: ["Halal", "Vegetarian"] },
  { label: "Nope", chips: ["No seafood", "No fast food"] },
];

export default function DecidePage() {
  const [state, dispatch] = useReducer(decideReducer, undefined, () => initialState("laya", false));
  const [userId, setUserId] = useState<string | null>(null);
  const [locationPromptOpen, setLocationPromptOpen] = useState(false);
  // Holds a resolved server response back from the reducer until the
  // deciding animation has actually finished playing (see DecidingSequence
  // and its onDone below) - so the wheel/mediator screen never appears a
  // beat before the "considering options, then landing on one" animation
  // has had its say, and a fast/cached round doesn't just flash past it.
  const [pendingResult, setPendingResult] = useState<PendingDecideResult | null>(null);
  const loc = useLocation();
  const isOnline = useOnline();
  const { toasts, toast } = useToast();

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
      radiusKm: state.radiusKm,
      source: m.source,
      winner: m.winner,
      runnerUps: m.ranking.filter((r) => r.id !== m.winner.id).slice(0, 5),
      tiebreakers: state.tiebreakers,
    }).catch(() => {
      /* the outbox write itself failing (e.g. IndexedDB unavailable) just
         means this one decision won't be in History - never block the UI */
    });
  }, [state.phase, state.lastMatch, state.p1Text, state.p2Text, state.radiusKm, state.tiebreakers, userId]);

  // Restore stored preferences post-mount only, so server and the first
  // client render match (see lib/safe-storage.ts) and there's no hydration
  // mismatch from a value baked into the initial render.
  useEffect(() => {
    const storedEngine = local.get("fw_engine", "laya") as EngineId;
    if (storedEngine !== "laya") dispatch({ type: "SET_ENGINE", engine: storedEngine });
    if (isDevModeEnabled()) dispatch({ type: "SET_DEV_MODE", value: true });

    // Resuming an interrupted round (a reload or a backgrounded PWA
    // reopened) takes priority over the plain names restore below, since
    // the snapshot already carries whatever names were in play plus
    // in-progress text - see the persistence effect further down for the
    // write side and what "resumable" means.
    const sessionRaw = session.get(SESSION_KEY, "");
    let restoredSession = false;
    if (sessionRaw) {
      try {
        const snapshot = JSON.parse(sessionRaw) as SessionSnapshot;
        if (snapshot && (snapshot.phase === "names" || snapshot.phase === "input")) {
          dispatch({ type: "RESTORE_SESSION", snapshot });
          restoredSession = true;
        }
      } catch {
        /* malformed - ignore, fall through to the plain names restore */
      }
    }

    // Names are asked once, ever, per browser (see components/decide/
    // names-step.tsx) - a returning visitor is skipped straight past the
    // "names" phase that initialState() always starts in. Saved-but-emptied
    // names (cleared from Settings) count as skipped too, same as never
    // having answered the prompt at all.
    if (!restoredSession) {
      const namesRaw = local.get(NAMES_KEY, "");
      let p1Name = "";
      let p2Name = "";
      if (namesRaw) {
        try {
          const parsed = JSON.parse(namesRaw) as { p1?: string; p2?: string };
          p1Name = parsed.p1 || "";
          p2Name = parsed.p2 || "";
        } catch {
          /* malformed - treat as unset */
        }
      }
      if (p1Name || p2Name) {
        dispatch({ type: "SET_NAMES", p1Name, p2Name });
      } else if (namesRaw || local.get(NAMES_SKIPPED_KEY, "0") === "1") {
        dispatch({ type: "SKIP_NAMES" });
      } else {
        // A genuinely first-ever visit: nothing to restore, but the
        // persistence write effect below still needs to know the restore
        // attempt has run (see hydrated's doc comment in machine.ts) before
        // it's safe to start writing.
        dispatch({ type: "MARK_HYDRATED" });
      }
    }

    // One-time handoff from Explore's "Add to tonight's wheel" - see
    // components/explore/place-card.tsx for the write side.
    const raw = session.get(SEED_KEY, "");
    if (raw) {
      try {
        const seeded = JSON.parse(raw) as { candidates: Candidate[]; source: "overture" | "osm" | "mock" };
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

  // Keep an in-progress round alive across a reload or the PWA being
  // backgrounded and killed - only while it's actually resumable (names or
  // input; wheel/mediator/reveal all depend on a live server response that
  // was never persisted, so there's nothing safe to restore into once past
  // input).
  //
  // Gated on `state.hydrated`, not just checked inline: without it, this
  // effect's very first run (before the mount-restore effect's dispatch
  // above has been applied to a render) would write the untouched DEFAULT
  // state - names/input all blank - and clobber a real saved snapshot with
  // blanks a moment before the restore could ever read it. Gating on state
  // (set by the SAME dispatches the restore effect already uses) rather
  // than a ref means this can't fire on that pre-restore render no matter
  // how these two effects happen to interleave.
  useEffect(() => {
    if (!state.hydrated) return;
    if (state.phase !== "names" && state.phase !== "input") return;
    const snapshot: SessionSnapshot = {
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
    };
    session.set(SESSION_KEY, JSON.stringify(snapshot));
  }, [
    state.hydrated,
    state.phase,
    state.p1Name,
    state.p2Name,
    state.p1Text,
    state.p1Mode,
    state.p1Sealed,
    state.p2Text,
    state.p2Mode,
    state.p2Sealed,
    state.radiusKm,
  ]);

  // Reaching reveal means the round is done - clear the snapshot so
  // reopening the app later starts fresh instead of resuming a completed
  // round's half-finished-looking leftovers.
  useEffect(() => {
    if (state.phase === "reveal") session.set(SESSION_KEY, "");
  }, [state.phase]);

  // Warm the backend's Overpass cache while the couple is still typing, so
  // by the time they tap "Find Our Table" the real fetch (the slow part -
  // up to 25s uncached at a big radius) is usually already done. Debounced
  // so dragging the radius slider doesn't fire a request per pixel; result
  // is ignored entirely, this is purely a cache-warming side effect.
  useEffect(() => {
    if (loc.status !== "granted" || !loc.location) return;
    if (state.phase !== "input") return;
    const handle = setTimeout(() => {
      listPlaces(loc.location, state.radiusKm, { crossBorder: isCrossBorderEnabled() }).catch(() => {});
    }, 800);
    return () => clearTimeout(handle);
  }, [loc.status, loc.location, state.radiusKm, state.phase]);

  // The engine picker itself now lives in Settings, under "Under the hood"
  // - this just keeps whatever's stored in fw_engine actually usable:
  // falling back if it's since become unavailable, and warming it so the
  // first real submit isn't also paying a cold-load cost.
  useEffect(() => {
    listEngines()
      .then((list) => {
        const current = list.find((e) => e.id === state.engine);
        if (!current?.available) {
          const fallback = list.find((e) => e.default)?.id ?? list[0]?.id;
          if (fallback) dispatch({ type: "SET_ENGINE", engine: fallback });
        }
        warmEngine(state.engine).catch(() => {});
      })
      .catch(() => {});
    // Only on mount - engine availability is refreshed here, not polled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A fast double-tap on "Find Our Table" could otherwise fire two requests
  // before the re-render that hides the button lands - this closes that gap
  // regardless of render timing.
  const submittingRef = useRef(false);

  const submit = useCallback(
    async (overrides?: { tiebreakers?: typeof state.tiebreakers; round?: number; location?: Location | null }) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      dispatch({ type: "SUBMIT_START" });
      const body: DecideRequest = {
        engine: state.engine,
        dev_mode: state.devMode,
        partner1: { text: state.p1Text.trim(), input_mode: state.p1Mode },
        partner2: { text: state.p2Text.trim(), input_mode: state.p2Mode },
        // overrides.location wins when given (a just-resolved fix from
        // findTable()/the drawer - see their comments for why loc.location
        // itself can't be trusted at the moment those call this).
        location: overrides && "location" in overrides ? (overrides.location ?? null) : loc.location,
        candidates: state.candidates,
        source: state.source,
        tiebreakers: overrides?.tiebreakers ?? state.tiebreakers,
        round: overrides?.round ?? state.round,
        radius_km: state.radiusKm,
        cross_border: isCrossBorderEnabled(),
      };
      try {
        const res = await decide(body);
        // A real result is handed to the deciding animation, not dispatched
        // straight away - handleDecidingDone() below does the actual
        // dispatch once it's finished playing. An error skips all of that
        // and dispatches immediately, per the plan: nothing to animate
        // toward when there's nothing to show.
        if (res.status === "match") setPendingResult({ kind: "match", response: res });
        else if (res.status === "tiebreaker") setPendingResult({ kind: "tiebreaker", response: res });
        else {
          setPendingResult(null);
          toast(res.message || "Something went wrong.");
          dispatch({ type: "SUBMIT_ERROR", message: res.message });
        }
      } catch (err) {
        setPendingResult(null);
        const timedOut = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
        toast(
          timedOut
            ? "That's taking too long - your third wheel might be waking up. Try again in a moment."
            : "Could not reach the server. Check your connection and try again.",
        );
        dispatch({ type: "SUBMIT_ERROR", message: "network" });
      } finally {
        submittingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.engine, state.devMode, state.p1Text, state.p1Mode, state.p2Text, state.p2Mode, loc.location, state.candidates, state.source, state.tiebreakers, state.round, state.radiusKm],
  );

  // "Find Our Table" goes through here first: a real location is required,
  // not optional - there's no demo fallback to fall through to. If location
  // was already enabled on a previous visit, this fetches (or reuses) a fix
  // via ensureLocation() and submits with THAT value directly - never
  // loc.location from this closure, which can still be null the instant
  // after a fix resolves (the exact stale-closure bug that sent
  // location: null right after tapping "Enable location" in the drawer).
  // Only a first-ever ask (never enabled before) opens the drawer.
  const findTable = async () => {
    if (!loc.enabled) {
      setLocationPromptOpen(true);
      return;
    }
    if (loc.status === "blocked") {
      setLocationPromptOpen(true);
      return;
    }
    const fresh = await loc.ensureLocation();
    if (fresh) {
      submit({ location: fresh });
    } else {
      toast("Couldn't get your location - check your browser's permission for this site and try again.");
    }
  };

  // Fires once the deciding animation has actually finished playing (see
  // DecidingSequence's onDone) - this is where a resolved response finally
  // becomes real reducer state.
  const handleDecidingDone = useCallback(() => {
    setPendingResult((current) => {
      if (!current) return current;
      if (current.kind === "match") dispatch({ type: "SUBMIT_MATCH", response: current.response });
      else dispatch({ type: "SUBMIT_TIEBREAKER", response: current.response });
      return null;
    });
  }, []);

  const resetGame = () => dispatch({ type: "RESET" });

  return (
    // LayoutGroup, not just AnimatePresence: the shared-layout morph spans
    // three different render sites (the collapsed card in this component,
    // its panel also in this component, and DecidingSequence's matching
    // pill in a completely different subtree) - one group ties Motion's
    // layout projection together across all of them.
    <LayoutGroup>
    <div className="mx-auto max-w-lg px-5 py-6">
      <ToastStack toasts={toasts} />

      <header className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-lg font-semibold tracking-tight">
            Food Wheeler{state.devMode && <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] tracking-wide text-cream/50 uppercase">Dev</span>}
          </h1>
        </div>
        <Link
          href="/settings"
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-glass px-3 py-1.5 text-xs text-cream/60"
        >
          <MapPin className="h-3.5 w-3.5" />
          {loc.status === "granted" ? "Near you" : loc.status === "locating" ? "Locating…" : "Location off"}
        </Link>

        {state.phase === "input" && (
          <div className="mt-4">
            <RadiusSlider
              km={state.radiusKm}
              locked={state.engineLocked}
              onChange={(km) => dispatch({ type: "SET_RADIUS_KM", km })}
            />
          </div>
        )}
      </header>

      {/* popLayout, not wait: "wait" fully unmounts the input phase before
          mounting "submitting", which would never give the sealed cards and
          DecidingSequence's matching-layoutId pills the overlapping frame
          they need to actually morph into each other - see partner-card.tsx
          and deciding-sequence.tsx's own comments on this. */}
      <AnimatePresence mode="popLayout">
        {state.phase === "names" && (
          <NamesStep
            key="names"
            onContinue={(p1Name, p2Name) => dispatch({ type: "SET_NAMES", p1Name, p2Name })}
            onSkip={() => dispatch({ type: "SKIP_NAMES" })}
          />
        )}

        {state.phase === "input" && (
          <div key="input" className="space-y-4">
            {/* Each slot is a permanently-present h-32 box, not a
                collapsed-card-or-placeholder swap - the box itself must
                never change size/position when the OTHER card opens, or
                Motion's layout system can treat that as a real layout
                change for this card too (it shares a LayoutGroup) and
                briefly boost it above the backdrop/panel while resolving
                it, which is exactly what looked like the other card
                "leaking through" the overlay. */}
            <div className="grid grid-cols-2 gap-3">
              <div className="h-32">
                {state.openCard !== 1 && (
                  <PartnerCardCollapsed
                    number={1}
                    label={state.p1Name || "Partner One"}
                    sealed={state.p1Sealed}
                    hasText={Boolean(state.p1Text.trim())}
                    disabled={state.engineLocked}
                    accentVar="--p1"
                    onOpen={() => dispatch({ type: "OPEN_CARD", card: 1 })}
                  />
                )}
              </div>
              <div className="h-32">
                {state.openCard !== 2 && (
                  <PartnerCardCollapsed
                    number={2}
                    label={state.p2Name || "Partner Two"}
                    sealed={state.p2Sealed}
                    hasText={Boolean(state.p2Text.trim())}
                    disabled={state.engineLocked}
                    accentVar="--p2"
                    onOpen={() => dispatch({ type: "OPEN_CARD", card: 2 })}
                  />
                )}
              </div>
            </div>

            {canSubmit(state) && (
              <>
                <button
                  type="button"
                  disabled={!isOnline}
                  onClick={findTable}
                  className="w-full rounded-xl bg-ember py-3 text-base font-medium text-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Find Our Table
                </button>
                {!isOnline && (
                  <p className="text-center text-xs text-cream/40">You&apos;re offline - reconnect to ask your third wheel.</p>
                )}
              </>
            )}
          </div>
        )}

        {state.phase === "submitting" && (
          <DecidingSequence
            key="submitting"
            p1Name={state.p1Name}
            p2Name={state.p2Name}
            p1Text={state.p1Text}
            p2Text={state.p2Text}
            pendingResult={pendingResult}
            onDone={handleDecidingDone}
          />
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
            p1Name={state.p1Name}
            p2Name={state.p2Name}
            p1Text={state.p1Text}
            p2Text={state.p2Text}
            userLocation={loc.location}
            devMode={state.devMode}
            onStartOver={resetGame}
          />
        )}
      </AnimatePresence>

      {/* The morphed-open card panel, plus its backdrop - portaled straight
          to <body>, not just `fixed` in place. `position: fixed` is only
          fixed to the true viewport as long as NO ancestor sets a
          transform/filter/backdrop-filter/will-change (any of those makes
          it a new containing block instead) - Motion's own layout-animated
          elements do exactly that, which is what let the other card show
          through at near-full opacity instead of being dimmed underneath.
          Every other overlay in this app (the location/install drawers)
          gets this for free from vaul's own Portal; this one didn't have
          one. Only ever mounted during "input". */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {state.openCard != null && (
              <motion.div
                key="card-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/70"
                onClick={() => dispatch({ type: "CLOSE_CARD" })}
              />
            )}
            {state.openCard === 1 && (
              <PartnerCardPanel
                key="panel-1"
                number={1}
                label={state.p1Name || "Partner One"}
                text={state.p1Text}
                sealed={state.p1Sealed}
                onTextChange={(text, mode) => dispatch({ type: "SET_P1_TEXT", text, mode })}
                placeholder="Spicy, under RM30, somewhere close…"
                chipGroups={CHIP_GROUPS}
                accentVar="--p1"
                onDone={() => dispatch({ type: "SEAL_CARD", card: 1 })}
                onNoPreference={() => dispatch({ type: "SEAL_NO_PREFERENCE", card: 1 })}
                onRedo={() => dispatch({ type: "REDO_CARD", card: 1 })}
                onClose={() => dispatch({ type: "CLOSE_CARD" })}
                onSpeechError={toast}
              />
            )}
            {state.openCard === 2 && (
              <PartnerCardPanel
                key="panel-2"
                number={2}
                label={state.p2Name || "Partner Two"}
                text={state.p2Text}
                sealed={state.p2Sealed}
                onTextChange={(text, mode) => dispatch({ type: "SET_P2_TEXT", text, mode })}
                placeholder="Casual, a patio if possible, no burgers…"
                chipGroups={CHIP_GROUPS}
                accentVar="--p2"
                onDone={() => dispatch({ type: "SEAL_CARD", card: 2 })}
                onNoPreference={() => dispatch({ type: "SEAL_NO_PREFERENCE", card: 2 })}
                onRedo={() => dispatch({ type: "REDO_CARD", card: 2 })}
                onClose={() => dispatch({ type: "CLOSE_CARD" })}
                onSpeechError={toast}
              />
            )}
          </AnimatePresence>,
          document.body,
        )}

      <LocationPrompt
        open={locationPromptOpen}
        status={loc.status}
        onOpenChange={setLocationPromptOpen}
        onEnable={async () => {
          const fresh = await loc.enable();
          setLocationPromptOpen(false);
          if (fresh) {
            submit({ location: fresh });
          } else {
            // No demo fallback to fall through to - say so plainly rather
            // than silently doing nothing.
            toast("Couldn't get your location - check your browser's permission for this site and try again.");
          }
        }}
      />
    </div>
    </LayoutGroup>
  );
}
