import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

/** Delay (ms) before the tooltip appears — gives the cursor a moment to settle. */
const TOOLTIP_DELAY_MS = 150;

export interface AnchorRect { top: number; bottom: number; left: number; right: number }

/**
 * Shared hover-tooltip plumbing: tracks the anchor element's bounding rect
 * and delays showing the tooltip until the cursor has lingered. Returns the
 * anchor rect (or null when hidden) plus mouse-event handlers to spread on
 * the trigger element.
 *
 * Lives in its own file (not next to `SetBonusPill`) so React Fast Refresh
 * stays clean — `react-refresh/only-export-components` complains when a
 * module exports both components and non-component bindings like hooks.
 */
export function useHoverAnchor(): {
  anchor: AnchorRect | null;
  onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
} {
  const showTimer = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  useEffect(() => () => {
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
  }, []);

  return {
    anchor,
    onMouseEnter: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const snap: AnchorRect = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      showTimer.current = window.setTimeout(() => setAnchor(snap), TOOLTIP_DELAY_MS);
    },
    onMouseLeave: () => {
      if (showTimer.current !== null) {
        window.clearTimeout(showTimer.current);
        showTimer.current = null;
      }
      setAnchor(null);
    },
  };
}
