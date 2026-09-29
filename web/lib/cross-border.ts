// Off by default: get_candidates()/list_places() on the API keep results
// inside whichever country the request's location is in (see
// candidates.detect_country()), so a search near a border doesn't return
// restaurants from the neighbouring country. This is the one Settings
// switch that turns that filtering off. Persisted the same way as every
// other preference (fw_sound, fw_dev_mode).
import { local } from "@/lib/safe-storage";

export function isCrossBorderEnabled(): boolean {
  return local.get("fw_cross_border", "0") === "1";
}

export function setCrossBorderEnabled(enabled: boolean) {
  local.set("fw_cross_border", enabled ? "1" : "0");
}
