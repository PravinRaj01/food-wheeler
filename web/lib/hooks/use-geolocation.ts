"use client";

import { useCallback, useState } from "react";
import type { Location } from "@/lib/decide/types";

export type GeoStatus = "idle" | "locating" | "granted" | "denied";

/** Never fires automatically - only ever called from a tap, per the soft
 * pre-prompt pattern in the plan. Denied/unavailable both resolve to
 * "denied" so the caller falls back to demo mode either way. */
export function useGeolocation() {
  const [location, setLocation] = useState<Location | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");

  const request = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("denied");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: Math.round(pos.coords.accuracy || 0),
        });
        setStatus("granted");
      },
      () => setStatus("denied"),
      { timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  return { location, status, request };
}
