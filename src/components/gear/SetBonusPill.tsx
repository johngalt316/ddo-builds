import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DDOBuffBlock } from '@/types/ddoData';
import { formatBuffBlock } from '@/utils/formatBuff';
import type { AnchorRect } from './useHoverAnchor';
import styles from './SetBonusPill.module.css';

const TOOLTIP_DELAY_MS = 150;
/** Distance between the anchor and the tooltip edge. */
const TIP_GAP = 4;
/** Edge margin so the tooltip doesn't kiss the viewport edge. */
const VIEWPORT_PAD = 8;

interface Props {
  name: string;
  /** How many pieces are equipped of this set. */
  count: number;
  /** The next tier requirement (for the pill body), or undefined when maxed/unknown. */
  nextTier?: number;
  /** Style variant — derived in the parent from activeTier > 0 / knownInCatalog. */
  variant: 'active' | 'pending' | 'unknown';
  /** Tier ladder; empty when the set name isn't in the catalog. */
  buffs: DDOBuffBlock[];
  /** Optional fallback message when buffs is empty. */
  unknownNote?: string;
}

export function SetBonusPill({ name, count, nextTier, variant, buffs, unknownNote }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const showTimer = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  useEffect(() => () => {
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
  }, []);

  function handleEnter() {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const snapshot: AnchorRect = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    showTimer.current = window.setTimeout(() => setAnchor(snapshot), TOOLTIP_DELAY_MS);
  }
  function handleLeave() {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    setAnchor(null);
  }

  const className =
    variant === 'active'  ? styles.pillActive  :
    variant === 'pending' ? styles.pillPending :
                            styles.pillUnknown;

  return (
    <>
      <span
        ref={ref}
        className={className}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {name} {count}{nextTier !== undefined ? `/${nextTier}` : ''}
      </span>
      {anchor && createPortal(
        <SetBonusTooltip
          anchor={anchor}
          name={name}
          count={count}
          buffs={buffs}
          unknownNote={unknownNote}
        />,
        document.body,
      )}
    </>
  );
}

interface TooltipProps {
  anchor: AnchorRect;
  name: string;
  count: number;
  buffs: DDOBuffBlock[];
  unknownNote?: string;
}

export function SetBonusTooltip({ anchor, name, count, buffs, unknownNote }: TooltipProps) {
  const tipRef = useRef<HTMLDivElement>(null);
  // Render off-screen first so we can measure, then snap into the correct
  // place in the same paint frame (useLayoutEffect runs before paint).
  const [pos, setPos] = useState<{ top: number; left: number; visibility: 'hidden' | 'visible' }>({
    top: -9999, left: -9999, visibility: 'hidden',
  });

  useLayoutEffect(() => {
    if (!tipRef.current) return;
    const tip = tipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Vertical: prefer below; flip above if not enough room there but more
    // exists above.
    const spaceBelow = vh - anchor.bottom - VIEWPORT_PAD;
    const spaceAbove = anchor.top - VIEWPORT_PAD;
    const flipUp = tip.height > spaceBelow && spaceAbove > spaceBelow;
    let top = flipUp
      ? anchor.top - TIP_GAP - tip.height
      : anchor.bottom + TIP_GAP;
    // If flipping up still overflows, clamp to top edge.
    if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;
    // If pinning below still overflows, clamp upward.
    if (top + tip.height > vh - VIEWPORT_PAD) {
      top = Math.max(VIEWPORT_PAD, vh - VIEWPORT_PAD - tip.height);
    }

    // Horizontal: anchor to pill left, but clamp inside viewport.
    let left = anchor.left;
    if (left + tip.width > vw - VIEWPORT_PAD) {
      left = vw - VIEWPORT_PAD - tip.width;
    }
    if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;

    setPos({ top, left, visibility: 'visible' });
  }, [anchor]);

  const sortedBuffs = [...buffs].sort((a, b) => a.equippedCount - b.equippedCount);

  return (
    <div
      ref={tipRef}
      className={styles.tooltip}
      role="tooltip"
      style={{ top: pos.top, left: pos.left, visibility: pos.visibility }}
    >
      <div className={styles.tooltipHeader}>{name}</div>
      {sortedBuffs.length === 0 && (
        <div className={styles.tooltipEmpty}>
          {unknownNote ?? 'Set name not in catalog.'}
        </div>
      )}
      {sortedBuffs.map((buff, i) => {
        const active = buff.equippedCount <= count;
        const body = (buff.description?.trim()) || formatBuffBlock(buff) || '(no effects)';
        return (
          <div
            key={i}
            className={active ? styles.tooltipTierActive : styles.tooltipTier}
          >
            <span className={styles.tooltipTierCount}>
              {buff.equippedCount} pc
            </span>
            <span className={styles.tooltipTierBody}>{body}</span>
          </div>
        );
      })}
    </div>
  );
}
