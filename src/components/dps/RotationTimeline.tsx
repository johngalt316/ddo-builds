// Phase 6.2 — Editable horizontal timeline for the magic rotation.
//
// Each block represents one cast; horizontal width = cast time at a fixed
// pixel-per-second scale, so the time ruler stays honest. Cooldown
// enforcement runs through `resolveTimeline`: a cast can't begin until
// (a) the previous cast finishes AND (b) the same ability's cooldown has
// elapsed since its last cast — gaps show up visually when CD pushes a
// cast later than the previous cast's end.
//
// Drag a block to reorder (when Auto is off); × overlay or right-click
// removes. "Auto" checkbox locks reordering — used when the optimizer
// (6.6) is the authority on rotation order.

import { useEffect, useRef, useState } from 'react';
import type { MagicAbility } from '@/engine/dps/abilities';
import type { RotationStep } from '@/engine/dps/rotation';
import { resolveTimeline } from '@/engine/dps/timing';
import type { ActiveBuff } from '@/engine/dps/buffs';
import type { AbilityDamageInfo } from '@/engine/dps/calculator';
import styles from './RotationTimeline.module.css';

/** Pixel width per second of cast time. Larger → roomier blocks. */
const PX_PER_SECOND = 70;
/** Smallest block width (avoids unreadable instant-cast spells). */
const MIN_BLOCK_PX = 64;

interface Props {
  steps: RotationStep[];
  abilityById: Map<string, MagicAbility>;
  /** Build's spell-cooldown reduction (e.g. 20 → -20%). */
  cooldownReductionPct: number;
  auto: boolean;
  onAutoChange: (next: boolean) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  /** When >= 0 a vertical playhead is drawn at this time (seconds).
   *  Drives the simulation animation visual. */
  playheadTime?: number;
  /** Transient buffs active during the rotation cycle. One band rendered
   *  per buff under the cast blocks, with windows clipped to [0, cycle). */
  activeBuffs?: ActiveBuff[];
  /** Per-ability damage info — used to surface DPC + DPS + per-component
   *  breakdown in each cast block's tooltip. */
  damageByAbility?: Map<string, AbilityDamageInfo>;
}

const fmt = (n: number) =>
  n >= 10
    ? Math.round(n).toLocaleString()
    : n.toFixed(1);

export function RotationTimeline({
  steps, abilityById, cooldownReductionPct,
  auto, onAutoChange, onReorder, onRemove, onClear,
  playheadTime, activeBuffs, damageByAbility,
}: Props) {
  const dragFrom = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevPlayheadTime = useRef<number>(-1);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const { steps: resolved, skipped, totalSeconds } = resolveTimeline(
    steps, abilityById, cooldownReductionPct,
  );
  const totalPx = totalSeconds * PX_PER_SECOND;

  // Auto-scroll: keep the playhead at the 80% mark of the visible
  // viewport as the simulation advances. Mirrors RotationChart's
  // behavior so the two views scroll together. When the playhead
  // jumps backwards (sim restart) we reset scrollLeft to 0 so the
  // chart re-centers on t=0.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (playheadTime === undefined || playheadTime < 0) {
      prevPlayheadTime.current = -1;
      return;
    }
    if (playheadTime + 1e-3 < prevPlayheadTime.current) {
      el.scrollLeft = 0;
    }
    prevPlayheadTime.current = playheadTime;
    const playheadX = Math.min(playheadTime, totalSeconds) * PX_PER_SECOND;
    const target    = playheadX - el.clientWidth * 0.8;
    if (target > el.scrollLeft) el.scrollLeft = target;
  }, [playheadTime, totalSeconds]);

  // Map every input step to either a resolved entry or a placeholder for
  // unknown abilities (dropped from the timing walk so they don't affect
  // global progression). We render in original order so drag indices line
  // up with the underlying `steps` array.
  const resolvedByKey = new Map(resolved.map(r => [r.step.key, r]));
  const skippedByKey  = new Map(skipped.map(s  => [s.step.key, s]));

  // Per-ability casts/min in this rotation: occurrences in one cycle ×
  // (60 / cycleSeconds). Mirrors `rotationDPS`'s castsPerMinute formula
  // so the tooltip number matches what feeds the DPS engine.
  const cyclesPerMinute = totalSeconds > 0 ? 60 / totalSeconds : 0;
  const castsPerCycleByAbility = new Map<string, number>();
  for (const r of resolved) {
    castsPerCycleByAbility.set(
      r.ability.id,
      (castsPerCycleByAbility.get(r.ability.id) ?? 0) + 1,
    );
  }

  // Ruler ticks every 1s for short rotations, 2s up to 30s, 5s past that.
  const tickStep = totalSeconds <= 8 ? 1 : totalSeconds <= 30 ? 2 : 5;
  const tickCount = Math.max(1, Math.ceil(totalSeconds / tickStep));
  const ticks: { sec: number; px: number }[] = [];
  for (let i = 0; i <= tickCount; i++) {
    const sec = i * tickStep;
    ticks.push({ sec, px: sec * PX_PER_SECOND });
  }

  function onDragStart(e: React.DragEvent<HTMLDivElement>, idx: number) {
    if (auto) { e.preventDefault(); return; }
    dragFrom.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }
  function onDragOver(e: React.DragEvent<HTMLDivElement>, idx: number) {
    if (auto) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== idx) setDragOver(idx);
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>, idx: number) {
    if (auto) return;
    e.preventDefault();
    const from = dragFrom.current;
    dragFrom.current = null;
    setDragOver(null);
    if (from === null || from === idx) return;
    onReorder(from, idx);
  }
  function onDragEnd() {
    dragFrom.current = null;
    setDragOver(null);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.label}>
          Rotation · {steps.length} step{steps.length === 1 ? '' : 's'}
          {totalSeconds > 0 && (
            <span className={styles.totalTime}> · {totalSeconds.toFixed(1)}s</span>
          )}
          {cooldownReductionPct > 0 && (
            <span className={styles.cdNote}> · CD −{cooldownReductionPct.toFixed(0)}%</span>
          )}
        </span>
        <label className={styles.autoToggle} title="When on, the rotation order is managed by the optimizer (drag/reorder disabled).">
          <input
            type="checkbox"
            checked={auto}
            onChange={e => onAutoChange(e.target.checked)}
          />
          <span>Auto</span>
        </label>
        <button
          type="button"
          className={styles.clearBtn}
          onClick={onClear}
          disabled={auto || steps.length === 0}
        >Clear</button>
      </div>

      {steps.length === 0 ? (
        <div className={styles.empty}>
          Empty rotation. Click an ability from the palette above to add it here.
        </div>
      ) : (
        <div className={styles.scroll} ref={scrollRef}>
          <div className={styles.track} style={{ minWidth: `${totalPx}px` }}>
            {/* Time ruler */}
            <div className={styles.ruler} aria-hidden="true">
              {ticks.map(t => (
                <div key={t.sec} className={styles.tick} style={{ left: `${t.px}px` }}>
                  <span className={styles.tickMark} />
                  <span className={styles.tickLabel}>{t.sec}s</span>
                </div>
              ))}
            </div>

            {/* Simulation playhead — only shown when a sim is running */}
            {playheadTime !== undefined && playheadTime >= 0 && (
              <div
                className={styles.playhead}
                style={{ left: `${Math.min(playheadTime, totalSeconds) * PX_PER_SECOND}px` }}
                aria-hidden="true"
              />
            )}

            {/* Cast blocks */}
            <div className={styles.blocks} role="list" aria-label="Rotation timeline">
              {steps.map((step, i) => {
                const r = resolvedByKey.get(step.key);
                if (!r) {
                  const sk = skippedByKey.get(step.key);
                  if (sk) {
                    // Charge-depleted cast — out of charges, no time spent.
                    // Render an inline placeholder at the end of the track.
                    return (
                      <div
                        key={step.key}
                        className={styles.blockSkipped}
                        style={{
                          left: `${totalPx + (i * 4)}px`,   // staggered after track end
                          width: `${MIN_BLOCK_PX}px`,
                        }}
                        title={`${sk.ability.displayName} — out of charges (${sk.ability.charges} per rest)\nThis cast won't fire in the rotation cycle.`}
                      >
                        <span className={styles.blockName}>{sk.ability.displayName}</span>
                        <span className={styles.skippedTag}>0×</span>
                      </div>
                    );
                  }
                  // Ability missing from catalog — render an absolute-
                  // positioned placeholder at the current cursor end.
                  return (
                    <div
                      key={step.key}
                      className={styles.blockUnknown}
                      style={{ left: 0, width: `${MIN_BLOCK_PX}px` }}
                      title="Ability no longer available"
                    >?</div>
                  );
                }
                const left = r.startTime * PX_PER_SECOND;
                const width = Math.max(MIN_BLOCK_PX, r.ability.castTime * PX_PER_SECOND);
                return (
                  <div
                    key={step.key}
                    role="listitem"
                    draggable={!auto}
                    onDragStart={e => onDragStart(e, i)}
                    onDragOver={e => onDragOver(e, i)}
                    onDrop={e => onDrop(e, i)}
                    onDragEnd={onDragEnd}
                    className={[
                      styles.block,
                      dragOver === i ? styles.blockDragOver : '',
                      auto ? styles.blockLocked : '',
                      r.hasGap ? styles.blockAfterGap : '',
                    ].filter(Boolean).join(' ')}
                    style={{ width: `${width}px`, left: `${left}px` }}
                    title={(() => {
                      const occurrences = castsPerCycleByAbility.get(r.ability.id) ?? 0;
                      const cpm         = occurrences * cyclesPerMinute;
                      const lines: string[] = [
                        `#${i + 1} · ${r.ability.displayName}`,
                        `${r.ability.cost} SP · ${r.ability.castTime}s cast`,
                        r.effectiveCooldown > 0
                          ? `Cooldown ${r.effectiveCooldown.toFixed(1)}s${r.effectiveCooldown !== r.ability.cooldown ? ` (base ${r.ability.cooldown}s)` : ''}`
                          : 'No cooldown',
                        `Cast at t=${r.startTime.toFixed(1)}s · ready again at t=${r.cdReadyAt.toFixed(1)}s`,
                        cpm > 0
                          ? `~${cpm.toFixed(1)} casts/min in this rotation${occurrences > 1 ? ` (${occurrences}× per ${totalSeconds.toFixed(1)}s cycle)` : ''}`
                          : '',
                        r.ability.charges > 0
                          ? `${r.chargesRemaining} of ${r.ability.charges} charges left after this cast`
                          : '',
                        r.hasGap ? '⏳ Waiting on cooldown' : '',
                      ];
                      const info = damageByAbility?.get(r.ability.id);
                      const dmg  = info?.damage;
                      if (info && dmg && dmg.total > 0) {
                        lines.push(
                          '',
                          `DPC (CL ${dmg.casterLevel}): ~${fmt(dmg.total)}`,
                          `DPS (spammed alone, ${info.cycleTime.toFixed(1)}s cycle): ~${fmt(info.dps)}`,
                        );
                        for (const c of dmg.byComponent) {
                          if (c.damagePerTrigger > 0) {
                            const compDps = c.damagePerTrigger / info.cycleTime;
                            lines.push(`  • ${c.component.label}: ${fmt(c.damagePerTrigger)} dpc · ${fmt(compDps)} dps`);
                          }
                        }
                      }
                      lines.push(auto ? 'Auto: order locked by optimizer' : 'Drag to reorder · click × to remove');
                      return lines.filter(Boolean).join('\n');
                    })()}
                  >
                    {r.ability.icon && (
                      <img
                        src={`/assets/images/SpellImages/${r.ability.icon}.png`}
                        alt=""
                        className={styles.blockIcon}
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <span className={styles.blockName}>{r.ability.displayName}</span>
                    {r.hasGap && (
                      <span className={styles.gapMarker} aria-hidden="true" title="Waiting on cooldown">⏳</span>
                    )}
                    {!auto && (
                      <button
                        type="button"
                        className={styles.blockRemove}
                        onClick={e => { e.stopPropagation(); onRemove(step.key); }}
                        aria-label={`Remove ${r.ability.displayName} from rotation`}
                        title={`Remove ${r.ability.displayName}`}
                      >×</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {activeBuffs && activeBuffs.length > 0 && (
            <div
              className={styles.buffLanes}
              style={{ minWidth: `${totalPx}px` }}
              aria-label="Active buffs"
            >
              {activeBuffs.map(ab => (
                <div key={ab.buff.id} className={styles.buffLane}>
                  <div className={styles.buffLabel} title={`${ab.buff.label} · ${ab.buff.duration}s duration`}>
                    {ab.buff.icon && (
                      <img
                        src={`/assets/images/SpellImages/${ab.buff.icon}.png`}
                        alt=""
                        className={styles.buffIcon}
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <span className={styles.buffName}>{ab.buff.label}</span>
                    <span className={styles.buffUptime}>{(ab.uptimeFraction * 100).toFixed(0)}%</span>
                  </div>
                  <div className={styles.buffTrack} style={{ width: `${totalPx}px` }}>
                    {ab.windows.flatMap(w => {
                      // Render the in-cycle window directly; if it extends
                      // past cycleSeconds, also draw the wrap-around piece
                      // at the start of the cycle for steady-state clarity.
                      const segs: { left: number; width: number; key: string }[] = [];
                      const a = Math.max(0, w.start);
                      const b = Math.min(totalSeconds, w.end);
                      if (b > a) {
                        segs.push({ left: a * PX_PER_SECOND, width: (b - a) * PX_PER_SECOND, key: `${w.start}-main` });
                      }
                      if (w.end > totalSeconds) {
                        const wrap = w.end - totalSeconds;
                        segs.push({ left: 0, width: wrap * PX_PER_SECOND, key: `${w.start}-wrap` });
                      }
                      return segs;
                    }).map(seg => (
                      <div
                        key={seg.key}
                        className={styles.buffWindow}
                        style={{ left: `${seg.left}px`, width: `${seg.width}px` }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
