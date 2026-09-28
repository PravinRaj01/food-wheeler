// A single tiny Web Audio oscillator tick for the wheel's slice crossings.
// Muted by default (per the plan) - toggled from Settings, persisted to
// localStorage. No audio files, no CDN - just a synthesized click.
import { local } from "@/lib/safe-storage";

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

export function isSoundEnabled(): boolean {
  return local.get("fw_sound", "0") === "1";
}

export function setSoundEnabled(enabled: boolean) {
  local.set("fw_sound", enabled ? "1" : "0");
}

export function playTick() {
  if (!isSoundEnabled()) return;
  const audioCtx = getContext();
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(1400, now);
  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.04);
}
