"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  const id = setInterval(callback, 1000);
  return () => clearInterval(id);
}

function getSnapshot() {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Server has no meaningful "now" to render that would match the client's
// clock, so it renders nothing until the client takes over post-hydration -
// useSyncExternalStore handles that hand-off without a manual effect+setState.
function getServerSnapshot() {
  return null;
}

export function LiveClock({ city = "Kuala Lumpur" }: { city?: string }) {
  const time = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const offset = -(new Date().getTimezoneOffset() / 60);
  const gmt = `GMT${offset >= 0 ? "+" : ""}${offset}`;

  if (!time) return <span className="tabular-nums opacity-0">00:00:00 {gmt}</span>;

  return (
    <span className="tabular-nums">
      {city} · {time} {gmt}
    </span>
  );
}
