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

import { useRef, useState } from 'react';
import type { MagicAbility } from '@/engine/dps/abilities';
import type { RotationStep } from '@/engine/dps/rotation';
import { resolveTimeline } from '@/engine/dps/timing';
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
}

export function RotationTimeline({
  steps, abilityById, cooldownReductionPct,
  auto, onAutoChange, onReorder, onRemove, onClear,
}: Props) {
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const { steps: resolved, skipped, totalSeconds } = resolveTimeline(
    steps, abilityById, cooldownReductionPct,
  );
  const totalPx = totalSeconds * PX_PER_SECOND;

  // Map every input step to either a resolved entry or a placeholder for
  // unknown abilities (dropped from the timing walk so they don't affect
  // global progression). We render in original order so drag indices line
  // up with the underlying `steps` array.
  const resolvedByKey = new Map(resolved.map(r => [r.step.key, r]));
  const skippedByKey  = new Map(skipped.map(s  => [s.step.key, s]));

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
        <div className={styles.scroll}>
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
                    title={[
                      `#${i + 1} · ${r.ability.displayName}`,
                      `${r.ability.cost} SP · ${r.ability.castTime}s cast`,
                      r.effectiveCooldown > 0
                        ? `Cooldown ${r.effectiveCooldown.toFixed(1)}s${r.effectiveCooldown !== r.ability.cooldown ? ` (base ${r.ability.cooldown}s)` : ''}`
                        : 'No cooldown',
                      `Cast at t=${r.startTime.toFixed(1)}s · ready again at t=${r.cdReadyAt.toFixed(1)}s`,
                      r.ability.charges > 0
                        ? `${r.chargesRemaining} of ${r.ability.charges} charges left after this cast`
                        : '',
                      r.hasGap ? '⏳ Waiting on cooldown' : '',
                      auto ? 'Auto: order locked by optimizer' : 'Drag to reorder · click × to remove',
                    ].filter(Boolean).join('\n')}
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
        </div>
      )}
    </div>
  );
}
