"use client";

import dynamic from "next/dynamic";
import type { Candidate } from "@/lib/decide/types";

const RevealMap = dynamic(() => import("@/components/decide/reveal-map").then((m) => m.RevealMap), {
  ssr: false,
  loading: () => <div className="h-56 w-full animate-pulse rounded-xl bg-glass" />,
});

export function HistoryMap({ winner, matchPercent }: { winner: Candidate; matchPercent: number }) {
  return <RevealMap winner={winner} userLocation={null} matchPercent={matchPercent} />;
}
