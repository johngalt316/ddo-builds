// Ranged DPS editor — full parity port of MeleeEditor adjusted for the
// ranged math (one weapon, no off-hand swing; Doubleshot replacing the
// MH/OH split; Ranged Power and Ranged Alacrity instead of their melee
// counterparts). Filters the ability palette to ranged + boost-class
// abilities so weapon-attack SLAs like Manyshot show up in this pane,
// not in Magic or Melee.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { useBreakdowns } from '@/hooks/useBreakdowns';
import { getMagicAbilities, type MagicAbility } from '@/engine/dps/abilities';
import type { RotationStep } from '@/engine/dps/rotation';
import { fillToOneMinute, findFirstAvailableSlot } from '@/engine/dps/timing';
import { newRotationStep } from '@/engine/dps/rotation';
import type { AbilityDamageInfo } from '@/engine/dps/calculator';
import { aggregateSpellCostReductions } from '@/engine/dps/spellCost';
import { aggregateDebuffs } from '@/engine/dps/debuffs';
import { physicalDamageMultiplier } from '@/engine/dps/difficulty';
import {
  rangedWeaponInfoFromGearItem, rangedBuildStatsFromEngine, rangedDPS,
  rangedAbilityDamagePerActivation, rangedCategoryFromName,
} from '@/engine/dps/rangedCalc';
import { critRangeBonusForWeapon } from '@/engine/dps/meleeCalc';
import { fmt } from '@/utils/formatNumbers';
import { MeleeCombinedTimeline } from '../MeleeCombinedTimeline';
import { RotationPalette } from '../RotationPalette';
import { ManageActiveDialog } from '../ManageActiveDialog';
import { DebuffsSummary } from '../DebuffsPanel';
import { ActiveProcsList } from '../ActiveProcsList';
import { BuffsList } from '../BuffsList';
import { TargetRow, SimDurationPicker } from './widgets';
import { EMPTY_STEPS, type SharedEditorProps } from './shared';
import styles from '../DPSCalculatorPanel.module.css';

type RangedEditorProps = SharedEditorProps;

export function RangedEditor({
  difficulty, targetCount, setTargetCount,
  debuffState, onManageDebuffs,
  compareSetName, setCompareSetName, compareBuild, compareBreakdowns,
  simDuration, setSimDuration,
}: RangedEditorProps) {
  const build  = useBuildStore(s => s.build);
  const engine = useBreakdowns();

  // Debuffs — same aggregation as melee; the difficulty-typed damage
  // multiplier still applies (ranged uses physical, just like melee).
  const debuffs = useMemo(
    () => ({
      ...aggregateDebuffs(debuffState, undefined, build),
      damageDealtMultiplier: physicalDamageMultiplier(difficulty),
    }),
    [debuffState, difficulty, build],
  );
  void debuffs;  // future: routed into per-shot proc evaluation

  // Auto-fill toggle for rotation insertions.
  const [rangedAuto, setRangedAuto] = useState(true);

  // Simulation playhead — same animation pattern as melee.
  const [simTime, setSimTime]       = useState(0);
  const [simRunning, setSimRunning] = useState(false);
  const simStartedAt = useRef(0);

  useEffect(() => {
    if (!simRunning) return;
    let cancelled = false;
    simStartedAt.current = performance.now() - simTime * 1000;
    let raf = 0;
    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = (now - simStartedAt.current) / 1000;
      if (elapsed >= simDuration) { setSimTime(simDuration); setSimRunning(false); return; }
      setSimTime(elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simRunning]);

  function onSimulateClick() {
    if (simRunning) { setSimRunning(false); return; }
    if (simTime >= simDuration - 1e-3) setSimTime(0);
    setSimRunning(true);
  }
  function onRestartClick() {
    setSimRunning(false);
    setSimTime(0);
  }

  // Passive-alacrity override slider (cap 15% per DDO rules).
  const buildAlacrity = engine?.rangedSpeed.total ?? 0;
  const [alacrity, setAlacrity] = useState<number | null>(null);
  const effectiveAlacrity = alacrity ?? Math.min(buildAlacrity, 15);

  // Ability catalog — same source as melee/magic, then filter to ranged.
  // 'boost' attackMode is kept so action boosts apply here too (they
  // contribute alacrity even though they don't fire a projectile).
  const spells           = useGameDataStore(s => s.spells);
  const classes          = useGameDataStore(s => s.classes);
  const enhancementTrees = useGameDataStore(s => s.enhancementTrees);
  const augments         = useGameDataStore(s => s.augments);
  const metamagics       = useGameDataStore(s => s.metamagics);
  const breakdowns       = engine;
  const slas = useMemo(() => breakdowns?.slas ?? [], [breakdowns]);
  const spCostReductions = useMemo(
    () => breakdowns
      ? aggregateSpellCostReductions(breakdowns, metamagics)
      : { perMetamagic: {}, percentReduction: 0 },
    [breakdowns, metamagics],
  );
  const allAbilities = useMemo(
    () => getMagicAbilities(
      build, spells, classes, slas, enhancementTrees, augments,
      breakdowns ?? undefined, metamagics, spCostReductions,
    ),
    [build, spells, classes, slas, enhancementTrees, augments, breakdowns, metamagics, spCostReductions],
  );
  const rangedAbilities = useMemo(
    () => allAbilities.filter(a => a.attackMode === 'ranged' || a.attackMode === 'boost'),
    [allAbilities],
  );

  // Rotation state — shares the dpsRotation field but uses its own steps.
  const [manageOpen, setManageOpen] = useState(false);
  const dpsRotation      = useBuildStore(s => s.build.dpsRotation);
  const activeAbilityIds = dpsRotation?.activeAbilityIds;
  const setDpsRotation   = useBuildStore(s => s.setDpsRotation);
  const setActiveAbilityIds = (next: string[]) => setDpsRotation({ activeAbilityIds: next });
  // Reuse the melee steps slot — ranged + melee rotations share the same
  // timeline state since only one is rendered at a time per build.
  const rangedSteps    = (dpsRotation?.meleeSteps ?? EMPTY_STEPS) as RotationStep[];
  const setRangedSteps = (next: RotationStep[]) => setDpsRotation({ meleeSteps: next });

  const activeRangedAbilities = useMemo(() => {
    if (!activeAbilityIds) return [];
    const byId = new Map(rangedAbilities.map(a => [a.id, a]));
    return activeAbilityIds.flatMap(id => { const a = byId.get(id); return a ? [a] : []; });
  }, [rangedAbilities, activeAbilityIds]);
  const dialogInitial = activeAbilityIds ?? activeRangedAbilities.map(a => a.id);

  // Weapon resolution — only main-hand. Ranged is always single-weapon
  // (bow / crossbow / thrown). The MH slot's `weapon` field must resolve
  // to a ranged category (see rangedCategoryFromName).
  const mainHandItem = useMemo(() => {
    const gs = build.gearSets.find(g => g.name === build.activeGearSet);
    return gs?.items.find(i => i.slot === 'MainHand') ?? null;
  }, [build.gearSets, build.activeGearSet]);

  const weaponInfo = useMemo(
    () => mainHandItem ? rangedWeaponInfoFromGearItem(mainHandItem) : null,
    [mainHandItem],
  );

  // Unique abilities currently in the rotation (steps), ordered by first
  // appearance — drives the damage-source breakdown chart.
  const rotationAbilities = useMemo(() => {
    const seen = new Set<string>();
    return rangedSteps
      .filter(s => { if (seen.has(s.abilityId)) return false; seen.add(s.abilityId); return true; })
      .map(s => allAbilities.find(a => a.id === s.abilityId))
      .filter((a): a is MagicAbility => a !== undefined);
  }, [rangedSteps, allAbilities]);

  // Time-averaged action-boost alacrity contribution from rotation entries.
  const avgBoostAlacrity = useMemo(() =>
    rotationAbilities.reduce((sum, a) => {
      if (!a.alacrityBuff) return sum;
      const uptime = Math.min(1, a.alacrityBuff.duration / Math.max(a.cooldown, a.castTime, 1));
      return sum + a.alacrityBuff.pct * uptime;
    }, 0),
    [rotationAbilities],
  );

  const buildStats = useMemo(() => {
    if (!engine || !weaponInfo) return null;
    return rangedBuildStatsFromEngine(build, engine, weaponInfo, effectiveAlacrity, avgBoostAlacrity);
  }, [engine, build, weaponInfo, effectiveAlacrity, avgBoostAlacrity]);

  const result = useMemo(
    () => weaponInfo && buildStats ? rangedDPS(weaponInfo, buildStats) : null,
    [weaponInfo, buildStats],
  );

  // Per-ability damage info — derived from ALL ranged abilities (so the
  // sort below doesn't create a circular dep on its own output).
  const damageByAbility = useMemo((): Map<string, AbilityDamageInfo> => {
    const m = new Map<string, AbilityDamageInfo>();
    if (!result || !buildStats) return m;
    for (const a of allAbilities.filter(x => x.attackMode === 'ranged')) {
      if (!a.weaponAttack) continue;
      const {
        mhHits, scalar,
        critRangeBonus = 0, critMultBonus = 0,
        dsBuffPct = 0, dsBuffDuration = 0,
      } = a.weaponAttack;
      // Reuse ds-buff slots for alacrity-buff parameters since ranged
      // abilities like Rapid Shot grant attack-speed (not extra projectiles)
      // — the field is generic in MagicAbility.weaponAttack.
      const dmg = rangedAbilityDamagePerActivation(
        mhHits, scalar, result, buildStats,
        critRangeBonus, critMultBonus, dsBuffPct, dsBuffDuration,
      );
      const cycleTime = Math.max(a.cooldown, a.castTime, 1e-3);
      m.set(a.id, {
        damage: { total: dmg, casterLevel: 0, byComponent: [] },
        cycleTime,
        dps: dmg / cycleTime,
      });
    }
    return m;
  }, [allAbilities, result, buildStats]);

  // Sort active abilities by DPC descending for the palette display.
  const sortedActiveRangedAbilities = useMemo(
    () => [...activeRangedAbilities].sort((a, b) =>
      (damageByAbility.get(b.id)?.damage.total ?? 0) -
      (damageByAbility.get(a.id)?.damage.total ?? 0)),
    [activeRangedAbilities, damageByAbility],
  );

  // Compare result for the same weapon against the comparison enhancement set.
  const compareResult = useMemo(() => {
    if (!compareSetName || !compareBreakdowns || compareSetName === build.activeEnhancementSet) return null;
    if (!weaponInfo) return null;
    const cs = rangedBuildStatsFromEngine(compareBuild, compareBreakdowns, weaponInfo, effectiveAlacrity);
    return rangedDPS(weaponInfo, cs);
  }, [compareSetName, compareBreakdowns, compareBuild, weaponInfo, effectiveAlacrity, build.activeEnhancementSet]);

  if (!engine) return null;

  // Empty-state for no ranged weapon equipped. Two cases: no MH item,
  // or MH item isn't a recognized ranged category (e.g. a great sword
  // sitting in MH while user picks Ranged in the dropdown).
  if (!weaponInfo || !result || !buildStats) {
    const itemIsMelee = mainHandItem && mainHandItem.weapon
      && rangedCategoryFromName(mainHandItem.weapon) === null;
    const hint = !mainHandItem
      ? 'No main-hand weapon equipped. Add a bow, crossbow, repeating crossbow, or thrown weapon in the Gear tab.'
      : itemIsMelee
        ? `Main hand "${mainHandItem.name}" isn't a ranged weapon. Switch to the Melee tab, or equip a ranged weapon.`
        : `Main hand item "${mainHandItem.name}" couldn't be resolved as a ranged weapon. Check the Gear tab — the item may be missing its weapon type or base damage dice.`;
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

  // Build "Base / Crit / To-Hit" string mirroring the melee panel.
  const enchantBuff = mainHandItem?.buffs.find(b => b.type === 'WeaponEnchantment');
  const enchant = enchantBuff?.value1 ?? 0;
  const flatBonus = weaponInfo.diceBonus + result.damageStatMod + enchant + result.flatDmgBonus;
  const baseStr = `${fmt(weaponInfo.wScalar, 2)}W`
    + `(${weaponInfo.diceNum}d${weaponInfo.diceSides}${weaponInfo.diceBonus ? `+${weaponInfo.diceBonus}` : ''})`
    + ` + ${flatBonus}`;
  const critRangeFlat = critRangeBonusForWeapon(engine, weaponInfo.weaponType);
  const rangeAfterIC  = buildStats.hasImprovedCritical ? weaponInfo.critThreatBase * 2 : weaponInfo.critThreatBase;
  const totalFaces    = rangeAfterIC + critRangeFlat;
  const multOnAll     = weaponInfo.critMultiplier + buildStats.critMultBonus;
  const multOn1920    = multOnAll + buildStats.critMult1920Bonus;
  const loBound       = 21 - totalFaces;
  const facesOther    = Math.max(0, totalFaces - 2);
  const critStr       = buildStats.critMult1920Bonus > 0
    ? facesOther > 0
      ? `(${loBound}–18)×${multOnAll}  (19–20)×${multOn1920}`
      : `(19–20)×${multOn1920}`
    : `(${loBound}–20)×${multOnAll}`;

  const categoryLabel = weaponInfo.category.replace(/-/g, ' ');

  return (
    <div className={styles.editor}>
      {/* Weapon stat panel(s). Single MH for normal ranged; MH+OH when
       *  Inquisitive's Dual Shooter stance flips the build into the
       *  "dual hand crossbows" mode. Both panels show the same weapon
       *  stats; the OH copy notes its dependence on the MH crossbow. */}
      {(() => {
        const renderPanel = (label: string, extra?: React.ReactNode) => (
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
              {label} ({categoryLabel})
            </span>
            <span className={styles.weaponStatPanelName}>
              {weaponInfo.name}
              {extra}
            </span>

            <div className={styles.weaponStatRow}>
              <span className={styles.weaponStatRowLabel}>Base</span>
              <span className={styles.weaponStatRowValue}>{baseStr}</span>
              <span className={styles.weaponStatRowMuted}>
                {`${result.damageStat}(+${result.damageStatMod}) +${enchant} enchant +${result.flatDmgBonus} flat`}
              </span>
            </div>

            <div className={styles.weaponStatRow}>
              <span className={styles.weaponStatRowLabel}>Crit Range</span>
              <span className={styles.weaponStatRowValue}>{critStr}</span>
              {result.seeker > 0 && (
                <span className={styles.weaponStatRowMuted}>Seeker +{result.seeker}</span>
              )}
            </div>

            <div className={styles.weaponStatRow}>
              <span className={styles.weaponStatRowLabel}>To-Hit</span>
              <span className={styles.weaponStatRowMuted}>TODO</span>
            </div>
          </div>
        );
        const showOH = result.dualShooter;
        return (
          <div className={styles.weaponStatPanels} style={showOH ? undefined : { gridTemplateColumns: '1fr' }}>
            {renderPanel('Main Hand')}
            {showOH && renderPanel('Off Hand',
              <span className={styles.weaponStatRowMuted}> (Dual Shooter — same crossbow)</span>,
            )}
          </div>
        );
      })()}

      <TargetRow targetCount={targetCount} setTargetCount={setTargetCount} prr={0} mrr={0} />

      <BuffsList build={build} metamagics={metamagics} engine={engine} attackMode="ranged" />

      <ActiveProcsList
        build={build}
        engine={engine}
        sneakAttackDice={engine.sneakAttackDice.total}
        breakdown={null}
      />

      <DebuffsSummary state={debuffState} build={build} onManage={onManageDebuffs} />

      <RotationPalette
        abilities={sortedActiveRangedAbilities}
        totalTrained={rangedAbilities.length}
        onAdd={(a) => {
          const byId = new Map(activeRangedAbilities.map(ab => [ab.id, ab]));
          if (rangedAuto) {
            setRangedSteps(fillToOneMinute(rangedSteps, a, byId, 0, simDuration));
          } else {
            const slot = findFirstAvailableSlot(rangedSteps, a, byId, 0);
            const next = [...rangedSteps];
            next.splice(slot, 0, newRotationStep(a.id));
            setRangedSteps(next);
          }
        }}
        onManage={() => setManageOpen(true)}
        onReorder={(from, to) => {
          const next = [...rangedSteps];
          const [moved] = next.splice(from, 1);
          if (moved !== undefined) { next.splice(to, 0, moved); setRangedSteps(next); }
        }}
        damageByAbility={damageByAbility}
      />

      <ManageActiveDialog
        open={manageOpen}
        abilities={allAbilities}
        active={dialogInitial}
        onClose={() => setManageOpen(false)}
        onApply={setActiveAbilityIds}
        defaultAttackMode="ranged"
      />

      <div className={styles.meleeControls}>
        <div className={styles.controls} style={{ marginBottom: 0 }}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Alacrity <span className={styles.fieldValue}>{effectiveAlacrity}%</span>
            </span>
            <input
              type="range" className={styles.slider}
              min={0} max={15} step={1}
              value={effectiveAlacrity}
              onChange={e => setAlacrity(Number(e.target.value))}
            />
            <span className={styles.sliderTicks}><span>0%</span><span>15%</span></span>
          </label>
        </div>
        {buildStats && result && (
          <div className={styles.meleeStatRow}>
            <span className={styles.meleeStatChip}
              title={`Damage scales from ${result.damageStat} (mod +${result.damageStatMod})`}>
              {result.damageStat} +{result.damageStatMod}
            </span>
            <span className={styles.meleeStatChip}>RP {fmt(buildStats.rangedPower)}</span>
            <span className={styles.meleeStatChip} title="% chance of an additional projectile per shot">
              Doubleshot {pct(buildStats.doubleshot)}
            </span>
            {result.dualShooter && (
              <span
                className={styles.meleeStatChip}
                title={
                  'Inquisitive Dual Shooter: each shot triggers an off-hand crossbow shot at this chance. '
                  + 'Scales with TWF feats (TWF 40% / ITWF 60% / GTWF 80%) plus any +Off-Hand-Attack bonuses.'
                }
              >
                Dual Shooter OH {pct(result.offHandChance)}
              </span>
            )}
            <span className={styles.meleeStatChip}
              title={`Crit: ${21 - result.critThreatFaces}-20 = ${pct(result.critChance * 100)}, ×${result.critMultOnAll}${result.critMult1920Bonus > 0 ? ` / ×${result.critMultOn1920} on 19-20` : ''}`}>
              Crit {pct(result.critChance * 100)}
            </span>
            {buildStats.seeker > 0 && (
              <span className={styles.meleeStatChip}>Seeker +{buildStats.seeker}</span>
            )}
          </div>
        )}
      </div>

      {/* Reuse the unified attack + ability timeline. For normal ranged
       *  there's no off-hand — pass ohAPM=0 and relabel the MH track as
       *  "Shots". For Inquisitive Dual Shooter, treat the MH crossbow as
       *  both hands: MH fires at full rate, OH fires at offHandChance%
       *  of the MH cadence. */}
      <MeleeCombinedTimeline
        mhAPM={result.apm}
        ohAPM={result.dualShooter ? result.ohAttacksPerMin : 0}
        mhBaseAPM={result.apmNoBoost}
        ohBaseAPM={result.dualShooter ? result.ohBaseAPM : undefined}
        mhLabel={result.dualShooter ? 'MH' : 'Shots'}
        ohLabel={result.dualShooter ? 'OH' : ''}
        playheadTime={simRunning || simTime > 0 ? simTime : undefined}
        windowSeconds={simDuration}
        steps={rangedSteps}
        abilityById={new Map(allAbilities.map(a => [a.id, a]))}
        auto={rangedAuto}
        onAutoChange={setRangedAuto}
        onReorderStep={(from, to) => {
          const next = [...rangedSteps];
          const [moved] = next.splice(from, 1);
          if (moved !== undefined) { next.splice(to, 0, moved); setRangedSteps(next); }
        }}
        onRemoveStep={(key) => setRangedSteps(rangedSteps.filter(s => s.key !== key))}
        onClearSteps={() => setRangedSteps([])}
        damageByAbility={damageByAbility}
      />

      {/* Enhancement-set comparison */}
      {(build.enhancementSets?.length ?? 0) > 1 && (
        <div className={styles.compareRow}>
          <label className={styles.compareLabel}>
            Compare vs.
            <select
              className={styles.compareSelect}
              value={compareSetName ?? ''}
              onChange={e => setCompareSetName(e.target.value || null)}
            >
              <option value="">(none)</option>
              {(build.enhancementSets ?? [])
                .filter(s => s.name !== build.activeEnhancementSet)
                .map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </label>
          {compareSetName && compareResult && result && (() => {
            const activeDps  = result.totalAutoDPS;
            const compareDps = compareResult.totalAutoDPS;
            const delta      = activeDps > 0 ? (compareDps - activeDps) / activeDps * 100 : 0;
            const sign       = delta >= 0 ? '+' : '';
            const better     = delta > 0;
            return (
              <div className={styles.compareStats}>
                <span className={styles.compareCol}>
                  <span className={styles.compareColLabel}>{build.activeEnhancementSet}</span>
                  <span className={styles.compareColValue}>{Math.round(activeDps).toLocaleString()} DPS</span>
                </span>
                <span className={styles.compareCol}>
                  <span className={styles.compareColLabel}>{compareSetName}</span>
                  <span className={styles.compareColValue}>{Math.round(compareDps).toLocaleString()} DPS</span>
                </span>
                <span className={better ? styles.compareDeltaUp : styles.compareDeltaDown}>
                  {sign}{delta.toFixed(1)}%
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {/* Damage source breakdown — single auto-attack track + rotation abilities. */}
      {(() => {
        const abilityDPS = rotationAbilities.reduce(
          (s, a) => s + (damageByAbility.get(a.id)?.dps ?? 0), 0,
        );
        const totalDPS = result.totalAutoDPS + abilityDPS;
        const autoSources: { label: string; dps: number; color: string }[] = result.dualShooter
          ? [
              { label: 'MH Auto-shot', dps: result.mhDPS, color: '#c9a227' },
              { label: 'OH Auto-shot', dps: result.ohDPS, color: '#a07820' },
            ]
          : [{ label: 'Auto-shot', dps: result.totalAutoDPS, color: '#c9a227' }];
        const sources: { label: string; dps: number; color: string }[] = [
          ...autoSources,
          ...rotationAbilities
            .map(a => ({ label: a.name, dps: damageByAbility.get(a.id)?.dps ?? 0, color: '#7ab87a' })),
        ].filter(s => s.dps > 0);

        if (totalDPS <= 0) return null;

        const rowTooltip = (label: string, dps: number) => simTime > 0
          ? `${label}: ${fmt(Math.round(dps))} DPS · ${fmt(Math.round(dps * simTime))} dmg at ${simTime.toFixed(1)}s`
          : `${label}: ${fmt(Math.round(dps))} DPS`;

        return (
          <div className={styles.meleeDamageSource}>
            <div className={styles.meleeDamageSourceBar}>
              {sources.map(s => (
                <div key={s.label}
                  title={rowTooltip(s.label, s.dps)}
                  style={{ flex: s.dps / totalDPS, background: s.color, minWidth: 2 }} />
              ))}
            </div>
            <div className={styles.meleeDamageSourceList}>
              <div className={styles.meleeDamageSourceRow + ' ' + styles.meleeDamageSourceHeader}>
                <span />
                <span className={styles.meleeDamageSourceLabel} />
                <span className={styles.meleeDamageSourceDPS}>DPS</span>
                <span className={styles.meleeDamageSourcePct}>%</span>
              </div>
              {sources.map(s => (
                <div key={s.label} className={styles.meleeDamageSourceRow}
                  title={rowTooltip(s.label, s.dps)}>
                  <span className={styles.meleeDamageSourceDot} style={{ background: s.color }} />
                  <span className={styles.meleeDamageSourceLabel}>{s.label}</span>
                  <span className={styles.meleeDamageSourceDPS}>{fmt(Math.round(s.dps))}</span>
                  <span className={styles.meleeDamageSourcePct}>{(s.dps / totalDPS * 100).toFixed(1)}%</span>
                </div>
              ))}
              <div className={styles.meleeDamageSourceRow + ' ' + styles.meleeDamageSourceTotal}
                title={simTime > 0 ? `Total: ${fmt(Math.round(totalDPS))} DPS · ${fmt(Math.round(totalDPS * simTime))} dmg at ${simTime.toFixed(1)}s` : undefined}>
                <span />
                <span className={styles.meleeDamageSourceLabel}>Total</span>
                <span className={styles.meleeDamageSourceDPS}>{fmt(Math.round(totalDPS))}</span>
                <span className={styles.meleeDamageSourcePct}>DPS</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Simulate / restart buttons. */}
      <div className={styles.simulateRow}>
        <button
          type="button"
          className={styles.simulateBtn}
          onClick={onSimulateClick}
          disabled={!result}
          title={result ? (simRunning ? 'Pause simulation' : `Run ${simDuration}s simulation`) : 'No weapon equipped'}
        >
          {simRunning ? '⏸ Pause' : '▶ Simulate'}
        </button>
        <button
          type="button"
          className={styles.simulateBtn}
          onClick={onRestartClick}
          disabled={!result}
          title="Restart simulation from t=0"
        >
          ↻ Restart
        </button>
        <SimDurationPicker value={simDuration} onChange={setSimDuration} />
        <span className={styles.simulateClock}>
          t = {simTime.toFixed(2)}s / {simDuration}s
        </span>
      </div>
    </div>
  );
}
