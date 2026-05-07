// Active buffs panel.
//
// Currently surfaces the build's active Metamagic toggles. Read-only —
// metamagics are managed on the Spells tab; this panel is just a
// visibility cue in the DPS view so the user can sanity-check which
// damage modifiers are baked into the rotation calculation.

import { useMemo } from 'react';
import type { Build } from '@/types/build';
import type { DDOMetamagicData } from '@/types/ddoData';
import { useTooltip } from '@/hooks/useTooltip';
import styles from './BuffsList.module.css';

/** Per-metamagic SP contribution to the on-cast 'proc' scaling pool.
 *  Matches the wiki's "metamagic spellpower" rule: Empower + Maximize
 *  + Intensify drive proc spell power; the rest don't. Indexed by the
 *  metamagic's full stance name so it lines up with `Build.activeMetamagics`. */
const METAMAGIC_PROC_SP: Record<string, number> = {
  'Empower Spell':         75,
  'Maximize Spell':        150,
  'Intensify Spell':       75,
  'Empower Healing Spell': 75,
  // Heighten / Quicken / Enlarge / Extend / Accelerate / Embolden don't
  // contribute to proc spell power.
};

interface Props {
  build: Build;
  metamagics: DDOMetamagicData[];
}

export function BuffsList({ build, metamagics }: Props) {
  const active = useMemo(
    () => build.activeMetamagics ?? [],
    [build.activeMetamagics],
  );

  return (
    <section className={styles.summary}>
      <div className={styles.summaryHeader}>
        <span className={styles.summaryLabel}>
          Buffs · {active.length}
        </span>
      </div>
      {active.length === 0 ? (
        <div className={styles.summaryEmpty}>
          No active metamagics — toggle on the Spells tab to add them.
        </div>
      ) : (
        <div className={styles.chips}>
          {active.map(name => {
            const mm        = metamagics.find(m => m.name === name);
            const procSP    = METAMAGIC_PROC_SP[name] ?? 0;
            return (
              <MetamagicChip
                key={name}
                name={name}
                metamagic={mm}
                procSP={procSP}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

interface MetamagicChipProps {
  name: string;
  metamagic?: DDOMetamagicData;
  procSP: number;
}

function MetamagicChip({ name, metamagic, procSP }: MetamagicChipProps) {
  const { open, wrapperProps, triggerProps } = useTooltip();

  // Per-cast SP cost description. Heighten is per-level (1 SP × levels
  // raised); everything else is a flat surcharge.
  const costLabel = metamagic
    ? metamagic.costFormula === 'per-level'
      ? `+${metamagic.baseSPCost} SP × levels raised (Heighten)`
      : `+${metamagic.baseSPCost} SP per eligible cast`
    : '+0 SP';

  const tooltipLines = [
    metamagic?.shortName ?? name,
    '',
    `SP cost: ${costLabel}`,
    procSP > 0
      ? `Proc spell power: +${procSP} (drives 'proc' scale profile)`
      : `No proc spell power contribution`,
  ];

  // Compact chip face — show the SP cost surcharge so the user sees
  // how much each active metamagic adds per cast.
  const chipBadge = metamagic
    ? metamagic.costFormula === 'per-level'
      ? `+${metamagic.baseSPCost}/lvl`
      : `+${metamagic.baseSPCost} SP`
    : '';

  return (
    <span className={styles.chipWrapper} {...wrapperProps}>
      <button
        type="button"
        className={styles.chip}
        {...triggerProps}
      >
        <span className={styles.chipLabel}>{metamagic?.shortName ?? name}</span>
        {chipBadge && <span className={styles.chipEffect}>{chipBadge}</span>}
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label={`${name} details`}>
          <pre className={styles.popoverContent}>{tooltipLines.join('\n')}</pre>
        </div>
      )}
    </span>
  );
}
