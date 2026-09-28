"use client";

import { useCallback, useRef, useState } from "react";
import type { Location } from "@/lib/decide/types";

export type GeoStatus = "idle" | "locating" | "granted" | "denied";

// The native `timeout` option is only reliable once permission has actually
// been decided - on several browsers, a *pending* permission prompt (the
// user hasn't tapped Allow/Block yet, or the OS-level location service is
// off so no prompt appears at all) doesn't count against it, so
// getCurrentPosition can sit forever without calling either callback. This
// timer is a guaranteed backstop: however the browser behaves, "locating"
// never lasts longer than GEO_TIMEOUT_MS.
const GEO_TIMEOUT_MS = 10_000;

/** Never fires automatically - only ever called from a tap, per the soft
 * pre-prompt pattern in the plan. Denied/unavailable/timed-out all resolve
 * to "denied" so the caller falls back to demo mode either way. */
export function useGeolocation() {
  const [location, setLocation] = useState<Location | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const request = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("denied");
      return;
    }
    setStatus("locating");
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setStatus((s) => (s === "locating" ? "denied" : s)), GEO_TIMEOUT_MS);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timeoutRef.current);
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: Math.round(pos.coords.accuracy || 0),
        });
        setStatus("granted");
      },
      () => {
        clearTimeout(timeoutRef.current);
        setStatus("denied");
      },
      { timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  return { location, status, request };
}
