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
import { scaleMult } from '@/engine/dps/damage';
import { resolveScaleInputs } from '@/engine/dps/calculator';
import styles from './ActiveProcsList.module.css';

interface Props {
  build: Build;
  engine: EngineResult | null;
  /** Sneak attack dice — drives Magical Ambush dice count. */
  sneakAttackDice: number;
}

const fmt0 = (n: number) => Math.round(n).toLocaleString();
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
const fmt2 = (n: number) => (Math.round(n * 100) / 100).toLocaleString();

/**
 * Build a multi-line tooltip for one proc that shows:
 *   - effect summary (avg dice / damage type / trigger pattern)
 *   - inputs (SP, crit chance, crit-mult bonus per scale profile)
 *   - the scaleMult formula expanded
 *   - resulting damage per trigger
 *   - debuff flags
 *
 * Dynamic procs (Magical Ambush, Shiradi Mantle) emit through a probe
 * context so they produce a sample component even outside a rotation;
 * the tooltip uses the build's actual SP / crit values from the engine.
 */
function procSummary(
  proc: Proc,
  build: Build,
  engine: EngineResult,
  sneakAttackDice: number,
): { effect: string; chip: string; tooltip: string } | null {
  const ctx = { sneakAttackDice, metamagicSP: 300 };
  // Probe with one dummy spell so per-spell procs (Magical Ambush) emit.
  // Static / global procs ignore the spell list.
  const probeSpells = [{ name: '*', casterLevel: engine.casterLevel.total }];
  const components = proc.toComponents(build, engine, ctx, probeSpells);
  if (components.length === 0) return null;
  const c: DamageComponent = components[0]!;

  // Resolve the actual SP / crit / critMult inputs the calculator
  // would feed into scaleMult for this component.
  const inputs   = resolveScaleInputs(c, engine, ctx);
  const sm       = scaleMult(inputs);
  const dpt      = c.qtyPerTrigger * c.avgDicePerHit * sm;

  const t = c.trigger;
  const triggerLabel =
    t.kind === 'per-cast'
      ? (t.spell ? `per cast of ${t.spell}` : 'per cast')
      : t.kind === 'per-hit'
        ? `per hit (${c.qtyPerTrigger}× per cast)`
        : `${(t.chance * 100).toFixed(0)}% on cast (ICD ${t.cooldownSec}s)`;

  const flags: string[] = [];
  if (c.useGenericVuln) flags.push('GV');
  if (c.useSonicVuln)   flags.push('SonicV');
  if (c.useMRR)         flags.push('MRR');
  const debuffs = flags.length > 0 ? flags.join(' · ') : 'none';

  // Chip face: prefer the full hit damage when the proc has chance
  // baked into avgDicePerHit (Shiradi-style). Otherwise show the
  // raw per-cast avg as before.
  const displayAvg = c.fullHitAvg ?? c.avgDicePerHit;
  const chanceTag  = c.perMissileChance !== undefined
    ? ` · ${(c.perMissileChance * 100).toFixed(0)}%/missile`
    : '';
  const effect = `${fmt1(displayAvg)} avg ${c.damageType}${chanceTag}`;
  const chip   = `${effect} · ${triggerLabel}`;

  // Show the full per-trigger math. critMultBonus stored as a fraction
  // (0.49 for a +1.49 modifier above 1.0, etc.) — display the bonus the
  // way the spreadsheet does and the actual ×crit multiplier in parens.
  const critMultDisplay = `+${fmt2(inputs.critMultBonus)} (×${fmt2(inputs.critMultBonus + 1)})`;
  const profile = c.scaleProfile;

  const lines: string[] = [
    proc.label,
    '',
    `Damage type: ${c.damageType}`,
    `Trigger: ${triggerLabel}`,
    `Debuffs: ${debuffs}`,
  ];

  if (c.fullHitAvg !== undefined && c.perMissileChance !== undefined) {
    // Chance-baked proc: surface the underlying mechanic explicitly.
    const probeMissiles = c.qtyPerTrigger;
    const pFire = c.avgDicePerHit / c.fullHitAvg;
    lines.push(
      '',
      `Full hit (on fire): ${fmt2(c.fullHitAvg)} avg ${c.damageType}`,
      `Per-missile chance: ${(c.perMissileChance * 100).toFixed(0)}%`,
      `Cap: 1 fire per cast`,
      '',
      `Per-cast pFire (this probe spell, ${probeMissiles} missile${probeMissiles === 1 ? '' : 's'})`,
      `  = 1 - (1 - ${(c.perMissileChance * 100).toFixed(0)}%)^${probeMissiles}`,
      `  = ${(pFire * 100).toFixed(1)}%`,
      `Effective avg dice per cast = ${fmt2(c.fullHitAvg)} × ${(pFire * 100).toFixed(1)}% = ${fmt2(c.avgDicePerHit)}`,
    );
  }

  lines.push(
    '',
    'Inputs:',
    `  qty per trigger: ${c.qtyPerTrigger}`,
    `  avg dice per hit: ${fmt2(c.avgDicePerHit)}`,
    `  scale profile: ${profile}`,
    `  spell power: ${fmt0(inputs.spellPower)}`,
    `  crit chance: ${(inputs.critChance * 100).toFixed(1)}%`,
    `  crit mult bonus: ${critMultDisplay}`,
    '',
    'scaleMult = (1 + SP/100) × (1 + crit × (critMult + 2))',
    `         = (1 + ${fmt0(inputs.spellPower)}/100) × (1 + ${(inputs.critChance * 100).toFixed(1)}% × (${fmt2(inputs.critMultBonus)} + 2))`,
    `         = ${fmt2(1 + inputs.spellPower / 100)} × ${fmt2(1 + inputs.critChance * (inputs.critMultBonus + 2))}`,
    `         = ${fmt2(sm)}`,
    '',
    `dmg per trigger = ${c.qtyPerTrigger} × ${fmt2(c.avgDicePerHit)} × ${fmt2(sm)}`,
    `              = ${fmt0(dpt)}`,
  );

  return { effect, chip, tooltip: lines.join('\n') };
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
              title={summary!.tooltip}
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
