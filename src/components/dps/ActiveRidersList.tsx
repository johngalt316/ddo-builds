// Active Damage Riders panel — surfaces every per-hit damage rider
// the engine has detected on the active build (currently: imbues; future:
// mantles, holy strike, etc.). One chip per rider with hover/tap tooltip
// showing the full per-hit calculation so the user can audit where the
// damage is coming from.
//
// Mirrors ActiveProcsList's chip + popover visual idiom so the two panels
// sit naturally next to each other in the DPS editor.

import { useMemo } from 'react';
import type { EngineResult } from '@/engine/runEngine';
import type { ImbueRider } from '@/engine/dps/imbues';
import { imbueAvgPerHit } from '@/engine/dps/imbues';
import { useTooltip } from '@/hooks/useTooltip';
import { fmt } from '@/utils/formatNumbers';
import styles from './ActiveProcsList.module.css';

interface Props {
  engine: EngineResult | null;
  totalCharLevel: number;
}

/** One rendered rider chip with popover. */
function RiderChip({ rider, raw, perHit }: { rider: ImbueRider; raw: number; perHit: number }) {
  const { open, wrapperProps, triggerProps } = useTooltip<HTMLDivElement>();
  const tooltip = buildRiderTooltip(rider, raw, perHit);
  const dice = `${rider.diceNum}d${rider.diceSides}${rider.diceBonus ? `+${rider.diceBonus}` : ''}`;
  const mult = rider.diceMultiplier === 'imbueDie' ? ' × imbue dice'
             : rider.diceMultiplier === 'charLevel' ? ' × CL' : '';
  return (
    <div className={styles.chipWrapper} {...wrapperProps}>
      <button type="button" className={styles.chip} {...triggerProps}>
        <span className={styles.chipLabel}>{rider.source}</span>
        <span className={styles.chipEffect}>
          {dice}{mult} {rider.damageType} · ~{fmt(raw, 1)}/hit raw
        </span>
      </button>
      {open && (
        <div className={styles.popover} role="dialog">
          <pre className={styles.popoverContent}>{tooltip}</pre>
        </div>
      )}
    </div>
  );
}

function buildRiderTooltip(rider: ImbueRider, raw: number, perHitCritWeighted: number): string {
  const avgPerInstance = rider.diceNum * (rider.diceSides + 1) / 2 + rider.diceBonus;
  const lines: string[] = [];
  lines.push(`${rider.source}`);
  lines.push('');
  lines.push(`Dice: ${rider.diceNum}d${rider.diceSides}${rider.diceBonus ? `+${rider.diceBonus}` : ''} ${rider.damageType}`);
  lines.push(`  avg per die instance = ${avgPerInstance.toFixed(1)}`);
  if (rider.diceMultiplier === 'imbueDie') {
    lines.push(`Multiplier: × (1 base + N bonus) imbue dice per hit`);
  } else if (rider.diceMultiplier === 'charLevel') {
    lines.push(`Multiplier: × character level`);
  } else {
    lines.push(`Multiplier: × 1 (flat per hit)`);
  }
  lines.push(`Scaling: ${rider.scalingPct}% ${labelForStat(rider.scalingStat)}`);
  lines.push('');
  lines.push(`Pre-crit raw per hit: ${fmt(raw, 1)}`);
  lines.push(`Crit-weighted per hit: ${fmt(perHitCritWeighted, 1)}`);
  lines.push('');
  lines.push('Imbue damage rides every weapon hit (does NOT pick up the');
  lines.push('per-ability scalar) and crits with the weapon.');
  return lines.join('\n');
}

function labelForStat(stat: ImbueRider['scalingStat']): string {
  switch (stat) {
    case 'mp':           return 'Melee Power';
    case 'rp':           return 'Ranged Power';
    case 'higher_mr_p':  return 'max(Melee, Ranged) Power';
    case 'universal_sp': return 'Universal Spell Power';
    case 'sp':           return 'Spell Power (element-specific)';
  }
}

export function ActiveRidersList({ engine, totalCharLevel }: Props) {
  // Each rider's raw avg-per-hit damage, evaluated against the current
  // engine context (power scaling, imbue-dice count). Crit weighting
  // happens in the DPS calc — this chip just shows the raw number so
  // the user sees what each rider contributes before crit effects.
  const rows = useMemo(() => {
    if (!engine) return [];
    return engine.imbueRiders.map(r => {
      const raw = imbueAvgPerHit(r, engine, totalCharLevel);
      return { rider: r, raw, perHit: raw };
    });
  }, [engine, totalCharLevel]);

  return (
    <div className={styles.summary}>
      <div className={styles.summaryHeader}>
        <span className={styles.summaryLabel}>Active Damage Riders</span>
        <span className={styles.summaryLabel}>
          {rows.length > 0 ? `${rows.length}` : '—'}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className={styles.summaryEmpty}>
          No active imbue or rider — toggle an Imbue stance to add per-hit elemental damage.
        </div>
      ) : (
        <div className={styles.chips}>
          {rows.map(r => (
            <RiderChip key={r.rider.source} rider={r.rider} raw={r.raw} perHit={r.perHit} />
          ))}
        </div>
      )}
    </div>
  );
}
