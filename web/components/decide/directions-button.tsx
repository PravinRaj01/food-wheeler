"use client";

import { useState } from "react";
import { Navigation } from "lucide-react";
import { DirectionsSheet } from "@/components/decide/directions-sheet";

/** Opens the "Open in…" app-chooser drawer instead of hardcoding one
 * directions provider - replaces the raw OpenStreetMap-only <a> that used
 * to sit at both call sites (reveal-panel.tsx and the history detail page,
 * where its "from" coordinate used to accidentally equal "to" - moot now
 * that every link here is destination-only). */
export function DirectionsButton({
  lat,
  lng,
  name,
  className,
}: {
  lat: number;
  lng: number;
  name: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "flex items-center justify-center gap-1.5 rounded-xl border border-line py-3 text-sm font-medium text-cream transition-colors hover:bg-glass"
        }
      >
        <Navigation className="h-4 w-4" /> Directions
      </button>
      <DirectionsSheet open={open} onOpenChange={setOpen} lat={lat} lng={lng} name={name} />
    </>
  );
}
