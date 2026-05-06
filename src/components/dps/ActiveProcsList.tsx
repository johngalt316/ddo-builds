// Phase 6.4.9 — Active procs panel.
//
// Shows every PROC_CATALOG entry whose isActive predicate matches the
// current build/engine state. Read-only; procs aren't user-toggleable
// (they fire whenever the source gear / enhancement / class feature is
// present).
//
// Layout mirrors DebuffsSummary so they sit naturally next to each other
// in the DPS panel.

import { useMemo } from 'react';
import { PROC_CATALOG, type Proc } from '@/engine/dps/procs';
import type { Build } from '@/types/build';
import type { EngineResult } from '@/engine/runEngine';
import type { DamageComponent } from '@/engine/dps/damage';
import styles from './ActiveProcsList.module.css';

interface Props {
  build: Build;
  engine: EngineResult | null;
  /** Sneak attack dice — drives Magical Ambush dice count. */
  sneakAttackDice: number;
}

/**
 * Build a "10d20 Fire · per cast" style summary for one proc, derived
 * from its first DamageComponent. We use a probe context so dynamic
 * procs (Magical Ambush, Shiradi Mantle) emit something even outside
 * a rotation. Returns null when the proc emits no components at all
 * (e.g. Magical Ambush with 0 sneak dice).
 */
function procSummary(
  proc: Proc,
  build: Build,
  engine: EngineResult,
  sneakAttackDice: number,
): { effect: string; trigger: string; debuffs: string } | null {
  const ctx = { sneakAttackDice };
  // Probe with one dummy spell so per-spell procs (Magical Ambush) emit.
  // Static / global procs ignore the spell list.
  const probeSpells = [{ name: '*', casterLevel: engine.casterLevel.total }];
  const components = proc.toComponents(build, engine, ctx, probeSpells);
  if (components.length === 0) return null;
  const c: DamageComponent = components[0]!;
  const t = c.trigger;
  const triggerLabel =
    t.kind === 'per-cast'
      ? (t.spell ? `per cast of ${t.spell}` : 'per cast')
      : t.kind === 'per-hit'
        ? `per hit (${c.qtyPerTrigger}× per cast)`
        : `${(t.chance * 100).toFixed(0)}% on cast (ICD ${t.cooldownSec}s)`;
  const effect = `${Math.round(c.avgDicePerHit * 10) / 10} avg ${c.damageType}`;
  const flags: string[] = [];
  if (c.useGenericVuln) flags.push('GV');
  if (c.useSonicVuln)   flags.push('SonicV');
  if (c.useMRR)         flags.push('MRR');
  const debuffs = flags.length > 0 ? flags.join(' · ') : 'no debuffs';
  return { effect, trigger: triggerLabel, debuffs };
}

export function ActiveProcsList({ build, engine, sneakAttackDice }: Props) {
  const active = useMemo(() => {
    if (!engine) return [];
    return PROC_CATALOG
      .filter(p => p.isActive(build, engine))
      .map(p => ({ proc: p, summary: procSummary(p, build, engine, sneakAttackDice) }))
      .filter(x => x.summary !== null);
  }, [build, engine, sneakAttackDice]);

  return (
    <section className={styles.summary}>
      <div className={styles.summaryHeader}>
        <span className={styles.summaryLabel}>
          Active Procs · {active.length}
        </span>
      </div>
      {active.length === 0 ? (
        <div className={styles.summaryEmpty}>
          No active procs — equip gear or take enhancements that grant on-cast effects.
        </div>
      ) : (
        <div className={styles.chips}>
          {active.map(({ proc, summary }) => (
            <span
              key={proc.id}
              className={styles.chip}
              title={`${proc.label}\n${summary!.effect} · ${summary!.trigger}\nDebuffs: ${summary!.debuffs}`}
            >
              <span className={styles.chipLabel}>{proc.label}</span>
              <span className={styles.chipEffect}>{summary!.effect}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
