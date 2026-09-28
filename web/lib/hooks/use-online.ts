"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
function getSnapshot() {
  return navigator.onLine;
}
// Assume online during SSR and the first client render - avoids a flash of
// an "offline" banner on every single page load before the browser's real
// connectivity state is known.
function getServerSnapshot() {
  return true;
}

/** The browser's own connectivity guess (not a real reachability check) -
 * good enough to disable "Find Our Table" and show a banner, not something
 * to build a hard guarantee on. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
