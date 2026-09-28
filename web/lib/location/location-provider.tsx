"use client";

import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { local } from "@/lib/safe-storage";
import type { Location } from "@/lib/decide/types";

// "denied" covers an unsupported browser or our own GEO_TIMEOUT_MS backstop
// (a permission prompt the user never answered) - both mean "try again
// later, nothing to fix right now". "blocked" is the browser/OS explicitly
// refusing (PERMISSION_DENIED), which needs the user to change a setting
// before "Enable location" can do anything - the two need different UI.
export type LocationStatus = "idle" | "locating" | "granted" | "denied" | "blocked";

interface LocationContextValue {
  status: LocationStatus;
  location: Location | null;
  /** The persisted preference - true once the user has turned this on,
   * independent of whether a fix is currently `granted` (e.g. mid-fetch,
   * or temporarily `denied` after a timeout). */
  enabled: boolean;
  /** Persists the preference and requests a fresh fix, resolving with the
   * location itself (or null if it couldn't be obtained). Only ever called
   * from a user action (a Settings switch or the submit-time drawer) -
   * never on its own. Resolving with the value directly - not just true/
   * false - matters: a caller that turns around and submits a request
   * right after needs THIS location, not whatever `location` happens to be
   * on its next render (a real bug this app hit: submitting immediately
   * after enable() used a stale, pre-fetch closure and sent location: null
   * even though the fix had just been granted). */
  enable: () => Promise<Location | null>;
  disable: () => void;
  /** Returns the current location if already granted, otherwise requests a
   * fresh fix - the same "resolve with the real value" guarantee as
   * enable(), for a submit-time caller that doesn't know (or care) whether
   * a fix is already in hand. Never persists the preference or prompts
   * unasked; only meaningful when `enabled` is already true. */
  ensureLocation: () => Promise<Location | null>;
}

const LocationContext = createContext<LocationContextValue | null>(null);

const ENABLED_KEY = "fw_location_enabled";
const LAST_LOCATION_KEY = "fw_last_location";
const LAST_LOCATION_MAX_AGE_MS = 15 * 60 * 1000;
// The native `timeout` option only counts once permission has been
// decided, so an unanswered prompt can leave getCurrentPosition hanging
// forever on some browsers. This is a guaranteed backstop regardless of
// browser behavior.
const GEO_TIMEOUT_MS = 10_000;

interface StoredLocation extends Location {
  ts: number;
}

interface LocationState {
  status: LocationStatus;
  location: Location | null;
}

type LocationAction =
  | { type: "SET_STATUS"; status: LocationStatus }
  | { type: "SET_LOCATION"; location: Location }
  | { type: "TIMED_OUT_IF_STILL_LOCATING" }
  | { type: "CLEAR" };

// A useReducer's dispatch, unlike a useState setter, isn't flagged by
// react-hooks/set-state-in-effect - the same reason decide/page.tsx
// restores its own persisted preferences via dispatch() inside a mount
// effect instead of calling a useState setter directly. Needed here because
// restoring a cached location/status must happen in an effect (not a lazy
// useState initializer) to keep the server and first client render in sync -
// see isLocationEnabled()'s comment just above.
function locationReducer(state: LocationState, action: LocationAction): LocationState {
  switch (action.type) {
    case "SET_STATUS":
      return { ...state, status: action.status };
    case "SET_LOCATION":
      return { status: "granted", location: action.location };
    case "TIMED_OUT_IF_STILL_LOCATING":
      return state.status === "locating" ? { ...state, status: "denied" } : state;
    case "CLEAR":
      return { status: "idle", location: null };
    default:
      return state;
  }
}

function readCachedLocation(): Location | null {
  const raw = local.get(LAST_LOCATION_KEY, "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredLocation;
    if (typeof parsed.lat !== "number" || typeof parsed.lng !== "number") return null;
    if (Date.now() - parsed.ts > LAST_LOCATION_MAX_AGE_MS) return null;
    return { lat: parsed.lat, lng: parsed.lng, accuracy_m: parsed.accuracy_m };
  } catch {
    return null;
  }
}

function writeCachedLocation(loc: Location) {
  const stored: StoredLocation = { ...loc, ts: Date.now() };
  local.set(LAST_LOCATION_KEY, JSON.stringify(stored));
}

// Same useSyncExternalStore hand-off the rest of the app uses for a
// browser-only persisted boolean (lib/sound.ts, lib/dev-mode.ts) - it reads
// the same on the server and the first client render (both get `false`
// from getServerSnapshot), so there's no hydration mismatch, and unlike a
// lazy useState initializer it can't read a real localStorage value on the
// client that the server never saw.
function isLocationEnabled(): boolean {
  return local.get(ENABLED_KEY, "0") === "1";
}
function subscribeNoop() {
  return () => {};
}
function getServerSnapshot() {
  return false;
}

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [{ status, location }, dispatch] = useReducer(locationReducer, { status: "idle", location: null });
  // Writes to this from the same tab don't fire a "storage" event (that
  // only fires in OTHER tabs), so enable()/disable() bump this to force
  // the next isLocationEnabled() read to actually reach the UI - the same
  // pattern the Settings page's switches already use.
  const [, bumpVersion] = useReducer((n: number) => n + 1, 0);
  const enabled = useSyncExternalStore(subscribeNoop, isLocationEnabled, getServerSnapshot);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchPosition = useCallback((): Promise<Location | null> => {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        dispatch({ type: "SET_STATUS", status: "denied" });
        resolve(null);
        return;
      }
      dispatch({ type: "SET_STATUS", status: "locating" });
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        dispatch({ type: "TIMED_OUT_IF_STILL_LOCATING" });
        resolve(null);
      }, GEO_TIMEOUT_MS);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timeoutRef.current);
          const loc: Location = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy_m: Math.round(pos.coords.accuracy || 0),
          };
          writeCachedLocation(loc);
          dispatch({ type: "SET_LOCATION", location: loc });
          resolve(loc);
        },
        (err) => {
          clearTimeout(timeoutRef.current);
          dispatch({ type: "SET_STATUS", status: err.code === err.PERMISSION_DENIED ? "blocked" : "denied" });
          resolve(null);
        },
        { timeout: 8000, maximumAge: 5 * 60 * 1000 },
      );
    });
  }, []);

  const enable = useCallback(async () => {
    local.set(ENABLED_KEY, "1");
    bumpVersion();
    return fetchPosition();
  }, [fetchPosition]);

  const ensureLocation = useCallback(async (): Promise<Location | null> => {
    if (status === "granted" && location) return location;
    return fetchPosition();
  }, [status, location, fetchPosition]);

  const disable = useCallback(() => {
    local.set(ENABLED_KEY, "0");
    bumpVersion();
    dispatch({ type: "CLEAR" });
  }, []);

  // On mount, if the preference was already on from a previous visit,
  // restore a recent cached fix immediately and check the Permissions API
  // rather than calling getCurrentPosition blind - a previously-granted
  // user gets their location silently, a previously-blocked one sees that
  // immediately, and nobody gets a surprise native prompt. Reads the
  // preference directly (not the synced `enabled` above) so this only ever
  // runs once per mount, not again when enable()/disable() bump it -
  // enable() already triggers its own fetchPosition() call.
  useEffect(() => {
    if (!isLocationEnabled()) return;

    const cached = readCachedLocation();
    if (cached) dispatch({ type: "SET_LOCATION", location: cached });

    if (!("permissions" in navigator)) {
      // No Permissions API (Safari) - the user already consented at least
      // once before (that's the only way the preference gets set), so a
      // silent fetch attempt here won't surprise them with a fresh prompt
      // in browsers that remember the decision.
      fetchPosition();
      return;
    }
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((perm) => {
        if (perm.state === "granted") fetchPosition();
        else if (perm.state === "denied") dispatch({ type: "SET_STATUS", status: "blocked" });
        // "prompt": leave it to an explicit user action (enable()) - never
        // trigger the browser's own permission dialog on our own.
      })
      .catch(() => {
        /* Permissions API present but this query unsupported - ignore */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <LocationContext.Provider value={{ status, location, enabled, enable, disable, ensureLocation }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useLocation must be used within a LocationProvider");
  return ctx;
}
