// Dev Mode used to be a hidden triple-tap easter egg; it's now a plain
// Settings toggle, persisted to localStorage like every other preference
// (fw_sound, fw_engine) rather than sessionStorage - it's a deliberate
// setting now, not a one-off-per-tab gimmick.
import { local } from "@/lib/safe-storage";

export function isDevModeEnabled(): boolean {
  return local.get("fw_dev_mode", "0") === "1";
}

export function setDevModeEnabled(enabled: boolean) {
  local.set("fw_dev_mode", enabled ? "1" : "0");
}
