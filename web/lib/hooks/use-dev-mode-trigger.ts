"use client";

import { useCallback, useRef } from "react";

/** Triple-click (desktop) or triple-tap within 600ms (mobile, where
 * click.detail doesn't reliably reach 3) toggles dev mode. Spread the
 * returned handlers onto the title element. */
export function useDevModeTrigger(onToggle: () => void) {
  const tapsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.detail === 3) onToggle();
    },
    [onToggle],
  );

  const onTouchEnd = useCallback(() => {
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

  return { onClick, onTouchEnd };
}
