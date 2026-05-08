// Unified melee timeline: auto-attack bars + ability activation blocks on
// a single shared time axis.
//
// The track shows, top-to-bottom:
//   • Time ruler (shared)
//   • Main-hand attack bars  (gold, same as MeleeTimeline)
//   • Off-hand attack bars   (dimmer, when ohAPM > 0)
//   • Ability lane           (blocks from resolveTimeline, tiled across window)
//
// The ability lane tiling: one full rotation cycle is rendered at full
// opacity with drag-to-reorder + × remove support.  Additional cycles
// that fit the window are rendered at reduced opacity for visual context
// only (no interactions).

import { useRef, useState, useEffect } from 'react';
import type { MagicAbility }      from '@/engine/dps/abilities';
import type { RotationStep }      from '@/engine/dps/rotation';
import { resolveTimeline }        from '@/engine/dps/timing';
import type { AbilityDamageInfo } from '@/engine/dps/calculator';
import styles from './MeleeCombinedTimeline.module.css';

const PX_PER_SECOND = 70;
const ATTACK_ICON   = 'https://images.ddowiki.com/Icon_Feat_Attack.png';

interface BoostWindow { start: number; end: number; factor: number; }

interface Props {
  /** Average APM (passive + time-weighted boost) — shown in the header. */
  mhAPM: number;
  ohAPM: number;
  /** Passive-only APM (no action-boost contribution) — used for attack
   *  generation so boost windows show denser bars. Falls back to mhAPM. */
  mhBaseAPM?: number;
  ohBaseAPM?: number;
  playheadTime?: number;
  /** Minimum window to show in seconds (defaults to 60). */
  windowSeconds?: number;

  steps?: RotationStep[];
  abilityById?: Map<string, MagicAbility>;
  auto?: boolean;
  onAutoChange?: (next: boolean) => void;
  onRemoveStep?: (key: string) => void;
  onReorderStep?: (from: number, to: number) => void;
  onClearSteps?: () => void;
  damageByAbility?: Map<string, AbilityDamageInfo>;
}

/** Generate attack times stepping at the rate active at each moment.
 *  During a boost window attacks arrive faster; outside them they slow back down. */
function buildAttacks(baseAPM: number, windowSec: number, boostWindows: BoostWindow[]): number[] {
  if (baseAPM <= 0) return [];
  const out: number[] = [];
  let t = 0;
  while (t < windowSec - 1e-6) {
    out.push(t);
    const factor = boostWindows.reduce(
      (max, w) => (t >= w.start && t < w.end ? Math.max(max, w.factor) : max), 1,
    );
    t += 60 / (baseAPM * factor);
  }
  return out;
}

const fmt = (n: number) => n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1);

export function MeleeCombinedTimeline({
  mhAPM, ohAPM, mhBaseAPM, ohBaseAPM, playheadTime, windowSeconds = 60,
  steps = [], abilityById = new Map(),
  auto = false, onAutoChange, onRemoveStep, onReorderStep, onClearSteps,
  damageByAbility,
}: Props) {
  const scrollRef  = useRef<HTMLDivElement>(null);
  const dragFrom   = useRef<number | null>(null);
  const prevPH     = useRef(-1);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Resolve the ability rotation (1 cycle).
  const { steps: resolved, totalSeconds: cycleSeconds } =
    resolveTimeline(steps, abilityById, 0);

  // Window size: at least `windowSeconds` (matches the sim duration), and
  // large enough to show the full ability cycle if it extends beyond that.
  const windowSec = Math.max(windowSeconds, cycleSeconds > 0 ? cycleSeconds + 2 : 0);
  const trackPx     = windowSec * PX_PER_SECOND;

  // Auto-scroll playhead into view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || playheadTime === undefined) return;
    if (playheadTime + 1e-3 < prevPH.current) { el.scrollLeft = 0; }
    prevPH.current = playheadTime;
    const x      = playheadTime * PX_PER_SECOND;
    const target = x - el.clientWidth * 0.8;
    if (target > el.scrollLeft) el.scrollLeft = target;
  }, [playheadTime]);

  // How many times the cycle fits in the window (ghost copies + boost window tiling).
  const repetitions = cycleSeconds > 0
    ? Math.max(1, Math.ceil(windowSec / cycleSeconds))
    : 1;

  // Boost windows: time ranges where an alacrity boost is active, derived
  // from resolved rotation steps that carry alacrityBuff.
  const boostWindows: BoostWindow[] = [];
  for (let rep = 0; rep < repetitions; rep++) {
    for (const r of resolved) {
      if (!r.ability.alacrityBuff) continue;
      const start = rep * cycleSeconds + r.startTime;
      if (start >= windowSec) break;
      boostWindows.push({
        start,
        end: Math.min(start + r.ability.alacrityBuff.duration, windowSec),
        factor: 1 + r.ability.alacrityBuff.pct / 100,
      });
    }
  }

  const genMhAPM = mhBaseAPM ?? mhAPM;
  const genOhAPM = ohBaseAPM ?? ohAPM;
  const mhAttacks = buildAttacks(genMhAPM, windowSec, boostWindows);
  const ohAttacks = buildAttacks(genOhAPM, windowSec, boostWindows);

  // Ruler ticks.
  const tickStep = windowSec <= 8 ? 1 : windowSec <= 30 ? 2 : 5;
  const ticks: number[] = [];
  for (let s = 0; s <= windowSec + 1e-6; s += tickStep) ticks.push(Math.round(s * 10) / 10);

  // Drag handlers (operate on original steps[] indices).
  function handleDragStart(e: React.DragEvent, idx: number) {
    dragFrom.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }
  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragOver !== idx) setDragOver(idx);
  }
  function handleDrop(e: React.DragEvent, idx: number) {
    e.preventDefault();
    const from = dragFrom.current;
    dragFrom.current = null;
    setDragOver(null);
    if (from === null || from === idx) return;
    onReorderStep?.(from, idx);
  }
  function handleDragEnd() { dragFrom.current = null; setDragOver(null); }

  // Track height: ruler + MH + OH (if present) + ability lane.
  const OH_H        = ohAPM > 0 ? 28 : 0;
  const RULER_H     = 20;
  const MH_H        = 44;
  const ABILITY_H   = resolved.length > 0 ? 52 : 0;
  const DIVIDER_H   = resolved.length > 0 && (ohAPM > 0 || MH_H > 0) ? 1 : 0;
  const totalTrackH = RULER_H + MH_H + OH_H + DIVIDER_H + ABILITY_H;

  // Original-step index lookup keyed by resolved step key.
  const stepIndexByKey = new Map(steps.map((s, i) => [s.key, i]));

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.label}>
          Auto-attacks
          {mhAPM > 0 && <span className={styles.rate}> · {Math.round(mhAPM)}/min MH</span>}
          {ohAPM > 0 && <span className={styles.rateOH}> · {Math.round(ohAPM)}/min OH</span>}
          {resolved.length > 0 && cycleSeconds > 0 && (
            <span className={styles.cycleNote}> · {cycleSeconds.toFixed(1)}s cycle</span>
          )}
        </span>
        {onAutoChange && (
          <label className={styles.autoToggle}
            title="Auto-fill: click an ability to fill the rotation to the simulation window">
            <input type="checkbox" checked={auto}
              onChange={e => onAutoChange(e.target.checked)} />
            <span>Auto</span>
          </label>
        )}
        {onClearSteps && (
          <button type="button" className={styles.clearBtn}
            disabled={steps.length === 0} onClick={onClearSteps}>
            Clear
          </button>
        )}
      </div>

      {/* Scrollable track */}
      <div className={styles.scroll} ref={scrollRef}>
        <div className={styles.track} style={{ width: trackPx, height: totalTrackH }}>

          {/* Playhead */}
          {playheadTime !== undefined && (
            <div className={styles.playhead}
              style={{ left: playheadTime * PX_PER_SECOND }} />
          )}

          {/* Time ruler */}
          <div className={styles.ruler}>
            {ticks.map(s => (
              <div key={s} className={styles.tick}
                style={{ left: s * PX_PER_SECOND }}>
                <span className={styles.tickMark} />
                <span className={styles.tickLabel}>{s}s</span>
              </div>
            ))}
          </div>

          {/* MH auto-attack lane */}
          <div className={styles.laneMH} style={{ top: RULER_H, height: MH_H }}>
            {mhAttacks.map((t, i) => (
              <div key={i} className={styles.bar}
                style={{ left: t * PX_PER_SECOND }}
                title={`MH at t=${t.toFixed(2)}s`}>
                <img src={ATTACK_ICON} alt="" className={styles.icon} draggable={false} />
              </div>
            ))}
          </div>

          {/* OH auto-attack lane */}
          {ohAPM > 0 && (
            <div className={styles.laneOH}
              style={{ top: RULER_H + MH_H, height: OH_H }}>
              {ohAttacks.map((t, i) => (
                <div key={i} className={styles.barOH}
                  style={{ left: t * PX_PER_SECOND }}
                  title={`OH at t=${t.toFixed(2)}s`}>
                  <img src={ATTACK_ICON} alt="" className={styles.iconOH} draggable={false} />
                </div>
              ))}
            </div>
          )}

          {/* Divider before ability lane */}
          {ABILITY_H > 0 && (
            <div className={styles.laneDivider}
              style={{ top: RULER_H + MH_H + OH_H }} />
          )}

          {/* Ability activation lane — blocks tiled across the window */}
          {ABILITY_H > 0 && (
            <div className={styles.laneAbility}
              style={{ top: RULER_H + MH_H + OH_H + DIVIDER_H, height: ABILITY_H }}>
              {Array.from({ length: repetitions }, (_, rep) =>
                resolved.map(r => {
                  const offsetSec = rep * cycleSeconds + r.startTime;
                  const widthPx   = Math.max(40, r.ability.castTime * PX_PER_SECOND);
                  const origIdx   = stepIndexByKey.get(r.step.key) ?? -1;
                  const isGhost   = rep > 0;
                  const info      = damageByAbility?.get(r.ability.id);
                  const tooltip   = [
                    r.ability.displayName,
                    `t = ${offsetSec.toFixed(2)}s  (${r.ability.cooldown}s CD)`,
                    info ? `DPC ~${fmt(info.damage.total)}  DPS ~${fmt(info.dps)}` : '',
                    !isGhost ? 'Drag to reorder · × to remove' : '(repeat)',
                  ].filter(Boolean).join('\n');

                  return (
                    <div
                      key={`${rep}-${r.step.key}`}
                      className={[
                        styles.block,
                        isGhost ? styles.blockGhost : '',
                        !isGhost && dragOver === origIdx ? styles.blockDragOver : '',
                        !isGhost && r.hasGap ? styles.blockAfterGap : '',
                      ].filter(Boolean).join(' ')}
                      style={{ left: offsetSec * PX_PER_SECOND, width: widthPx }}
                      title={tooltip}
                      draggable={!isGhost && !auto}
                      onDragStart={!isGhost && !auto ? e => handleDragStart(e, origIdx) : undefined}
                      onDragOver={!isGhost && !auto ? e => handleDragOver(e, origIdx) : undefined}
                      onDrop={!isGhost && !auto ? e => handleDrop(e, origIdx) : undefined}
                      onDragEnd={!isGhost ? handleDragEnd : undefined}
                    >
                      <img
                        src={`/assets/images/SpellImages/${r.ability.icon}.png`}
                        alt=""
                        className={styles.blockIcon}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        draggable={false}
                      />
                      <span className={styles.blockName}>{r.ability.name}</span>
                      {!isGhost && onRemoveStep && (
                        <button
                          type="button"
                          className={styles.blockRemove}
                          onClick={e => { e.stopPropagation(); onRemoveStep(r.step.key); }}
                          title="Remove from rotation"
                        >×</button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
