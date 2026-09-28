"use client";

import { useCallback, useRef } from "react";

/** Triple-click or triple-tap within 600ms toggles dev mode. Both handlers
 * share one counter rather than trusting the browser's native
 * `MouseEvent.detail` for the click case - `detail` resets to 1 on the
 * slightest cursor movement between clicks (common on trackpads) or on a
 * platform/OS multi-click timing window shorter than ours, so relying on it
 * made the desktop trigger unreliable. An explicit counter+timer, the same
 * approach already needed for touch (which never populates `detail`),
 * behaves identically on both. Spread the returned handler onto the title
 * element's onClick (covers mouse) - touch's click event after a tap covers
 * mobile too, so no separate onTouchEnd is needed. */
export function useDevModeTrigger(onToggle: () => void) {
  const tapsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onClick = useCallback(() => {
    tapsRef.current += 1;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      tapsRef.current = 0;
    }, 600);
    if (tapsRef.current >= 3) {
      tapsRef.current = 0;
      onToggle();
    }
  }, [onToggle]);

  return { onClick };
}
