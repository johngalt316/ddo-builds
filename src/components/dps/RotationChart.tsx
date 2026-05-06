// Phase 6.5 — Cumulative damage chart over one rotation cycle.
//
// X axis = rotation cycle time (matches the timeline's PX_PER_SECOND
// scale so the playhead lines up visually with the casts above).
// Y axis = cumulative damage; each cast pumps the line up by its
// per-cast contribution at the moment it fires.
//
// `currentTime` drives an animated reveal: the line draws only up to
// the playhead and the cumulative-damage readout follows along. As
// the playhead advances past the 80% mark of the visible scroll area
// we shift the viewport right to keep it on screen.

import { useEffect, useMemo, useRef } from 'react';
import styles from './RotationChart.module.css';

/** A single cast event — when it fires + how much it deals. */
export interface DamageEvent {
  /** Wall-clock seconds within the cycle when the cast starts. */
  time: number;
  /** Total damage from this cast, including all global procs. */
  damage: number;
  /** For the tooltip — what was cast. */
  spell: string;
}

interface Props {
  events: DamageEvent[];
  /** Cycle length in seconds — defines x-axis range. */
  cycleSeconds: number;
  /** Animation cursor in seconds. 0..cycleSeconds. */
  currentTime: number;
  /** Pixels per second, kept in sync with RotationTimeline. */
  pxPerSecond?: number;
}

const DEFAULT_PX_PER_SEC = 70;
const HEIGHT_PX          = 100;
const PADDING_TOP        = 8;
const PADDING_BOTTOM     = 18;   // leaves room for the time labels under the chart

const fmt = (n: number) => Math.round(n).toLocaleString();

export function RotationChart({
  events,
  cycleSeconds,
  currentTime,
  pxPerSecond = DEFAULT_PX_PER_SEC,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevCurrentTime = useRef<number>(-1);
  // Auto-scroll: as the playhead advances past 80% of the visible width,
  // shift the scroll right so the playhead stays at the 80% mark. Never
  // scrolls left during forward play — when the playhead is in the
  // natural left portion of the cycle we leave the user's manual
  // scroll position alone. When the playhead jumps backwards (sim
  // restart) we reset scrollLeft to 0 so t=0 is visible again.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (currentTime + 1e-3 < prevCurrentTime.current) {
      el.scrollLeft = 0;
    }
    prevCurrentTime.current = currentTime;
    const playheadX = Math.min(currentTime, cycleSeconds) * pxPerSecond;
    const target   = playheadX - el.clientWidth * 0.8;
    if (target > el.scrollLeft) el.scrollLeft = target;
  }, [currentTime, cycleSeconds, pxPerSecond]);

  const totalDamage = useMemo(
    () => events.reduce((s, e) => s + e.damage, 0),
    [events],
  );

  // Cumulative damage at currentTime.
  const cumulative = useMemo(() => {
    let s = 0;
    for (const e of events) {
      if (e.time <= currentTime + 1e-6) s += e.damage;
      else break;
    }
    return s;
  }, [events, currentTime]);

  if (cycleSeconds <= 0 || events.length === 0) {
    return (
      <div className={styles.empty}>
        Build a rotation above to see the per-cast damage chart.
      </div>
    );
  }

  const width        = Math.max(120, cycleSeconds * pxPerSecond);
  const innerHeight  = HEIGHT_PX - PADDING_TOP - PADDING_BOTTOM;
  const yMax         = Math.max(1, totalDamage);
  const playheadX    = Math.min(currentTime, cycleSeconds) * pxPerSecond;
  const totalPx      = cycleSeconds * pxPerSecond;

  // Build the step path: horizontal segments at the running total,
  // vertical jumps at each event's time. We prepend (0, 0) and append
  // (cycleSeconds, totalDamage) so the line spans the whole axis.
  const yFor = (dmg: number) =>
    PADDING_TOP + (1 - dmg / yMax) * innerHeight;
  const xFor = (sec: number) => sec * pxPerSecond;

  let runningTotal = 0;
  const pathPoints: string[] = [`M 0 ${yFor(0)}`];
  for (const ev of events) {
    pathPoints.push(`L ${xFor(ev.time).toFixed(2)} ${yFor(runningTotal).toFixed(2)}`);
    runningTotal += ev.damage;
    pathPoints.push(`L ${xFor(ev.time).toFixed(2)} ${yFor(runningTotal).toFixed(2)}`);
  }
  pathPoints.push(`L ${xFor(cycleSeconds).toFixed(2)} ${yFor(runningTotal).toFixed(2)}`);
  const fullPath = pathPoints.join(' ');

  // Filled area version of the same step path (closes the line back to
  // the x-axis). Used to give the cumulative line a soft fill.
  const areaPath = [
    fullPath,
    `L ${xFor(cycleSeconds).toFixed(2)} ${yFor(0)}`,
    `L 0 ${yFor(0)}`, 'Z',
  ].join(' ');

  // Time-axis ticks — one per second up to 8s, every 2s up to 30s, else 5s.
  const tickStep = cycleSeconds <= 8 ? 1 : cycleSeconds <= 30 ? 2 : 5;
  const tickCount = Math.max(1, Math.ceil(cycleSeconds / tickStep));
  const ticks: { sec: number; px: number }[] = [];
  for (let i = 0; i <= tickCount; i++) {
    const sec = i * tickStep;
    if (sec > cycleSeconds) break;
    ticks.push({ sec, px: xFor(sec) });
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.label}>
          Damage Chart · cumulative
        </span>
        <span className={styles.readout}>
          <strong>{fmt(cumulative)}</strong>
          <span className={styles.readoutMax}> / {fmt(totalDamage)}</span>
          <span className={styles.readoutAt}> @ t={Math.min(currentTime, cycleSeconds).toFixed(1)}s</span>
        </span>
      </div>

      <div className={styles.scroll} ref={scrollRef}>
        <svg
          className={styles.svg}
          width={width}
          height={HEIGHT_PX}
          role="img"
          aria-label="Cumulative damage over rotation cycle"
        >
          {/* Y-axis baseline */}
          <line
            x1={0} x2={width}
            y1={yFor(0)} y2={yFor(0)}
            className={styles.axisLine}
          />

          {/* Filled area up to the playhead — rest stays unfilled */}
          <clipPath id="rotation-chart-clip">
            <rect x={0} y={0} width={playheadX} height={HEIGHT_PX} />
          </clipPath>
          <path d={areaPath} className={styles.areaFill} clipPath="url(#rotation-chart-clip)" />

          {/* Full step line, dimmed behind the playhead, bright in front */}
          <path d={fullPath} className={styles.stepLineGhost} />
          <path d={fullPath} className={styles.stepLine} clipPath="url(#rotation-chart-clip)" />

          {/* Per-cast event dots — gold when t ≤ currentTime */}
          {events.map((e, i) => {
            const fired = e.time <= currentTime + 1e-6;
            return (
              <circle
                key={`${e.time}-${i}`}
                cx={xFor(e.time)}
                cy={yFor(events.slice(0, i + 1).reduce((s, x) => s + x.damage, 0))}
                r={3}
                className={fired ? styles.dotFired : styles.dotPending}
              >
                <title>{`${e.spell} · t=${e.time.toFixed(2)}s · +${fmt(e.damage)} dmg`}</title>
              </circle>
            );
          })}

          {/* Playhead */}
          <line
            x1={playheadX} x2={playheadX}
            y1={0} y2={HEIGHT_PX - PADDING_BOTTOM}
            className={styles.playhead}
          />

          {/* Time-axis ticks */}
          {ticks.map(t => (
            <g key={t.sec} transform={`translate(${t.px}, 0)`}>
              <line
                y1={HEIGHT_PX - PADDING_BOTTOM}
                y2={HEIGHT_PX - PADDING_BOTTOM + 3}
                className={styles.axisLine}
              />
              <text
                x={0}
                y={HEIGHT_PX - 4}
                className={styles.tickLabel}
                textAnchor={t.sec === 0 ? 'start' : (t.px >= totalPx - 6 ? 'end' : 'middle')}
              >{t.sec}s</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
