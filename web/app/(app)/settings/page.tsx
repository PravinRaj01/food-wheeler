"use client";

import { useEffect, useReducer, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import * as Switch from "@radix-ui/react-switch";
import { isSoundEnabled, setSoundEnabled } from "@/lib/sound";
import { getCurrentUserId } from "@/lib/actions/user";
import { signOutAction } from "@/app/auth/actions";

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
  const [userId, setUserId] = useState<string | null | "loading">("loading");

  useEffect(() => {
    getCurrentUserId()
      .then(setUserId)
      .catch(() => setUserId(null));
  }, []);

  return (
    <div className="mx-auto max-w-lg px-5 py-10">
      <p className="text-[11px] uppercase tracking-[0.2em] text-cream/50">Preferences</p>
      <h1 className="font-display mt-2 text-3xl font-semibold text-cream">Settings</h1>

      <div className="glass mt-8 flex items-center justify-between rounded-2xl p-5">
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
