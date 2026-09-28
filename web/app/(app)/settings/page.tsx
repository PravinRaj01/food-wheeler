"use client";

import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import * as Switch from "@radix-ui/react-switch";
import { isSoundEnabled, setSoundEnabled } from "@/lib/sound";
import { isDevModeEnabled, setDevModeEnabled } from "@/lib/dev-mode";
import { useLocation } from "@/lib/location/location-provider";
import { saveNames } from "@/components/decide/names-step";
import { local } from "@/lib/safe-storage";
import { getCurrentUserId } from "@/lib/actions/user";
import { signOutAction } from "@/app/auth/actions";
import { listEngines, warmEngine } from "@/lib/api";
import { EngineToggle } from "@/components/decide/engine-toggle";
import type { EngineId, EngineListItem } from "@/lib/decide/types";
import { getThemePreference, setThemePreference, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

interface Names {
  p1: string;
  p2: string;
}

function readStoredNames(): Names {
  const raw = local.get("fw_names", "");
  if (!raw) return { p1: "", p2: "" };
  try {
    const parsed = JSON.parse(raw) as Partial<Names>;
    return { p1: parsed.p1 || "", p2: parsed.p2 || "" };
  } catch {
    return { p1: "", p2: "" };
  }
}

// localStorage isn't readable during SSR, and the two renders must agree to
// avoid a hydration mismatch - same useSyncExternalStore hand-off used for
// the other browser-only reads in this app (see use-speech-recognition.ts,
// install-prompt.tsx). Unlike those, this value is also *written* from the
// same tab: localStorage's own "storage" event only fires in *other* tabs,
// so subscribe has nothing real to listen for here - a manual re-render
// (bumpVersion) after each write is what makes getSnapshot's next read
// actually reach the UI.
function subscribeNoop() {
  return () => {};
}
function getServerSnapshot() {
  return false;
}

export default function SettingsPage() {
  const [, bumpVersion] = useReducer((n: number) => n + 1, 0);
  const sound = useSyncExternalStore(subscribeNoop, isSoundEnabled, getServerSnapshot);
  const devMode = useSyncExternalStore(subscribeNoop, isDevModeEnabled, getServerSnapshot);
  const loc = useLocation();
  const [userId, setUserId] = useState<string | null | "loading">("loading");
  // A local reducer, not useState + a plain setState-in-effect restore
  // (same reason lib/location/location-provider.tsx uses one): dispatch()
  // isn't flagged by react-hooks/set-state-in-effect the way a useState
  // setter is, and restoring a real localStorage value must happen in an
  // effect - not a lazy initializer - to keep this SSR page's first client
  // render matching what the server sent.
  const [names, namesDispatch] = useReducer((_state: Names, next: Names) => next, { p1: "", p2: "" });
  const [namesSaved, setNamesSaved] = useState(false);
  const [engines, setEngines] = useState<EngineListItem[]>([]);
  // A useReducer, not useState + a plain setState-in-effect restore - same
  // reason `names` above uses one: dispatch() isn't flagged by
  // react-hooks/set-state-in-effect the way a useState setter is, and
  // restoring the real fw_engine value must happen in an effect (not a lazy
  // initializer) to keep this SSR page's first client render matching what
  // the server sent.
  const [engine, setEngineState] = useReducer((_state: EngineId, next: EngineId) => next, "laya" as EngineId);
  // Same reducer-not-useState reasoning as `engine`/`names` above.
  const [theme, setTheme] = useReducer(
    (_state: ThemePreference, next: ThemePreference) => next,
    "system" as ThemePreference,
  );

  useEffect(() => {
    getCurrentUserId()
      .then(setUserId)
      .catch(() => setUserId(null));
  }, []);

  useEffect(() => {
    namesDispatch(readStoredNames());
  }, []);

  useEffect(() => {
    setTheme(getThemePreference());
  }, []);

  function selectTheme(pref: ThemePreference) {
    setTheme(pref);
    setThemePreference(pref);
  }

  // The engine picker used to live at the top of Decide - moved here per
  // the classiness pass so Decide's header isn't cluttered with a choice
  // most couples never touch mid-round. Decide still reads this same
  // fw_engine key on mount (see its own restore effect) and still warms
  // whatever's selected before a round starts.
  useEffect(() => {
    setEngineState(local.get("fw_engine", "laya") as EngineId);
    listEngines()
      .then(setEngines)
      .catch(() => setEngines([{ id: "laya", label: "Laya", available: true, loaded: false, default: true }]));
  }, []);

  function selectEngine(id: EngineId) {
    const entry = engines.find((e) => e.id === id);
    if (!entry?.available) return;
    setEngineState(id);
    local.set("fw_engine", id);
    if (!entry.loaded) warmEngine(id).catch(() => {});
  }

  function handleSaveNames() {
    saveNames(names.p1, names.p2);
    setNamesSaved(true);
    setTimeout(() => setNamesSaved(false), 2000);
  }

  return (
    <div className="mx-auto max-w-lg px-5 py-10">
      <p className="text-[11px] uppercase tracking-[0.2em] text-cream/50">Preferences</p>
      <h1 className="font-display mt-2 text-3xl font-semibold text-cream">Settings</h1>

      <div className="glass mt-8 rounded-2xl p-5">
        <p className="text-sm font-medium text-cream">Appearance</p>
        <p className="mt-0.5 mb-3 text-xs text-cream/50">Light, dark, or match your device.</p>
        <div className="flex gap-1 rounded-lg bg-glass-strong p-1">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => selectTheme(opt.id)}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
                theme === opt.id ? "bg-ember text-ink" : "text-cream/60",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="glass mt-4 flex items-center justify-between rounded-2xl p-5">
        <div>
          <p className="text-sm font-medium text-cream">Location</p>
          <p className="mt-0.5 text-xs text-cream/50">
            {loc.status === "granted"
              ? "On — using your position for real nearby places."
              : loc.status === "blocked"
                ? "Blocked in your browser — allow location for this site to use it."
                : loc.status === "locating"
                  ? "Finding your position…"
                  : "Off — turn on to find real places nearby."}
          </p>
        </div>
        <Switch.Root
          checked={loc.enabled}
          onCheckedChange={(checked) => {
            if (checked) loc.enable();
            else loc.disable();
          }}
          className="relative h-6 w-11 shrink-0 rounded-full bg-glass-strong data-[state=checked]:bg-ember"
        >
          <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-cream transition-transform data-[state=checked]:translate-x-5" />
        </Switch.Root>
      </div>

      <div className="glass mt-4 rounded-2xl p-5">
        <p className="text-sm font-medium text-cream">Names</p>
        <p className="mt-0.5 mb-3 text-xs text-cream/50">
          So your third wheel can talk to you both by name instead of &quot;Partner One&quot; and &quot;Partner Two&quot;.
        </p>
        <div className="space-y-2">
          <input
            type="text"
            value={names.p1}
            onChange={(e) => namesDispatch({ ...names, p1: e.target.value })}
            placeholder="Partner One's name"
            maxLength={30}
            className="w-full rounded-xl border border-line bg-glass px-4 py-2.5 text-sm text-cream placeholder-cream/30 outline-none focus:border-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
          />
          <input
            type="text"
            value={names.p2}
            onChange={(e) => namesDispatch({ ...names, p2: e.target.value })}
            placeholder="Partner Two's name"
            maxLength={30}
            className="w-full rounded-xl border border-line bg-glass px-4 py-2.5 text-sm text-cream placeholder-cream/30 outline-none focus:border-ember focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember"
          />
        </div>
        <button
          type="button"
          onClick={handleSaveNames}
          className="mt-3 rounded-full bg-ember px-4 py-2 text-xs font-medium text-ink transition-opacity hover:opacity-90"
        >
          {namesSaved ? "Saved!" : "Save"}
        </button>
      </div>

      <div className="glass mt-4 flex items-center justify-between rounded-2xl p-5">
        <div>
          <p className="text-sm font-medium text-cream">Wheel sound</p>
          <p className="mt-0.5 text-xs text-cream/50">A soft tick as the wheel passes each slice.</p>
        </div>
        <Switch.Root
          checked={sound}
          onCheckedChange={(checked) => {
            setSoundEnabled(checked);
            bumpVersion();
          }}
          className="relative h-6 w-11 rounded-full bg-glass-strong data-[state=checked]:bg-ember"
        >
          <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-cream transition-transform data-[state=checked]:translate-x-5" />
        </Switch.Root>
      </div>

      <div className="glass mt-4 rounded-2xl p-5">
        <p className="text-sm font-medium text-cream">Under the hood</p>
        <p className="mt-0.5 mb-3 text-xs text-cream/50">Which brain your third wheel thinks with, and whether it shows its work.</p>

        <EngineToggle engines={engines} selected={engine} locked={false} onSelect={selectEngine} />

        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <div>
            <p className="text-sm font-medium text-cream">Developer mode</p>
            <p className="mt-0.5 text-xs text-cream/50">Scores every decision with all available engines and shows a side-by-side comparison.</p>
          </div>
          <Switch.Root
            checked={devMode}
            onCheckedChange={(checked) => {
              setDevModeEnabled(checked);
              bumpVersion();
            }}
            className="relative h-6 w-11 shrink-0 rounded-full bg-glass-strong data-[state=checked]:bg-ember"
          >
            <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-cream transition-transform data-[state=checked]:translate-x-5" />
          </Switch.Root>
        </div>
      </div>

      <div className="glass mt-4 rounded-2xl p-5">
        <p className="mb-3 text-sm font-medium text-cream">Account</p>
        {userId === "loading" && <p className="text-xs text-cream/40">Checking…</p>}
        {userId === null && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-cream/50">Sign in to sync your decision history across devices.</p>
            <Link href="/login" className="shrink-0 rounded-full bg-ember px-4 py-2 text-xs font-medium text-ink">
              Log in
            </Link>
          </div>
        )}
        {typeof userId === "string" && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-cream/50">You&apos;re signed in and syncing.</p>
            <button
              onClick={() => signOutAction()}
              className="shrink-0 rounded-full border border-line px-4 py-2 text-xs font-medium text-cream"
            >
              Log out
            </button>
          </div>
        )}
      </div>

      <p className="mt-6 text-sm text-cream/60">Default engine, default radius and voice language land in a later pass.</p>
    </div>
  );
}
