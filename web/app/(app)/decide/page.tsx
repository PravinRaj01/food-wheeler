"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { decideReducer, initialState, canSubmit, viewedResponse, activeRanking } from "@/lib/decide/machine";
import type { SessionSnapshot } from "@/lib/decide/machine";
import { snapshotOf, withoutRound } from "@/lib/decide/machine";
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
import { MealChip } from "@/components/decide/meal-chip";
import type { PendingDecideResult } from "@/components/decide/deciding-sequence";
import { LocationPrompt } from "@/components/decide/location-prompt";
import { Wheel } from "@/components/decide/wheel";
import { ResultsList } from "@/components/decide/results-list";
import { MediatorPanel } from "@/components/decide/mediator-panel";
import { RevealPanel } from "@/components/decide/reveal-panel";
import { pickWeighted, topWeights } from "@/lib/decide/weighted";

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
  {
    label: "Must",
    chips: [
      "Halal",
      "Vegetarian",
      // Inserted as a demand ("must have chicken"), which the server turns
      // into a hard rule - see musts.py - rather than just a mention.
      { label: "Chicken", insert: "must have chicken" },
      { label: "Seafood", insert: "must have seafood" },
      { label: "Beef", insert: "must have beef" },
      { label: "Noodles", insert: "must have noodles" },
      { label: "Rice", insert: "must have rice" },
    ],
  },
  { label: "Nope", chips: ["No seafood", "No fast food"] },
];

export default function DecidePage() {
  const [state, dispatch] = useReducer(decideReducer, undefined, () => initialState("laya", false));
  const [userId, setUserId] = useState<string | null>(null);
  const [locationPromptOpen, setLocationPromptOpen] = useState(false);
  const [finding, setFinding] = useState(false);
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
  // login. Guarded by a key so a re-render on the reveal screen can't
  // enqueue the same decision twice; picking a DIFFERENT place after going
  // back to the list is a genuinely new decision and gets its own entry.
  // The key is in two places on purpose: the ref blocks a same-tick repeat
  // (React StrictMode re-runs effects before the state update lands), and
  // state.savedKey is what survives leaving the page and coming back to a
  // restored reveal - without it that would save the decision again.
  const savedClientIdRef = useRef<string | null>(null);
  const mountRestoreRanRef = useRef(false);
  useEffect(() => {
    const m = viewedResponse(state);
    if (state.phase !== "reveal" || !state.chosen || !m) return;
    const { chosen } = state;
    // m is the VIEWED response (Dev Mode can be showing a non-primary
    // engine's list), so the engine and runner-ups saved are the ones the
    // pick was actually made against.
    const clientId = `${chosen.candidate.id}-${chosen.via}-${m.engine.id}-${m.round}-${m.latency_ms}`;
    if (savedClientIdRef.current === clientId || state.savedKey === clientId) return;
    savedClientIdRef.current = clientId;
    dispatch({ type: "MARK_SAVED", key: clientId });

    enqueueDecision(userId, {
      clientId: crypto.randomUUID(),
      partner1Text: state.p1Text.trim(),
      partner2Text: state.p2Text.trim(),
      engine: m.engine.id,
      confidence: chosen.probability,
      reason: chosen.via,
      rank: chosen.rank,
      shortlistSize: chosen.total,
      radiusKm: state.radiusKm,
      source: m.source,
      winner: chosen.candidate,
      runnerUps: m.ranking.filter((r) => r.id !== chosen.candidate.id).slice(0, 5),
      tiebreakers: state.tiebreakers,
    }).catch(() => {
      /* the outbox write itself failing (e.g. IndexedDB unavailable) just
         means this one decision won't be in History - never block the UI */
    });
  }, [state, userId]);

  // Restore stored preferences post-mount only, so server and the first
  // client render match (see lib/safe-storage.ts) and there's no hydration
  // mismatch from a value baked into the initial render.
  useEffect(() => {
    // Once only. This effect consumes one-shot state (the Explore seed is
    // removed from sessionStorage below), so React StrictMode's dev-only
    // second run would see a different world - no seed - and restore the old
    // round over the fresh one the first run just set up.
    if (mountRestoreRanRef.current) return;
    mountRestoreRanRef.current = true;

    const storedEngine = local.get("fw_engine", "laya") as EngineId;
    if (storedEngine !== "laya") dispatch({ type: "SET_ENGINE", engine: storedEngine });
    if (isDevModeEnabled()) dispatch({ type: "SET_DEV_MODE", value: true });

    // Resuming where the couple left off (they went to another page, the
    // tab reloaded, or a backgrounded PWA was reopened) takes priority over
    // the plain names restore below: the snapshot carries the names, the
    // typed text AND however far the round had got - see the persistence
    // effect further down for the write side, and restoreFromSnapshot() in
    // lib/decide/machine.ts for what comes back and what falls back to input.
    const sessionRaw = session.get(SESSION_KEY, "");
    const seeding = Boolean(session.get(SEED_KEY, ""));
    let restoredSession = false;
    if (sessionRaw) {
      try {
        let snapshot = JSON.parse(sessionRaw) as SessionSnapshot;
        // A place just added from Explore starts a new round - it must not
        // land on top of a finished list from before.
        if (snapshot && seeding) snapshot = withoutRound(snapshot);
        if (snapshot && typeof snapshot.phase === "string") {
          dispatch({ type: "RESTORE_SESSION", snapshot, now: Date.now() });
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

  // Keep the round alive across leaving this page, a reload, or the PWA being
  // backgrounded and killed: every step is saved - the cards, the ranked list,
  // an open question, the reveal - and restored on the next visit (see
  // restoreFromSnapshot). Only a request in flight isn't (snapshotOf returns
  // null then and the previous snapshot stays).
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
    const snapshot = snapshotOf(state, Date.now());
    if (snapshot) session.set(SESSION_KEY, JSON.stringify(snapshot));
  }, [state]);

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
        // Dev Mode scores with every engine, and a cold one outlasts its
        // deadline on the first round - so with it on, load them all now.
        if (isDevModeEnabled()) {
          for (const e of list) if (e.available && e.id !== state.engine) warmEngine(e.id).catch(() => {});
        }
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
        search_center: state.searchCenter,
        tiebreakers: overrides?.tiebreakers ?? state.tiebreakers,
        round: overrides?.round ?? state.round,
        radius_km: state.radiusKm,
        cross_border: isCrossBorderEnabled(),
        // The phone's own clock - the server can't know what time it is where
        // they are - so it can guess the meal; mealChoice only when they set it.
        local_hour: new Date().getHours(),
        meal: state.mealChoice,
      };
      try {
        const res = await decide(body);
        // A real result is handed to the deciding animation, not dispatched
        // straight away - handleDecidingDone() below does the actual
        // dispatch once it's finished playing. An error skips all of that
        // and dispatches immediately, per the plan: nothing to animate
        // toward when there's nothing to show.
        if (res.status === "ranked") setPendingResult({ kind: "ranked", response: res });
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
    [state.engine, state.devMode, state.p1Text, state.p1Mode, state.p2Text, state.p2Mode, loc.location, state.candidates, state.source, state.tiebreakers, state.round, state.radiusKm, state.mealChoice],
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
    // Locating can take a moment; without this the button just sat there
    // looking untouched until the animation began.
    setFinding(true);
    try {
      const fresh = await loc.ensureLocation();
      if (fresh) {
        submit({ location: fresh });
      } else {
        toast("Couldn't get your location - check your browser's permission for this site and try again.");
      }
    } finally {
      setFinding(false);
    }
  };

  // Fires once the deciding animation has actually finished playing (see
  // DecidingSequence's onDone) - this is where a resolved response finally
  // becomes real reducer state.
  const handleDecidingDone = useCallback(() => {
    setPendingResult((current) => {
      if (!current) return current;
      if (current.kind === "ranked") dispatch({ type: "SUBMIT_RANKED", response: current.response });
      else dispatch({ type: "SUBMIT_TIEBREAKER", response: current.response });
      return null;
    });
  }, []);

  const resetGame = () => dispatch({ type: "RESET" });

  // What the results/wheel/reveal screens show: the primary engine's answer,
  // or in Dev Mode whichever engine's ranking was selected on the list.
  const view = viewedResponse(state);

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

        {/* Collapses instead of vanishing, so the content below eases up
            rather than jumping when Find Our Table is tapped. */}
        <AnimatePresence initial={false}>
          {state.phase === "input" && (
            <motion.div
              key="radius"
              className="mt-4 overflow-hidden"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.2 } }}
            >
              <RadiusSlider
                km={state.radiusKm}
                locked={state.engineLocked}
                onChange={(km) => dispatch({ type: "SET_RADIUS_KM", km })}
              />
            </motion.div>
          )}
        </AnimatePresence>
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

            <MealChip value={state.mealChoice} onChange={(meal) => dispatch({ type: "SET_MEAL", meal })} />

            {canSubmit(state) && (
              <>
                {/* A motion.button with its own quick exit: this whole block
                    stays mounted (frozen in place by popLayout) until the
                    cards have morphed into DecidingSequence's pills, so
                    without this the button sat on top of the new screen for
                    ~half a second. Only the button fades - fading the parent
                    would fade the morphing cards with it. */}
                <motion.button
                  type="button"
                  disabled={!isOnline || finding}
                  onClick={findTable}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  /* No CSS opacity transition/disabled:opacity here - either one
                     fights the inline opacity of the exit animation above and
                     made the button flicker back in mid-fade. */
                  className={cn(
                    "w-full rounded-xl bg-ember py-3 text-base font-medium text-ink",
                    !isOnline && "cursor-not-allowed opacity-35",
                    finding && "cursor-wait",
                  )}
                >
                  {finding ? "Finding…" : "Find Our Table"}
                </motion.button>
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

        {state.phase === "results" && state.lastRanked && view && (
          <div key="results">
            <ResultsList
              response={view}
              p1Name={state.p1Name}
              p2Name={state.p2Name}
              devMode={state.devMode}
              primary={{ id: state.lastRanked.engine.id, label: state.lastRanked.engine.label, ranking: state.lastRanked.ranking }}
              onViewEngine={(engine) => dispatch({ type: "VIEW_ENGINE", engine })}
              onPick={(id) => dispatch({ type: "PICK", id })}
              onSpin={() => {
                // Drawn ONCE, here, before the wheel mounts - the wheel only
                // animates to it, so the slice sizes it shows are the real odds.
                const slices = topWeights(activeRanking(state));
                dispatch({ type: "START_SPIN", winnerId: pickWeighted(slices) });
              }}
              onOpenQuestion={() => dispatch({ type: "OPEN_QUESTION" })}
            />
          </div>
        )}

        {state.phase === "wheel" && view && state.spinWinnerId && (
          <div key="wheel" className="py-8">
            <Wheel
              slices={topWeights(view.ranking)}
              winnerId={state.spinWinnerId}
              engineLabel={view.engine.label}
              onLanded={() => dispatch({ type: "WHEEL_LANDED" })}
            />
          </div>
        )}

        {state.phase === "mediator" && state.mediator && (
          <MediatorPanel
            key="mediator"
            question={state.mediator.question}
            kind={state.mediator.kind}
            round={state.mediator.round}
            engineLabel={state.mediator.engineLabel}
            contenders={state.mediator.kind === "close" ? state.lastRanked?.ranking.slice(0, 2) : undefined}
            onAnswer={(tb) => {
              const round = state.mediator!.round + 1;
              dispatch({ type: "ANSWER_MEDIATOR", tiebreaker: tb });
              submit({ tiebreakers: [...state.tiebreakers, tb], round });
            }}
            onSecondary={() => {
              if (state.mediator!.kind === "close") {
                dispatch({ type: "BACK_TO_RESULTS" });
              } else {
                // Skipping the location question: round 2 makes the server
                // default to the first partner's mention instead of asking again.
                dispatch({ type: "SPIN_ANYWAY" });
                submit({ round: 2 });
              }
            }}
          />
        )}

        {state.phase === "reveal" && state.chosen && view && (
          <RevealPanel
            key="reveal"
            choice={state.chosen}
            response={view}
            p1Name={state.p1Name}
            p2Name={state.p2Name}
            p1Text={state.p1Text}
            p2Text={state.p2Text}
            userLocation={loc.location}
            onBackToList={() => dispatch({ type: "BACK_TO_RESULTS" })}
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
