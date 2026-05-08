// Active buffs panel.
//
// Shows active Metamagic toggles (magic rotation) and active combat
// stances with their DPS contributions (melee/ranged rotation).

import { useMemo } from 'react';
import type { Build } from '@/types/build';
import type { DDOMetamagicData } from '@/types/ddoData';
import type { EngineResult } from '@/engine/runEngine';
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

// Stances that are purely positional/form and don't contribute directly
// to DPS output — filter these out of the combat-stance display.
const COSMETIC_STANCE_KEYWORDS = [
  'cloth armor', 'lawful', 'neutral', 'good', 'evil',
  'aasimar', 'scourge', 'bond', 'reaper',
];

function isCosmeticStance(name: string): boolean {
  const lower = name.toLowerCase();
  return COSMETIC_STANCE_KEYWORDS.some(k => lower.includes(k));
}

/** Summarise the DPS contributions of an active stance from the engine
 *  breakdowns.  Returns an array of short strings like "+21 Insightful dmg",
 *  "+1[W]", "+30 MP", "80% DS". */
function stanceContributions(stanceName: string, engine: EngineResult): string[] {
  const out: string[] = [];
  const match = (source: string) => source.toLowerCase().includes(stanceName.toLowerCase());

  const flatDmg = engine.weaponFlatDamage.contributors
    .filter(c => c.applied && match(c.source))
    .reduce((s, c) => s + c.value, 0);
  if (flatDmg !== 0) out.push(`${flatDmg > 0 ? '+' : ''}${flatDmg} ${flatDmg > 0 ? '' : ''}dmg`);

  const wBonus = engine.weaponBaseDamage.contributors
    .filter(c => c.applied && match(c.source))
    .reduce((s, c) => s + c.value, 0);
  if (wBonus !== 0) out.push(`+${wBonus}[W]`);

  const mp = engine.meleePower.contributors
    .filter(c => c.applied && match(c.source))
    .reduce((s, c) => s + c.value, 0);
  if (mp !== 0) out.push(`+${mp} MP`);

  const ds = engine.doublestrike.contributors
    .filter(c => c.applied && match(c.source))
    .reduce((s, c) => s + c.value, 0);
  if (ds !== 0) out.push(`+${ds}% DS`);

  return out;
}

interface Props {
  build: Build;
  metamagics: DDOMetamagicData[];
  /** When provided, active combat stances with DPS contributions are shown
   *  alongside metamagics (used by melee/ranged editors). */
  engine?: EngineResult;
  /** 'magic' hides stance chips; 'melee'/'ranged' shows them. */
  attackMode?: 'magic' | 'melee' | 'ranged';
}

export function BuffsList({ build, metamagics, engine, attackMode = 'magic' }: Props) {
  const activeMetamagics = useMemo(
    () => build.activeMetamagics ?? [],
    [build.activeMetamagics],
  );

  // Active combat stances: only shown for melee/ranged, only when engine is
  // available, and filtered to those with at least one DPS contribution.
  const activeStances = useMemo(() => {
    if (attackMode === 'magic' || !engine) return [];
    const stanceNames = build.activeStances ?? [];
    return stanceNames
      .filter(name => !isCosmeticStance(name))
      .map(name => ({
        name,
        contributions: stanceContributions(name, engine),
        stance: engine.availableStances.find(s => s.data.name === name),
      }))
      .filter(s => s.contributions.length > 0 || s.stance);
  }, [build.activeStances, engine, attackMode]);

  const totalChips = activeMetamagics.length + activeStances.length;

  return (
    <section className={styles.summary}>
      <div className={styles.summaryHeader}>
        <span className={styles.summaryLabel}>
          Buffs · {totalChips}
        </span>
      </div>
      {totalChips === 0 ? (
        <div className={styles.summaryEmpty}>
          No active buffs — toggle metamagics from the Spells tab or stances from the Stances tab.
        </div>
      ) : (
        <div className={styles.chips}>
          {activeMetamagics.map(name => {
            const mm     = metamagics.find(m => m.name === name);
            const procSP = METAMAGIC_PROC_SP[name] ?? 0;
            return <MetamagicChip key={name} name={name} metamagic={mm} procSP={procSP} />;
          })}
          {activeStances.map(({ name, contributions, stance }) => (
            <StanceChip
              key={name}
              name={name}
              contributions={contributions}
              description={stance?.data.description}
            />
          ))}
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
      <button type="button" className={styles.chip} {...triggerProps}>
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

interface StanceChipProps {
  name: string;
  contributions: string[];
  description?: string;
}

function StanceChip({ name, contributions, description }: StanceChipProps) {
  const { open, wrapperProps, triggerProps } = useTooltip();
  const badge = contributions.join('  ');
  const tooltipLines = [
    name,
    ...(contributions.length > 0 ? ['', 'DPS contribution:', ...contributions.map(c => `  ${c}`)] : []),
    ...(description ? ['', description] : []),
  ];
  return (
    <span className={styles.chipWrapper} {...wrapperProps}>
      <button type="button" className={styles.chip} {...triggerProps}>
        <span className={styles.chipLabel}>{name}</span>
        {badge && <span className={styles.chipEffect}>{badge}</span>}
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label={`${name} details`}>
          <pre className={styles.popoverContent}>{tooltipLines.join('\n')}</pre>
        </div>
      )}
    </span>
  );
}
