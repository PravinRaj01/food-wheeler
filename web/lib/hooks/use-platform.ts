"use client";

import { useSyncExternalStore } from "react";
import type { NavPlatform } from "@/lib/decide/nav-links";

// userAgent never changes mid-session, so there's nothing to subscribe to -
// but useSyncExternalStore is still the right primitive for a browser-only
// value the server can't know, handling the hydration hand-off for us. Same
// pattern (and the same iOS regex) as components/install-prompt.tsx.
function subscribeNoop() {
  return () => {};
}
function getSnapshot(): NavPlatform {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) && !("MSStream" in window)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "other";
}
function getServerSnapshot(): NavPlatform {
  return "other";
}

export function usePlatform(): NavPlatform {
  return useSyncExternalStore(subscribeNoop, getSnapshot, getServerSnapshot);
}
