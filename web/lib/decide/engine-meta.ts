import { Cpu, Target, Zap } from "lucide-react";
import type { EngineId } from "@/lib/decide/types";

// Shared per-engine display identity - icon, accent color and caption - used
// by both the engine picker (EngineToggle) and the Dev Mode comparison
// cards, so an engine reads as the same "thing" wherever it shows up.
export const ENGINE_ICONS: Record<EngineId, typeof Zap> = { laya: Zap, gliner: Target, clm_8b: Cpu };
export const ENGINE_CAPTIONS: Record<EngineId, string> = {
  laya: "Fast, joint-attention model",
  gliner: "CPU-first, handles exclusions well",
  clm_8b: "Dual-encoder — needs a GPU server",
};
// Distinct from the shared --ember brand accent, so a non-primary engine's
// card in the comparison grid doesn't read as "also selected".
export const ENGINE_ACCENTS: Record<EngineId, string> = {
  laya: "var(--ember)",
  gliner: "#2dd4bf",
  clm_8b: "#818cf8",
};
