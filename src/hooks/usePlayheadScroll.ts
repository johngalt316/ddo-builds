import { useEffect, useRef, type RefObject } from 'react';

/**
 * Auto-scroll a horizontal timeline so the simulation playhead stays
 * around the 80% mark of the visible viewport.  Mirrors the behavior
 * shared by the magic rotation timeline, the melee combined timeline,
 * and the rotation chart so all three scroll together.
 *
 * - Reset to the start when the playhead jumps backwards (sim restart).
 * - Reset the internal "previous playhead" tracker when the simulation
 *   stops (`playheadTime` becomes undefined or negative).
 * - Optional `maxSeconds` clamp prevents over-scrolling when the
 *   playhead temporarily exceeds the visible track.
 */
export function usePlayheadScroll(
  scrollRef: RefObject<HTMLElement | null>,
  playheadTime: number | undefined,
  pxPerSecond: number,
  maxSeconds?: number,
) {
  const prevPlayhead = useRef(-1);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (playheadTime === undefined || playheadTime < 0) {
      prevPlayhead.current = -1;
      return;
    }
    if (playheadTime + 1e-3 < prevPlayhead.current) {
      el.scrollLeft = 0;
    }
    prevPlayhead.current = playheadTime;
    const clamped = maxSeconds !== undefined
      ? Math.min(playheadTime, maxSeconds)
      : playheadTime;
    const target = clamped * pxPerSecond - el.clientWidth * 0.8;
    if (target > el.scrollLeft) el.scrollLeft = target;
  }, [scrollRef, playheadTime, pxPerSecond, maxSeconds]);
}
