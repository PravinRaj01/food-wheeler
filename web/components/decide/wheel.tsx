"use client";

import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import type { RankingRow } from "@/lib/decide/types";
import { playTick } from "@/lib/sound";

interface WheelProps {
  slices: { id: string; name: string; color: string }[];
  winnerId: string;
  fair: boolean;
  engineLabel?: string;
  onLanded: () => void;
}

// Phase 3 kinetic feel, replacing v1's plain easeOutCubic:
//   1. Launch burst + friction decay - a single strong easeOutQuint curve.
//      A real flicked wheel reaches peak speed almost instantly compared to
//      the multi-second glide that follows, so there's no perceptible
//      separate "ramp up from rest" phase to animate - easeOutQuint's own
//      steep opening IS the burst, and its long tail IS the friction decay.
//      (An earlier version tried to composite a literal ease-in ramp before
//      the glide; it multiplied by the glide curve's value-at-zero, which
//      is always 0, producing a dead stop for the first ~200ms. Deleted.)
//   2. Tick-back bounce - a decaying cosine wobble that overshoots the
//      target by a few degrees and springs back, landing exactly on it.
// The needle also deflects on each slice crossing (a little "flap" as the
// tab bumps past it) and the wheel does a brief impact shake on landing.
// Every exact-landing guarantee from v1 is unchanged: the target rotation
// is solved up front, and every easing stage returns exactly 1.0 at t=1.

function easeOutQuint(t: number) {
  return 1 - Math.pow(1 - t, 5);
}

const OVERSHOOT_RAD = 0.045; // ~2.6 degrees - a "micro-bounce", not a big swing
const TAIL_START = 0.9; // fraction of duration where the tick-back wobble begins

/** Progress (0..1) of the total rotation for the glide portion only
 * (t < TAIL_START) - the tail's tick-back wobble is computed separately in
 * rotationAt() below, in raw radians rather than progress units, since its
 * overshoot angle is a fixed ~2.6° regardless of how many turns the wheel
 * takes, not a fraction of the total rotation. */
function wheelProgress(t: number): number {
  return easeOutQuint(Math.min(t / TAIL_START, 1));
}

function drawWheel(
  ctx: CanvasRenderingContext2D,
  slices: WheelProps["slices"],
  rotation: number,
  needleDeflectRad: number,
  shakeX: number,
) {
  const size = 600;
  const cx = size / 2 + shakeX;
  const cy = size / 2;
  const r = size / 2 - 8;
  ctx.clearRect(0, 0, size, size);
  const n = slices.length;
  const sliceAngle = (2 * Math.PI) / n;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  slices.forEach((s, i) => {
    const start = i * sliceAngle;
    const end = start + sliceAngle;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, start, end);
    ctx.closePath();
    ctx.fillStyle = s.color || "#c9a15a";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.rotate(start + sliceAngle / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,244,230,0.95)";
    ctx.font = "500 20px Inter, sans-serif";
    const label = s.name.length > 16 ? s.name.slice(0, 15) + "…" : s.name;
    ctx.fillText(label, r - 20, 7);
    ctx.restore();
  });
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, 40, 0, Math.PI * 2);
  ctx.fillStyle = "#431407";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,244,230,0.2)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // The needle "flaps" as each slice tab bumps past it - deflectRad decays
  // to 0 between ticks (driven by the caller each frame).
  ctx.save();
  ctx.translate(cx, 8);
  ctx.rotate(needleDeflectRad);
  ctx.beginPath();
  ctx.moveTo(0, 22);
  ctx.lineTo(-9, 4);
  ctx.lineTo(9, 4);
  ctx.closePath();
  ctx.fillStyle = "#fb923c";
  ctx.fill();
  ctx.restore();
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Pure landing math, pulled out of the animation effect so it's unit
 * testable: given which slice must win, how many slices there are, and a
 * source of randomness for the in-slice jitter, returns the wheel's final
 * rotation (in radians, before the extra spins are added back by the caller
 * if it wants them - `extraTurns` is included here for convenience).
 *
 * `random` defaults to Math.random but takes a seed function so a test can
 * assert the full [0, 1) jitter range lands inside the slice, not just one
 * sample.
 */
export function computeLandingRotation(
  winnerIndex: number,
  sliceCount: number,
  random: () => number = Math.random,
  extraTurns = 5,
): number {
  const sliceAngle = (2 * Math.PI) / sliceCount;
  const jitter = (random() - 0.5) * sliceAngle * 0.5;
  const winnerCenter = winnerIndex * sliceAngle + sliceAngle / 2 + jitter;
  const targetRotation = -Math.PI / 2 - winnerCenter;
  return extraTurns * 2 * Math.PI + targetRotation;
}

/**
 * Which slice index the fixed top needle points at for a given wheel
 * rotation - the inverse of computeLandingRotation's geometry. Used by the
 * property test to confirm every jitter sample lands back on the intended
 * winner, and available to the component itself if it ever needs to read
 * the current slice back out of a rotation value.
 */
export function sliceUnderNeedle(rotation: number, sliceCount: number): number {
  const sliceAngle = (2 * Math.PI) / sliceCount;
  const TWO_PI = 2 * Math.PI;
  const local = (((-Math.PI / 2 - rotation) % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.floor(local / sliceAngle) % sliceCount;
}

export function Wheel({ slices, winnerId, fair, engineLabel, onLanded }: WheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // `fair` doesn't change during one spin's lifetime, so this is a plain
  // computed value, not state.
  const status = fair ? "Too close to call…" : "Spinning…";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const n = slices.length;
    const sliceAngle = (2 * Math.PI) / n;
    const winnerIndex = Math.max(0, slices.findIndex((s) => s.id === winnerId));
    const finalRotation = computeLandingRotation(winnerIndex, n);
    // Convert the wobble's "progress units" overshoot into actual radians
    // scaled to this spin's total rotation, then back out again inside
    // wheelProgress via finalRotation multiplication below - simplest to
    // just add the wobble in raw radians after scaling by finalRotation,
    // so define a wrapper that does exactly that.
    function rotationAt(t: number): number {
      if (t < TAIL_START) return finalRotation * wheelProgress(t);
      const tailT = (t - TAIL_START) / (1 - TAIL_START);
      const decay = Math.pow(1 - tailT, 2);
      const wobble = decay * Math.cos(tailT * Math.PI * 1.5) * OVERSHOOT_RAD;
      return finalRotation + wobble;
    }

    const reduced = prefersReducedMotion();
    const duration = reduced ? 600 : 2600;
    const start = performance.now();
    let lastTick = -1;
    let lastTickAt = 0;
    let needleDeflect = 0;
    let raf = 0;
    let cancelled = false;
    let shakeUntil = 0;

    function frame(now: number) {
      if (cancelled) return;
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      const rotation = reduced ? finalRotation * (1 - Math.pow(1 - t, 3)) : rotationAt(t);

      const tickIndex = Math.floor(((rotation % (2 * Math.PI)) + 2 * Math.PI) / sliceAngle);
      if (tickIndex !== lastTick) {
        try {
          navigator.vibrate?.(6);
        } catch {
          /* not supported */
        }
        if (!reduced) playTick();
        needleDeflect = 0.22; // radians, decays below
        lastTick = tickIndex;
        lastTickAt = now;
      }
      // Needle spring-back: exponential decay since the last tick.
      const sinceTick = now - lastTickAt;
      const deflectNow = needleDeflect * Math.exp(-sinceTick / 60);

      // Impact shake, only in the brief window right after landing.
      let shakeX = 0;
      if (t >= 1) {
        if (!shakeUntil) shakeUntil = now + 250;
        const shakeElapsed = now - (shakeUntil - 250);
        if (shakeElapsed < 250 && !reduced) {
          const decay = 1 - shakeElapsed / 250;
          shakeX = Math.sin(shakeElapsed / 18) * 6 * decay;
        }
      }

      drawWheel(ctx!, slices, rotation, deflectNow, shakeX);

      if (t < 1 || (shakeUntil && now < shakeUntil)) {
        raf = requestAnimationFrame(frame);
      } else {
        if (!reduced) {
          confetti({ particleCount: 120, spread: 75, origin: { y: 0.5 }, colors: ["#c9a15a", "#fff4e6", "#6f8f8a"] });
        }
        setTimeout(onLanded, 350);
      }
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // Intentionally run once per mount - slices/winnerId are fixed for the
    // life of one spin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <p role="status" aria-live="polite" className="text-sm tracking-wide text-cream/70">
        {status}
      </p>
      <p className="mb-6 min-h-[1rem] text-[11px] text-cream/40">
        {fair ? "Letting chance decide" : engineLabel ? `via ${engineLabel}` : ""}
      </p>
      <div className="relative mx-auto" style={{ width: "min(80vw, 340px)" }}>
        <canvas ref={canvasRef} width={600} height={600} className="h-auto w-full" style={{ touchAction: "none" }} />
      </div>
    </div>
  );
}

export function slicesFromRanking(ranking: RankingRow[], wheelIds?: string[]) {
  const pool = wheelIds?.length ? ranking.filter((r) => wheelIds.includes(r.id)) : ranking;
  return pool.map((r) => ({ id: r.id, name: r.name, color: r.color }));
}
