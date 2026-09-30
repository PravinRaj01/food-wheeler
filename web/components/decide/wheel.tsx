"use client";

import { useEffect, useRef } from "react";
import type { WeightedSlice } from "@/lib/decide/weighted";
import { playTick } from "@/lib/sound";

interface WheelProps {
  /** Sized by `weight` (a share of the wheel, summing to 1) - a better
   * match gets a bigger slice. */
  slices: WeightedSlice[];
  /** Drawn by the caller BEFORE the spin (see weighted.pickWeighted), so the
   * slice sizes shown ARE the odds - the wheel only animates to it. */
  winnerId: string;
  engineLabel?: string;
  onLanded: () => void;
}

const TWO_PI = 2 * Math.PI;

/** Each slice's [start, end) angle, laid out end to end by weight - the one
 * place that turns shares into geometry, shared by drawing, landing and
 * hit-testing so they can never disagree about where a slice is. */
export function sliceSpans(weights: number[]): { start: number; end: number }[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return weights.map((w) => {
    const start = acc;
    acc += (w / total) * TWO_PI;
    return { start, end: acc };
  });
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

// A restrained 3-tone palette from the logo (skin / terracotta / deep),
// alternated by slice index - replacing the old 6-colour jewel-tone set
// (candidates.SLICE_COLORS) which read as busy rather than classy. Each
// candidate's own `color` still drives every OTHER place that shows it
// (contender bars, Dev Mode comparison) - only the wheel itself is this
// restrained.
const PALETTE = ["#FCE7D1", "#9A3412", "#431407"];
const GOLD = "#C9A15A";

function sliceColor(i: number): string {
  return PALETTE[i % PALETTE.length];
}

function relativeLuminance(hex: string): number {
  const n = hex.replace("#", "");
  const r = parseInt(n.substring(0, 2), 16) / 255;
  const g = parseInt(n.substring(2, 4), 16) / 255;
  const b = parseInt(n.substring(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Label ink follows the slice's own luminance rather than a fixed color -
 * the skin-tone slices need dark text, the terracotta/deep ones need pale
 * text, and a fixed color would be wrong for half the wheel either way. */
function labelColorFor(bg: string): string {
  return relativeLuminance(bg) > 0.5 ? "#431407" : "#FCF4E2";
}

/** Reads the actual loaded display font's family list off the document
 * (the --font-display custom property Next's font loader sets on <html> -
 * see app/layout.tsx) instead of hardcoding a name, so the wheel's labels
 * render in whatever serif is actually configured there (Fraunces) without
 * this file needing to know or guess its generated font-family string. */
function displayFontFamily(): string {
  if (typeof document === "undefined") return "serif";
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim();
  return value || "serif";
}

/** Shortens `text` to fit `maxWidth` using the canvas's OWN measured text
 * width (binary search over character count) rather than a fixed character
 * limit - a wide serif at a large size fits fewer characters than a narrow
 * one, and a fixed count either clips too early or overflows the slice. */
function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${text.slice(0, mid)}…`;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "…" : `${text.slice(0, lo)}…`;
}

interface ShimmerParticle {
  angle: number;
  dist: number;
  size: number;
  delay: number;
  drift: number;
}

/** ~30 tiny gold particles, positioned once when the wheel lands - drawn on
 * this same canvas (no canvas-confetti dependency) and faded in/out over
 * WIN_GLOW_MS via a per-particle sine envelope staggered by `delay`. */
function makeShimmerParticles(r: number, seed: () => number = Math.random): ShimmerParticle[] {
  return Array.from({ length: 30 }, () => ({
    angle: seed() * Math.PI * 2,
    dist: r * (0.35 + seed() * 0.85),
    size: 1 + seed() * 2.5,
    delay: seed() * 0.5,
    drift: 10 + seed() * 18,
  }));
}

const WIN_GLOW_MS = 900;

function drawWheel(
  ctx: CanvasRenderingContext2D,
  slices: WheelProps["slices"],
  rotation: number,
  needleDeflectRad: number,
  shakeX: number,
  fontFamily: string,
  logoImg: HTMLImageElement | null,
  winMoment: { winnerIndex: number; progress: number; particles: ShimmerParticle[] } | null,
) {
  const size = 600;
  const cx = size / 2 + shakeX;
  const cy = size / 2;
  const r = size / 2 - 8;
  ctx.clearRect(0, 0, size, size);
  const spans = sliceSpans(slices.map((s) => s.weight));

  // Soft drop shadow under the whole wheel, cast by one plain disc drawn
  // before the slices (a shadow per slice would be both slower and, with
  // overlapping wedge shapes, visually muddier).
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#2a0d04";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  slices.forEach((s, i) => {
    const { start, end } = spans[i];
    const fill = sliceColor(i);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, start, end);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.save();
    ctx.rotate((start + end) / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = labelColorFor(fill);
    ctx.font = `600 20px ${fontFamily}`;
    const label = truncateToWidth(ctx, s.name, r - 68);
    ctx.fillText(label, r - 20, 7);
    ctx.restore();
  });

  // Fine gold tick marks at every slice boundary, rotating with the wheel -
  // part of the bezel, not the slices, but easiest to draw in this same
  // rotated frame since the boundaries are already at each span's start here.
  for (const { start } of spans) {
    ctx.save();
    ctx.rotate(start);
    ctx.beginPath();
    ctx.moveTo(r - 7, 0);
    ctx.lineTo(r + 7, 0);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // The win moment's slice glow - drawn in WORLD space (not the rotated
  // frame above, which we've already exited) since by the time this ever
  // has a non-null winMoment, the wheel has settled and the winning
  // slice's world-space angular span is just its own span offset
  // plus the settled rotation - no need to track screen position any other
  // way. The needle always lands pointing at the winner by construction
  // (see computeLandingRotation), so this never has to search for it.
  if (winMoment) {
    const { winnerIndex, progress, particles } = winMoment;
    const worldStart = rotation + spans[winnerIndex].start;
    const worldEnd = rotation + spans[winnerIndex].end;
    // Fades in fast, holds, fades out over WIN_GLOW_MS.
    const glowAlpha = Math.sin(Math.min(1, progress) * Math.PI);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, worldStart, worldEnd);
    ctx.closePath();
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, `rgba(255,255,255,${0.55 * glowAlpha})`);
    grad.addColorStop(0.55, `rgba(201,161,90,${0.4 * glowAlpha})`);
    grad.addColorStop(1, "rgba(201,161,90,0)");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // The gold shimmer - each particle drifts outward and fades on its own
    // staggered schedule (see makeShimmerParticles).
    ctx.save();
    ctx.translate(cx, cy);
    for (const p of particles) {
      const localT = Math.min(1, Math.max(0, (progress - p.delay) / (1 - p.delay)));
      if (localT <= 0 || localT >= 1) continue;
      const alpha = Math.sin(localT * Math.PI);
      const dist = p.dist + p.drift * localT;
      const x = Math.cos(p.angle) * dist;
      const y = Math.sin(p.angle) * dist;
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(201,161,90,${alpha})`;
      ctx.fill();
    }
    ctx.restore();
  }

  // Bezel: a thin gold rim with a soft inner shadow for depth.
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 5;
  ctx.stroke();

  // Hub: the logo mark instead of a plain disc, clipped to a circle with
  // its own thin gold ring. Falls back to a plain disc for the handful of
  // frames before the image has finished loading.
  const hubR = 42;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
  ctx.fillStyle = "#431407";
  ctx.fill();
  if (logoImg?.complete && logoImg.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, hubR - 7, 0, Math.PI * 2);
    ctx.clip();
    const logoSize = (hubR - 7) * 2;
    ctx.drawImage(logoImg, cx - logoSize / 2, cy - logoSize / 2, logoSize, logoSize);
    ctx.restore();
  }
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Pointer: a slim pin at the top with a small round head, rather than a
  // plain flat triangle - the existing deflection logic (the "flap" as
  // each slice tab bumps past it) is unchanged.
  ctx.save();
  ctx.translate(cx, 6);
  ctx.rotate(needleDeflectRad);
  ctx.beginPath();
  ctx.moveTo(0, 28);
  ctx.lineTo(-5, 4);
  ctx.lineTo(5, 4);
  ctx.closePath();
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.strokeStyle = "#431407";
  ctx.lineWidth = 1.5;
  ctx.stroke();
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
  weights: number[],
  random: () => number = Math.random,
  extraTurns = 5,
): number {
  const { start, end } = sliceSpans(weights)[winnerIndex];
  const width = end - start;
  const jitter = (random() - 0.5) * width * 0.5;
  const winnerCenter = start + width / 2 + jitter;
  const targetRotation = -Math.PI / 2 - winnerCenter;
  return extraTurns * TWO_PI + targetRotation;
}

/**
 * Which slice index the fixed top needle points at for a given wheel
 * rotation - the inverse of computeLandingRotation's geometry. Used by the
 * property test to confirm every jitter sample lands back on the intended
 * winner, and by the component to tick as the needle crosses each boundary.
 */
export function sliceUnderNeedle(rotation: number, weights: number[]): number {
  const local = (((-Math.PI / 2 - rotation) % TWO_PI) + TWO_PI) % TWO_PI;
  const spans = sliceSpans(weights);
  const index = spans.findIndex((sp) => local >= sp.start && local < sp.end);
  return index === -1 ? spans.length - 1 : index;
}

export function Wheel({ slices, winnerId, engineLabel, onLanded }: WheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const status = "Chance decides — better matches get bigger slices…";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Crisp on high-DPI screens: the bitmap gets more physical pixels, but
    // every draw call below still works in the same 600x600 logical space
    // (unchanged math) since the extra resolution is compensated by this
    // one scale() - the canvas's on-page SIZE is controlled by CSS
    // (h-auto w-full), not by these attributes.
    const dpr = window.devicePixelRatio || 1;
    const size = 600;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const fontFamily = displayFontFamily();
    const logoImg = new Image();
    logoImg.src = "/logo-mark.svg";

    const weights = slices.map((s) => s.weight);
    const winnerIndex = Math.max(0, slices.findIndex((s) => s.id === winnerId));
    const finalRotation = computeLandingRotation(winnerIndex, weights);
    const shimmerParticles = makeShimmerParticles(size / 2 - 8);
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
    let landedAt = 0;
    let hapticFired = false;
    let calledOnLanded = false;

    function frame(now: number) {
      if (cancelled) return;
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      const rotation = reduced ? finalRotation * (1 - Math.pow(1 - t, 3)) : rotationAt(t);

      const tickIndex = sliceUnderNeedle(rotation, weights);
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
        if (!shakeUntil) {
          shakeUntil = now + 250;
          landedAt = now;
        }
        const shakeElapsed = now - (shakeUntil - 250);
        if (shakeElapsed < 250 && !reduced) {
          const decay = 1 - shakeElapsed / 250;
          shakeX = Math.sin(shakeElapsed / 18) * 6 * decay;
        }
      }

      // The win moment: a distinct "double tap" haptic (different from the
      // per-tick buzz above) plus the glow/shimmer, timed off landedAt.
      let winMoment: { winnerIndex: number; progress: number; particles: ShimmerParticle[] } | null = null;
      if (landedAt) {
        if (!hapticFired) {
          try {
            navigator.vibrate?.(reduced ? 10 : [12, 40, 18]);
          } catch {
            /* not supported */
          }
          hapticFired = true;
        }
        const winProgress = Math.min(1, (now - landedAt) / WIN_GLOW_MS);
        if (!reduced) {
          winMoment = { winnerIndex, progress: winProgress, particles: shimmerParticles };
        }
      }

      drawWheel(ctx!, slices, rotation, deflectNow, shakeX, fontFamily, logoImg, winMoment);

      const winMomentDone = !landedAt || reduced || now - landedAt >= WIN_GLOW_MS;
      if (t < 1 || (shakeUntil && now < shakeUntil) || !winMomentDone) {
        raf = requestAnimationFrame(frame);
      } else if (!calledOnLanded) {
        calledOnLanded = true;
        setTimeout(onLanded, 150);
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
      <p className="mb-6 min-h-[1rem] text-[11px] text-cream/40">{engineLabel ? `via ${engineLabel}` : ""}</p>
      <div className="relative mx-auto" style={{ width: "min(80vw, 340px)" }}>
        <canvas ref={canvasRef} width={600} height={600} className="h-auto w-full" style={{ touchAction: "none" }} />
      </div>
    </div>
  );
}
