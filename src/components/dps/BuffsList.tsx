// Active buffs panel.
//
// Currently surfaces the build's active Metamagic toggles. Read-only —
// metamagics are managed on the Spells tab; this panel is just a
// visibility cue in the DPS view so the user can sanity-check which
// damage modifiers are baked into the rotation calculation.
//
// Layout mirrors ActiveProcsList so the two sections stack naturally.

import { useMemo } from 'react';
import type { Build } from '@/types/build';
import styles from './BuffsList.module.css';

/** Per-metamagic SP contribution to the on-cast 'proc' scaling pool.
 *  Matches the wiki's "metamagic spellpower" rule: Empower + Maximize
 *  + Intensify drive the proc-scaling SP, the rest don't. */
const METAMAGIC_SP: Record<string, number> = {
  'Empower':         75,
  'Maximize':        150,
  'Intensify':       75,
  'Empower Healing': 75,
  // Heighten, Quicken, Enlarge, Extend, Accelerate, Embolden don't
  // contribute to proc spell power per the spreadsheet's reference.
};

interface Props {
  build: Build;
}

export function BuffsList({ build }: Props) {
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
            const sp = METAMAGIC_SP[name] ?? 0;
            return (
              <span
                key={name}
                className={styles.chip}
                title={[
                  `Metamagic: ${name}`,
                  sp > 0 ? `Proc spell power: +${sp}` : 'No proc-SP contribution',
                ].join('\n')}
              >
                <span className={styles.chipLabel}>{name}</span>
                {sp > 0 && <span className={styles.chipEffect}>+{sp} SP</span>}
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}
