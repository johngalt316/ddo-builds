// Ranged DPS editor — MVP
//
// Mirrors MeleeEditor but stripped down: weapon stat panel + the topline
// auto-DPS readout for the equipped ranged weapon. Full feature parity
// (rotation editor, combined timeline, simulator, damage-source breakdown)
// is deferred to the "full" ranged pass — this MVP gives users a working
// number to cross-reference against the in-game character sheet.

import { useMemo, useState } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { useBreakdowns } from '@/hooks/useBreakdowns';
import { physicalDamageMultiplier } from '@/engine/dps/difficulty';
import { aggregateDebuffs } from '@/engine/dps/debuffs';
import {
  rangedWeaponInfoFromGearItem, rangedBuildStatsFromEngine, rangedDPS,
  type RangedDPSResult,
} from '@/engine/dps/rangedCalc';
import { fmt } from '@/utils/formatNumbers';
import { TargetRow } from './widgets';
import type { SharedEditorProps } from './shared';
import styles from '../DPSCalculatorPanel.module.css';

export function RangedEditor({
  difficulty, targetCount, setTargetCount,
  debuffState,
  compareSetName, compareBreakdowns,
}: SharedEditorProps) {
  const build  = useBuildStore(s => s.build);
  const engine = useBreakdowns();

  // Debuffs aggregated but not yet folded into the MVP auto-DPS math.
  const debuffs = useMemo(
    () => ({
      ...aggregateDebuffs(debuffState, undefined, build),
      damageDealtMultiplier: physicalDamageMultiplier(difficulty),
    }),
    [debuffState, difficulty, build],
  );
  void debuffs;

  // Passive-alacrity override slider (cap 15%). User can dial it down for
  // "what if I lose Haste?" comparisons.
  const buildAlacrity = engine?.rangedSpeed.total ?? 0;
  const [alacrity, setAlacrity] = useState<number | null>(null);
  const effectiveAlacrity = alacrity ?? Math.min(buildAlacrity, 15);

  // Main-hand resolution. Ranged is always MH (bows / crossbows are 2H;
  // thrown weapons are 1H but the OH swing model from melee doesn't apply
  // — every ranged shot fires from the MH).
  const mainHandItem = useMemo(() => {
    const gs = build.gearSets.find(g => g.name === build.activeGearSet);
    return gs?.items.find(i => i.slot === 'MainHand') ?? null;
  }, [build.gearSets, build.activeGearSet]);

  const weaponInfo = useMemo(
    () => mainHandItem ? rangedWeaponInfoFromGearItem(mainHandItem) : null,
    [mainHandItem],
  );

  const buildStats = useMemo(() => {
    if (!engine || !weaponInfo) return null;
    return rangedBuildStatsFromEngine(build, engine, weaponInfo, effectiveAlacrity, 0);
  }, [engine, build, weaponInfo, effectiveAlacrity]);

  const result: RangedDPSResult | null = useMemo(
    () => weaponInfo && buildStats ? rangedDPS(weaponInfo, buildStats) : null,
    [weaponInfo, buildStats],
  );

  const compareResult = useMemo((): RangedDPSResult | null => {
    if (!compareSetName || !compareBreakdowns || !weaponInfo) return null;
    if (compareSetName === build.activeEnhancementSet) return null;
    const cs = rangedBuildStatsFromEngine(
      build, compareBreakdowns, weaponInfo, effectiveAlacrity, 0,
    );
    return rangedDPS(weaponInfo, cs);
  }, [compareSetName, compareBreakdowns, build, weaponInfo, effectiveAlacrity]);

  if (!engine) return null;

  // Empty state — no ranged weapon equipped or item not ranged-classifiable.
  if (!weaponInfo || !result || !buildStats) {
    const hint = mainHandItem
      ? `Main hand item "${mainHandItem.name}" couldn't be resolved as a ranged weapon. Equip a bow, crossbow, repeating crossbow, or thrown weapon in the Gear tab.`
      : 'No main-hand weapon equipped. Add a ranged weapon (bow / crossbow / thrown) in the Gear tab.';
    return (
      <div className={styles.editor}>
        <div className={styles.emptyState}>
          <strong>Ranged DPS unavailable</strong>
          <p>{hint}</p>
        </div>
      </div>
    );
  }

  const pct = (n: number) => `${fmt(n, 1)}%`;

  const flatBonus = weaponInfo.diceBonus + result.damageStatMod
    + weaponInfo.enchantBonus + result.flatDmgBonus;
  const baseStr = `${fmt(weaponInfo.wScalar, 2)}W`
    + `(${weaponInfo.diceNum}d${weaponInfo.diceSides}${weaponInfo.diceBonus ? `+${weaponInfo.diceBonus}` : ''})`
    + ` + ${flatBonus}`;

  const critStr = result.critMult1920Bonus > 0
    ? `(${21 - result.critThreatFaces}–18)×${result.critMultOnAll}  (19–20)×${result.critMultOn1920}`
    : `(${21 - result.critThreatFaces}–20)×${result.critMultOnAll}`;

  const categoryLabel = weaponInfo.category.replace(/-/g, ' ');

  return (
    <div className={styles.editor}>
      {/* Weapon stat panel — single MH (no OH/shield for ranged). */}
      <div className={styles.weaponStatPanels}>
        <div className={styles.weaponStatPanel}>
          <span className={styles.weaponStatPanelHeader}>
            {mainHandItem?.icon && (
              <img
                src={`/assets/images/ItemImages/${mainHandItem.icon}.png`}
                alt=""
                style={{ width: 16, height: 16, objectFit: 'contain', marginRight: 4, verticalAlign: 'middle', flexShrink: 0 }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            Main Hand ({categoryLabel})
          </span>
          <span className={styles.weaponStatPanelName}>{weaponInfo.name}</span>

          <div className={styles.weaponStatRow}>
            <span className={styles.weaponStatRowLabel}>Base</span>
            <span className={styles.weaponStatRowValue}>{baseStr}</span>
          </div>
          <div className={styles.weaponStatRow}>
            <span className={styles.weaponStatRowLabel}>Crit</span>
            <span className={styles.weaponStatRowValue}>{critStr}</span>
          </div>
          <div className={styles.weaponStatRow}>
            <span className={styles.weaponStatRowLabel}>Damage stat</span>
            <span className={styles.weaponStatRowValue}>
              {result.damageStat} (+{result.damageStatMod})
            </span>
          </div>
          <div className={styles.weaponStatRow}>
            <span className={styles.weaponStatRowLabel}>Ranged Power</span>
            <span className={styles.weaponStatRowValue}>+{result.rangedPower}</span>
          </div>
          <div className={styles.weaponStatRow}>
            <span className={styles.weaponStatRowLabel}>Doubleshot</span>
            <span className={styles.weaponStatRowValue}>{pct(result.doubleshot)}</span>
          </div>
          <div className={styles.weaponStatRow}>
            <span className={styles.weaponStatRowLabel}>
              Alacrity <span className={styles.weaponStatRowMuted}>(passive, cap 15%)</span>
            </span>
            <span className={styles.weaponStatRowValue}>{pct(result.rangedAlacrity)}</span>
          </div>
          <div className={styles.weaponStatRow}>
            <span className={styles.weaponStatRowLabel}>APM</span>
            <span className={styles.weaponStatRowValue}>{fmt(result.apm, 1)}</span>
          </div>
        </div>
      </div>

      <div className={styles.meleeControls}>
        <TargetRow
          targetCount={targetCount}
          setTargetCount={setTargetCount}
          prr={0}
          mrr={0}
        />
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Passive alacrity override</span>
          <input
            type="range"
            min={0}
            max={15}
            step={1}
            value={effectiveAlacrity}
            onChange={e => setAlacrity(Number(e.target.value))}
          />
          <span className={styles.fieldValue}>{pct(effectiveAlacrity)}</span>
          {alacrity !== null && (
            <button
              type="button"
              onClick={() => setAlacrity(null)}
              title="Use the build's natural alacrity"
              style={{ marginLeft: 8, fontSize: '0.7rem', cursor: 'pointer', background: 'none', border: 'none', color: 'var(--color-text-muted)' }}
            >
              reset
            </button>
          )}
        </label>
      </div>

      <div className={styles.meleeStatRow}>
        <span className={styles.meleeStatChip}>
          Avg / hit: <strong>{fmt(result.avgPerHit, 1)}</strong>
        </span>
        <span className={styles.meleeStatChip}>
          Effective shots/min: <strong>{fmt(result.effectivePerMin, 1)}</strong>
        </span>
        <span className={styles.meleeStatChip}>
          Crit chance: <strong>{pct(result.critChance * 100)}</strong>
        </span>
        <span className={styles.meleeStatChip} style={{ background: 'var(--color-bg)', borderColor: 'var(--color-gold)' }}>
          Auto-DPS: <strong>{fmt(result.totalAutoDPS, 0)}</strong>
        </span>
      </div>

      {compareResult && (
        <div className={styles.compareRow}>
          <span className={styles.compareLabel}>vs {compareSetName}:</span>
          <span className={styles.compareColValue}>
            {fmt(compareResult.totalAutoDPS, 0)} DPS{' '}
            <span className={
              compareResult.totalAutoDPS >= result.totalAutoDPS
                ? styles.compareDeltaUp
                : styles.compareDeltaDown
            }>
              ({compareResult.totalAutoDPS >= result.totalAutoDPS ? '+' : ''}
              {fmt(compareResult.totalAutoDPS - result.totalAutoDPS, 0)})
            </span>
          </span>
        </div>
      )}

      <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0' }}>
        MVP: auto-attack DPS only. Manyshot burst, imbue dice (Slaying Arrows / Arcane Archer),
        and rotation modeling come in the full ranged pass.
      </p>
    </div>
  );
}
