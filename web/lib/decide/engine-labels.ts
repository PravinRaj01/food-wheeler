import type { EngineId } from "@/lib/decide/types";

/** Short display names, for the results list header and Dev Mode cards. Kept
 * apart from engine-meta.ts (icons and colours) so pure logic like the
 * decide reducer can use them without pulling in the icon library. */
export const ENGINE_LABELS: Record<EngineId, string> = {
  laya: "Laya",
  gliner: "GLiNER",
  clm_8b: "CLM-8B",
};
