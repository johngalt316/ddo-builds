// Melee rotation editor — weapon panels, palette, combined timeline,
// simulation, and damage source breakdown for melee rotations.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { useBreakdowns } from '@/hooks/useBreakdowns';
import { getMagicAbilities, type MagicAbility } from '@/engine/dps/abilities';
import type { RotationStep } from '@/engine/dps/rotation';
import {
  fillToOneMinute, findFirstAvailableSlot,
} from '@/engine/dps/timing';
import { newRotationStep } from '@/engine/dps/rotation';
import type { AbilityDamageInfo } from '@/engine/dps/calculator';
import { aggregateSpellCostReductions } from '@/engine/dps/spellCost';
import { aggregateDebuffs } from '@/engine/dps/debuffs';
import { physicalDamageMultiplier } from '@/engine/dps/difficulty';
import {
  weaponInfoFromGearItem, buildStatsFromEngine, meleeDPS,
  meleeAbilityDamagePerActivation, critRangeBonusForWeapon,
  isShieldType, shieldBashDPS,
  type MeleeWeaponInfo, type ShieldBashResult, type TWFStyle,
} from '@/engine/dps/meleeCalc';
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

type MeleeEditorProps = SharedEditorProps;

export function MeleeEditor({
  difficulty, targetCount, setTargetCount,
  debuffState, onManageDebuffs,
  compareSetName, setCompareSetName, compareBuild, compareBreakdowns,
  simDuration, setSimDuration,
}: MeleeEditorProps) {
  const build   = useBuildStore(s => s.build);
  const engine  = useBreakdowns();

  // Debuffs — state lives in parent; apply physical-damage multiplier here.
  const debuffs = useMemo(
    () => ({
      ...aggregateDebuffs(debuffState, undefined, build),
      damageDealtMultiplier: physicalDamageMultiplier(difficulty),
    }),
    [debuffState, difficulty, build],
  );
  void debuffs; // used by future on-hit proc evaluation

  // ── Auto-fill toggle for melee rotation ──────────────────────────
  const [meleeAuto, setMeleeAuto] = useState(true);

  // ── Simulation ─────────────────────────────────────────────────────
  // Duration comes from shared simDuration prop (configurable 5–600s).
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

  // ── Attack-speed alacrity slider ───────────────────────────────────
  const buildAlacrity = engine?.meleeSpeed.total ?? 0;
  const [alacrity, setAlacrity] = useState<number | null>(null);
  const effectiveAlacrity = alacrity ?? Math.min(buildAlacrity, 15);

  // ── TWF style override ─────────────────────────────────────────────
  const detectedTWF = useMemo((): TWFStyle => {
    if (!engine) return 'none';
    const ids = new Set([
      ...build.feats.map(f => f.featId),
      ...(build.specialFeats ?? []).map(f => f.featId),
    ]);
    if (ids.has('Greater Two Weapon Fighting'))   return 'gtwf';
    if (ids.has('Improved Two Weapon Fighting'))  return 'itwf';
    if (ids.has('Two Weapon Fighting'))           return 'twf';
    return 'none';
  }, [build.feats, build.specialFeats, engine]);
  const [twfOverride, setTwfOverride] = useState<TWFStyle | null>(null);

  // ── Rotation palette (shared ability catalog, melee-filtered) ──────
  const spells         = useGameDataStore(s => s.spells);
  const classes        = useGameDataStore(s => s.classes);
  const enhancementTrees = useGameDataStore(s => s.enhancementTrees);
  const augments       = useGameDataStore(s => s.augments);
  const metamagics     = useGameDataStore(s => s.metamagics);
  const breakdowns     = engine;   // alias — engine is already the EngineResult
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
  const meleeAbilities = useMemo(
    () => allAbilities.filter(a => a.attackMode === 'melee' || a.attackMode === 'boost'),
    [allAbilities],
  );

  const [manageOpen, setManageOpen] = useState(false);
  const dpsRotation      = useBuildStore(s => s.build.dpsRotation);
  const activeAbilityIds = dpsRotation?.activeAbilityIds;
  const setDpsRotation   = useBuildStore(s => s.setDpsRotation);
  const setActiveAbilityIds = (next: string[]) => setDpsRotation({ activeAbilityIds: next });
  const meleeSteps    = (dpsRotation?.meleeSteps ?? EMPTY_STEPS) as RotationStep[];
  const setMeleeSteps = (next: RotationStep[]) => setDpsRotation({ meleeSteps: next });

  const activeMeleeAbilities = useMemo(() => {
    if (!activeAbilityIds) return [];
    const byId = new Map(meleeAbilities.map(a => [a.id, a]));
    return activeAbilityIds.flatMap(id => { const a = byId.get(id); return a ? [a] : []; });
  }, [meleeAbilities, activeAbilityIds]);

  const dialogInitial = activeAbilityIds ?? activeMeleeAbilities.map(a => a.id);

  // ── Weapon + DPS result ────────────────────────────────────────────
  const mainHandItem = useMemo(() => {
    const gs = build.gearSets.find(g => g.name === build.activeGearSet);
    return gs?.items.find(i => i.slot === 'MainHand') ?? null;
  }, [build.gearSets, build.activeGearSet]);

  const offHandItem = useMemo(() => {
    const gs = build.gearSets.find(g => g.name === build.activeGearSet);
    return gs?.items.find(i => i.slot === 'OffHand') ?? null;
  }, [build.gearSets, build.activeGearSet]);

  const weaponInfo = useMemo(
    () => mainHandItem ? weaponInfoFromGearItem(mainHandItem) : null,
    [mainHandItem],
  );

  // For handwraps the off-hand uses the same weapon; for TWF with separate
  // weapons the off-hand item is distinct.  Non-weapon OH items (shields,
  // rune arms, orbs) won't parse to a MeleeWeaponInfo (no baseDice).
  const ohWeaponInfo = useMemo((): MeleeWeaponInfo | null => {
    if (!offHandItem) return null;                       // no OH item
    const parsed = weaponInfoFromGearItem(offHandItem);
    return parsed;                                       // null if not a weapon
  }, [offHandItem]);

  // Unique abilities actually placed in the rotation (meleeSteps), ordered by
  // first appearance. Drives the breakdown chart and boost-alacrity calculation
  // so both react to what's in the timeline, not just the palette active list.
  const rotationAbilities = useMemo(() => {
    const seen = new Set<string>();
    return meleeSteps
      .filter(s => { if (seen.has(s.abilityId)) return false; seen.add(s.abilityId); return true; })
      .map(s => allAbilities.find(a => a.id === s.abilityId))
      .filter((a): a is MagicAbility => a !== undefined);
  }, [meleeSteps, allAbilities]);

  // Time-averaged Action Boost alacrity — only from abilities PLACED IN THE
  // ROTATION (meleeSteps), not the palette. Palette-only boosts must not
  // inflate APM when they haven't been scheduled.
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
    const base = buildStatsFromEngine(build, engine, weaponInfo, effectiveAlacrity, avgBoostAlacrity);
    if (twfOverride !== null) {
      const ohBonus = twfOverride === 'gtwf' ? 80
                    : twfOverride === 'itwf' ? 60
                    : twfOverride === 'twf'  ? 40
                    : 0;
      return { ...base, twfStyle: twfOverride, offHandChance: Math.min(100, ohBonus) };
    }
    return base;
  }, [engine, build, weaponInfo, effectiveAlacrity, twfOverride, avgBoostAlacrity]);

  const result = useMemo(
    () => weaponInfo && buildStats ? meleeDPS(weaponInfo, buildStats) : null,
    [weaponInfo, buildStats],
  );

  // Shield bash contribution (only when OffHand is a shield type).
  const shieldBash = useMemo((): ShieldBashResult | null => {
    if (!ohWeaponInfo || !buildStats || !result || !engine) return null;
    if (!isShieldType(ohWeaponInfo.weaponType)) return null;
    const bashPct      = engine.shieldBashRate.total;
    // Crit range bonuses targeting 'All' apply to shields.
    const allCritBonus = engine.allBonuses
      .filter(b => b.effectType === 'Weapon_CriticalRange' && b.target === 'All')
      .reduce((s, b) => s + b.value, 0);
    return shieldBashDPS(ohWeaponInfo, bashPct, buildStats, result, allCritBonus);
  }, [ohWeaponInfo, buildStats, result, engine]);

  // Per-ability damage info — computed from ALL melee abilities (not the
  // sorted subset) to avoid a circular dependency with the sort below.
  const damageByAbility = useMemo((): Map<string, AbilityDamageInfo> => {
    const m = new Map<string, AbilityDamageInfo>();
    if (!result || !buildStats) return m;
    for (const a of allAbilities.filter(x => x.attackMode === 'melee')) {
      if (!a.weaponAttack) continue;
      const { mhHits, scalar, critRangeBonus = 0, critMultBonus = 0, dsBuffPct = 0, dsBuffDuration = 0 } = a.weaponAttack;
      const dmg = meleeAbilityDamagePerActivation(mhHits, scalar, result, buildStats, critRangeBonus, critMultBonus, dsBuffPct, dsBuffDuration);
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
  const sortedActiveMeleeAbilities = useMemo(
    () => [...activeMeleeAbilities].sort((a, b) =>
      (damageByAbility.get(b.id)?.damage.total ?? 0) -
      (damageByAbility.get(a.id)?.damage.total ?? 0)),
    [activeMeleeAbilities, damageByAbility],
  );

  // Compare result for the same weapon against a different enhancement set.
  const compareResult = useMemo(() => {
    if (!compareSetName || !compareBreakdowns || compareSetName === build.activeEnhancementSet) return null;
    if (!weaponInfo) return null;
    const cs = buildStatsFromEngine(compareBuild, compareBreakdowns, weaponInfo, effectiveAlacrity);
    return meleeDPS(weaponInfo, cs);
  }, [compareSetName, compareBreakdowns, compareBuild, weaponInfo, effectiveAlacrity, build.activeEnhancementSet]);

  if (!engine) return null;

  const pct = (n: number) => `${fmt(n, 1)}%`;

  return (
    <div className={styles.editor}>
      {/* Weapon stat panels — raw damage without MP/DS scaling */}
      {result && weaponInfo && buildStats && engine && (() => {
        // Determine which weapon info to show per hand.
        // Handwraps have no separate OH item — both hands use the same weapon.
        // TWF with separate weapons: OH item is distinct; falls back to MH
        // if the OH isn't a melee weapon (shield, rune arm, orb, etc.).
        const ohInfo: MeleeWeaponInfo | null = ohWeaponInfo ?? weaponInfo;
        const ohIsSameAsMH = !ohWeaponInfo || ohWeaponInfo.weaponType === weaponInfo.weaponType;
        const ohItem = ohWeaponInfo ? offHandItem : mainHandItem;

        const renderPanel = (
          label: string,
          wi: MeleeWeaponInfo,
          item: typeof mainHandItem,
          sameAsMH: boolean,
          bash?: ShieldBashResult,
        ) => {
          const isShield = isShieldType(wi.weaponType);

          // Recompute crit stats for this specific weapon type.
          // Shields use their own intrinsic crit range (no TWF-style crit bonuses).
          const critRangeBonus = isShield
            ? 0   // shield-specific bonuses TBD; only use shield's own range
            : critRangeBonusForWeapon(engine, wi.weaponType);
          const hasIC          = buildStats.hasImprovedCritical;
          const rangeAfterIC   = hasIC ? wi.critThreatBase * 2 : wi.critThreatBase;
          const totalFaces     = isShield
            ? bash?.shieldCritFaces ?? rangeAfterIC   // already includes 'All' bonuses
            : rangeAfterIC + critRangeBonus;
          const multOnAll      = wi.critMultiplier + buildStats.critMultBonus;
          const multOn1920     = multOnAll + buildStats.critMult1920Bonus;
          const loBound        = 21 - totalFaces;
          const facesOther     = Math.max(0, totalFaces - 2);
          const critStr        = buildStats.critMult1920Bonus > 0
            ? facesOther > 0
              ? `(${loBound}–18)×${multOnAll}  (19–20)×${multOn1920}`
              : `(19–20)×${multOn1920}`
            : `(${loBound}–20)×${multOnAll}`;

          const enchantBuff = item?.buffs.find(b => b.type === 'WeaponEnchantment');
          const enchant     = enchantBuff?.value1 ?? 0;
          const flatBonus   = wi.diceBonus + result.damageStatMod + enchant + result.flatDmgBonus;
          const baseStr     = `${fmt(wi.wScalar, 2)}W`
            + `(${wi.diceNum}d${wi.diceSides}${wi.diceBonus ? `+${wi.diceBonus}` : ''})`
            + ` + ${flatBonus}`;

          return (
            <div className={styles.weaponStatPanel}>
              <span className={styles.weaponStatPanelHeader}>
                <img
                  src={`/assets/images/ItemImages/${item?.icon}.png`}
                  alt=""
                  style={{ width: 16, height: 16, objectFit: 'contain', marginRight: 4, verticalAlign: 'middle', flexShrink: 0 }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                {label}
              </span>
              <span className={styles.weaponStatPanelName}>
                {item?.name ?? '—'}
                {sameAsMH && !isShield && (
                  <span className={styles.weaponStatRowMuted}> (same as MH)</span>
                )}
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

              {isShield && bash ? (
                <div className={styles.weaponStatRow}>
                  <span className={styles.weaponStatRowLabel}>Bash Rate</span>
                  <span className={styles.weaponStatRowValue}>
                    {fmt(bash.bashesPerMin, 1)}/min
                    {bash.rawBashesPerMin > 60 && (
                      <span className={styles.weaponStatRowMuted}> (capped from {fmt(bash.rawBashesPerMin, 0)})</span>
                    )}
                  </span>
                  <span className={styles.weaponStatRowMuted}>
                    {fmt(engine.shieldBashRate.total)}% bash chance · {fmt(Math.round(bash.bashDPS))} DPS
                  </span>
                </div>
              ) : (
                <div className={styles.weaponStatRow}>
                  <span className={styles.weaponStatRowLabel}>To-Hit</span>
                  <span className={styles.weaponStatRowMuted}>TODO</span>
                </div>
              )}
            </div>
          );
        };

        const isHandwraps = weaponInfo.category === 'handwraps';
        const showOH = isHandwraps || ohWeaponInfo !== null;

        return (
          <div
            className={styles.weaponStatPanels}
            style={showOH ? undefined : { gridTemplateColumns: '1fr' }}
          >
            {renderPanel('Main Hand', weaponInfo, mainHandItem, false)}
            {showOH && renderPanel('Off Hand', ohInfo, ohItem, ohIsSameAsMH, shieldBash ?? undefined)}
          </div>
        );
      })()}

      {/* Target + enemy info — identical to magic pane */}
      <TargetRow
        targetCount={targetCount}
        setTargetCount={setTargetCount}
        prr={0}
        mrr={0}
      />

      {/* Active buffs: metamagics + combat stances with DPS contributions */}
      <BuffsList build={build} metamagics={metamagics} engine={engine} attackMode="melee" />

      {/* Active procs (on-hit sources; empty until melee proc catalog lands) */}
      <ActiveProcsList
        build={build}
        engine={engine}
        sneakAttackDice={engine.sneakAttackDice.total}
        breakdown={null}
      />

      {/* Debuffs */}
      <DebuffsSummary state={debuffState} build={build} onManage={onManageDebuffs} />

      {/* Rotation palette — melee abilities (ki strikes, enhancements) */}
      <RotationPalette
        abilities={sortedActiveMeleeAbilities}
        totalTrained={meleeAbilities.length}
        onAdd={(a) => {
          const byId = new Map(activeMeleeAbilities.map(ab => [ab.id, ab]));
          if (meleeAuto) {
            setMeleeSteps(fillToOneMinute(meleeSteps, a, byId, 0, simDuration));
          } else {
            const slot = findFirstAvailableSlot(meleeSteps, a, byId, 0);
            const next = [...meleeSteps];
            next.splice(slot, 0, newRotationStep(a.id));
            setMeleeSteps(next);
          }
        }}
        onManage={() => setManageOpen(true)}
        onReorder={(from, to) => {
          const next = [...meleeSteps];
          const [moved] = next.splice(from, 1);
          if (moved !== undefined) { next.splice(to, 0, moved); setMeleeSteps(next); }
        }}
        damageByAbility={damageByAbility}
      />
      {/* Combined timeline rendered below — no separate RotationTimeline needed */}
      <ManageActiveDialog
        open={manageOpen}
        abilities={allAbilities}
        active={dialogInitial}
        onClose={() => setManageOpen(false)}
        onApply={setActiveAbilityIds}
        defaultAttackMode="melee"
      />

      {/* Controls */}
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
          <label className={styles.field} style={{ minWidth: '7rem' }}>
            <span className={styles.fieldLabel}>Weapon Style</span>
            <select
              className={styles.select}
              value={twfOverride ?? detectedTWF}
              onChange={e => {
                const v = e.target.value as TWFStyle;
                setTwfOverride(v === detectedTWF ? null : v);
              }}
            >
              <option value="none">None</option>
              <option value="twf">TWF</option>
              <option value="itwf">ITWF</option>
              <option value="gtwf">GTWF</option>
            </select>
          </label>
        </div>
        {buildStats && result && (
          <div className={styles.meleeStatRow}>
            <span className={styles.meleeStatChip}
              title={`Damage scales from ${result.damageStat} (mod +${result.damageStatMod})`}>
              {result.damageStat} +{result.damageStatMod}
            </span>
            <span className={styles.meleeStatChip}>MP {fmt(buildStats.meleePower)}</span>
            <span className={styles.meleeStatChip} title="Main-hand doublestrike">
              DS MH {pct(buildStats.doublestrike)}
            </span>
            <span
              className={styles.meleeStatChip}
              title={
                buildStats.isHandwraps     ? 'Handwraps: OH DS = MH DS (no penalty)'
                : buildStats.hasPerfectTWF ? 'Perfect TWF: OH DS = 65% of MH DS'
                : 'Standard TWF: OH DS = 50% of MH DS'
              }
            >
              DS OH {pct(result.doublestrikeOH)}
            </span>
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

      {/* Unified auto-attack + ability activation timeline */}
      <MeleeCombinedTimeline
        mhAPM={result?.mhAttacksPerMin ?? 0}
        ohAPM={result?.ohAttacksPerMin ?? 0}
        mhBaseAPM={result?.mhBaseAPM}
        ohBaseAPM={result?.ohBaseAPM}
        playheadTime={simRunning || simTime > 0 ? simTime : undefined}
        windowSeconds={simDuration}
        steps={meleeSteps}
        abilityById={new Map(allAbilities.map(a => [a.id, a]))}
        auto={meleeAuto}
        onAutoChange={setMeleeAuto}
        onReorderStep={(from, to) => {
          const next = [...meleeSteps];
          const [moved] = next.splice(from, 1);
          if (moved !== undefined) { next.splice(to, 0, moved); setMeleeSteps(next); }
        }}
        onRemoveStep={(key) => setMeleeSteps(meleeSteps.filter(s => s.key !== key))}
        onClearSteps={() => setMeleeSteps([])}
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

      {/* Damage source breakdown — always shows DPS; tooltip shows cumulative damage when sim is running */}
      {result && (() => {
        const abilityDPS = rotationAbilities.reduce(
          (s, a) => s + (damageByAbility.get(a.id)?.dps ?? 0), 0,
        );
        const totalDPS = result.totalAutoDPS + (shieldBash?.bashDPS ?? 0) + abilityDPS;
        const sources: { label: string; dps: number; color: string }[] = [
          { label: 'MH Auto',    dps: result.mhDPS,         color: '#c9a227' },
          { label: 'OH Auto',    dps: result.ohDPS,         color: '#a07820' },
          ...(shieldBash ? [{ label: 'Shield Bash', dps: shieldBash.bashDPS, color: '#6a9fd8' }] : []),
          ...rotationAbilities
            .map(a => ({ label: a.name, dps: damageByAbility.get(a.id)?.dps ?? 0, color: '#7ab87a' }))
            .filter(s => s.dps > 0),
        ].filter(s => s.dps > 0);

        if (totalDPS <= 0) return null;

        // Tooltip for a row: cumulative damage accrued at simTime when sim has run,
        // or the raw DPS value otherwise.
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

      {/* Simulate / Restart buttons — at the bottom */}
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
