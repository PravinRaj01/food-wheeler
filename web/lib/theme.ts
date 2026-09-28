// Three-state theme preference (System/Light/Dark), persisted like every
// other setting (fw_sound, fw_dev_mode, fw_engine). "system" means no
// explicit data-theme attribute at all - globals.css's own
// prefers-color-scheme media query does the choosing from there. Settings'
// segmented control calls setThemePreference(); the no-flash inline script
// in app/layout.tsx applies the same logic before first paint, as a small
// stringified copy of applyTheme() below (it has to run synchronously,
// before any import machinery exists yet).
import { local } from "@/lib/safe-storage";

export type ThemePreference = "system" | "light" | "dark";

const THEME_KEY = "fw_theme";

export function getThemePreference(): ThemePreference {
  const stored = local.get(THEME_KEY, "system");
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function setThemePreference(pref: ThemePreference) {
  local.set(THEME_KEY, pref);
  applyTheme(pref);
}

/** Sets (or clears) the data-theme attribute globals.css keys off of. */
export function applyTheme(pref: ThemePreference) {
  if (typeof document === "undefined") return;
  if (pref === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", pref);
}
