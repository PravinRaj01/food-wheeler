"use client";

import dynamic from "next/dynamic";
import { motion } from "motion/react";
import { Navigation, RotateCcw } from "lucide-react";
import type { Location, MatchResponse } from "@/lib/decide/types";
import { formatDistance } from "@/lib/decide/distance";
import { DevComparison } from "@/components/decide/dev-comparison";
import { REVEAL_KICKER } from "@/lib/copy";

const RevealMap = dynamic(() => import("@/components/decide/reveal-map").then((m) => m.RevealMap), {
  ssr: false,
  loading: () => <div className="h-56 w-full animate-pulse rounded-xl bg-glass md:h-64" />,
});

export function RevealPanel({
  response,
  p1Name,
  p2Name,
  p1Text,
  p2Text,
  userLocation,
  devMode,
  onStartOver,
}: {
  response: MatchResponse;
  p1Name: string;
  p2Name: string;
  p1Text: string;
  p2Text: string;
  userLocation: Location | null;
  devMode: boolean;
  onStartOver: () => void;
}) {
  const w = response.winner;
  const pct = Math.round(response.confidence * 100);
  const badgeSuffix = response.engine.fallback_from ? " (fallback)" : "";

  const p1Hit = w.tags.find((t) => p1Text.toLowerCase().includes(t.replace("_", " ")));
  const p2Hit = w.tags.find((t) => p2Text.toLowerCase().includes(t.replace("_", " ")));
  const runners = response.ranking.filter((r) => r.id !== w.id).slice(0, 2);

  const originLat = userLocation?.lat ?? w.lat;
  const originLng = userLocation?.lng ?? w.lng;
  const directionsHref = `https://www.openstreetmap.org/directions?from=${originLat}%2C${originLng}&to=${w.lat}%2C${w.lng}`;

  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", bounce: 0.3, duration: 0.6 }}
      className="glass rounded-2xl p-6"
    >
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[11px] tracking-[0.15em] text-cream/40 uppercase">{REVEAL_KICKER}</p>
      </div>
      <div className="mb-1 flex items-start justify-between gap-3">
        <h2 className="font-display text-2xl leading-tight text-cream">{w.name}</h2>
        <span className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--ember)_18%,transparent)] px-2.5 py-1 text-[11px] font-medium whitespace-nowrap text-ember">
          {pct}% match · {response.engine.label}
          {badgeSuffix}
        </span>
      </div>
      <p className="mb-3 text-sm text-cream/60">
        {w.cuisine} · {w.price} · {formatDistance(w)}
      </p>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {w.tags.map((t) => (
          <span key={t} className="rounded-full bg-glass px-2.5 py-1 text-[11px] text-cream/70">
            {t.replace("_", " ")}
          </span>
        ))}
      </div>
      {(p1Hit || p2Hit) && (
        <div className="mb-4 text-xs text-cream/40">
          {[p1Hit && `${p1Name || "Partner One"} got: ${p1Hit}`, p2Hit && `${p2Name || "Partner Two"} got: ${p2Hit}`]
            .filter(Boolean)
            .join("   ·   ")}
        </div>
      )}

      {devMode && response.comparison && <DevComparison comparison={response.comparison} />}

      <div className="mb-4">
        <RevealMap winner={w} userLocation={userLocation} matchPercent={pct} />
      </div>

      {runners.length > 0 && (
        <p className="mb-5 text-xs text-cream/40">
          Also considered: {runners.map((r) => `${r.name} (${Math.round(r.probability * 100)}%)`).join(", ")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <a
          href={directionsHref}
          target="_blank"
          rel="noopener"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-line py-3 text-sm font-medium text-cream transition-colors hover:bg-glass"
        >
          <Navigation className="h-4 w-4" /> Directions
        </a>
        <button
          type="button"
          onClick={onStartOver}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-ember py-3 text-sm font-medium text-ink transition-opacity hover:opacity-90"
        >
          <RotateCcw className="h-4 w-4" /> Start Over
        </button>
      </div>
    </motion.div>
  );
}
