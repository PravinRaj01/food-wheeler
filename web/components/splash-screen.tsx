"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";

const MIN_MS = 900;
const MAX_MS = 2500;

/**
 * Shown once on app launch (mounted from the root layout), not on every
 * navigation. Stays up until MIN_MS has passed AND the API has warmed up
 * (or MAX_MS elapses, whichever first) - this doubles as cover for a Cloud
 * Run cold start. Reduced-motion just uses MIN_MS with no fade.
 */
export function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    const minWait = new Promise((res) => setTimeout(res, MIN_MS));
    const warmup = apiUrl
      ? fetch(`${apiUrl}/api/health`).catch(() => {})
      : Promise.resolve();
    const maxWait = new Promise((res) => setTimeout(res, MAX_MS));

    Promise.race([Promise.all([minWait, warmup]), maxWait]).then(() => {
      setFading(true);
      setTimeout(() => setVisible(false), 400);
    });
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-100 flex flex-col items-center justify-center gap-5 bg-[var(--orange-3)] transition-opacity duration-400"
      style={{ opacity: fading ? 0 : 1 }}
      aria-hidden
    >
      <Logo className="h-16 w-16" />
      <h1 className="font-display text-2xl font-semibold tracking-tight text-cream">Food Wheeler</h1>
      <div className="h-px w-20 overflow-hidden bg-line">
        <div className="h-full w-full origin-left animate-[splash-bar_1.1s_ease-in-out_infinite] bg-ember" />
      </div>
      <style>{`
        @keyframes splash-bar {
          0% { transform: scaleX(0); }
          50% { transform: scaleX(1); }
          100% { transform: scaleX(0); }
        }
      `}</style>
    </div>
  );
}
