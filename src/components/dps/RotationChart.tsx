// Phase 6.5 — Instantaneous DPS chart over one rotation cycle.
//
// X axis = rotation cycle time (matches the timeline's PX_PER_SECOND
// scale so the playhead lines up visually with the casts above).
// Y axis = damage per second over a 4-second sliding window centered
// on each sample. Smooths short bursts, surfaces the rotation's peaks
// and troughs.
//
// Treats the rotation as cyclic for window math: events from the end
// of the cycle still contribute to samples near t=0 (steady-state).
//
// `currentTime` drives an animated reveal: the line draws only up to
// the playhead and the live-DPS readout follows along. As the
// playhead advances past the 80% mark of the visible scroll area we
// shift the viewport right to keep it on screen.

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
/** Sliding-window width for instantaneous DPS (seconds). Wide enough
 *  to smooth bursty single-cast spikes, narrow enough that rotation
 *  peaks (e.g. NL fires) are still visible. */
const WINDOW_SECONDS     = 4;
/** Sample density along the curve. 0.1s = 600 samples for a 60s
 *  cycle; smooth without inflating the SVG path. */
const SAMPLE_STEP        = 0.1;

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

  // Sample the sliding-window DPS curve. For each sample at time s,
  // sum the damage of every event whose start time falls in
  // [s - WINDOW, s] (with cycle wrap-around — events from the prior
  // cycle still contribute when the window straddles t=0). Divide
  // by the window width to convert to damage-per-second.
  const samples = useMemo<{ t: number; dps: number }[]>(() => {
    if (cycleSeconds <= 0 || events.length === 0) return [];
    // Pre-extend events with a copy shifted -cycleSeconds so prior-
    // cycle events naturally land inside the window without modular
    // arithmetic in the inner loop.
    const extended = [
      ...events.map(e => ({ time: e.time - cycleSeconds, damage: e.damage })),
      ...events,
    ].sort((a, b) => a.time - b.time);
    const out: { t: number; dps: number }[] = [];
    const stepCount = Math.ceil(cycleSeconds / SAMPLE_STEP);
    for (let i = 0; i <= stepCount; i++) {
      const t = Math.min(i * SAMPLE_STEP, cycleSeconds);
      const lo = t - WINDOW_SECONDS;
      let dmg = 0;
      // Could binary-search; linear is fine for typical event counts.
      for (const e of extended) {
        if (e.time < lo) continue;
        if (e.time > t) break;
        dmg += e.damage;
      }
      out.push({ t, dps: dmg / WINDOW_SECONDS });
    }
    return out;
  }, [events, cycleSeconds]);

  // Live DPS at currentTime — drives the readout next to the title.
  const liveDps = useMemo(() => {
    if (samples.length === 0) return 0;
    const idx = Math.min(samples.length - 1, Math.max(0, Math.round(currentTime / SAMPLE_STEP)));
    return samples[idx]?.dps ?? 0;
  }, [samples, currentTime]);

  if (cycleSeconds <= 0 || events.length === 0) {
    return (
      <div className={styles.empty}>
        Build a rotation above to see the instantaneous DPS chart.
      </div>
    );
  }

  const width        = Math.max(120, cycleSeconds * pxPerSecond);
  const innerHeight  = HEIGHT_PX - PADDING_TOP - PADDING_BOTTOM;
  const peakDps      = Math.max(1, ...samples.map(s => s.dps));
  const yMax         = peakDps;
  const avgDps       = totalDamage / cycleSeconds;
  const playheadX    = Math.min(currentTime, cycleSeconds) * pxPerSecond;
  const totalPx      = cycleSeconds * pxPerSecond;

  const yFor = (dps: number) =>
    PADDING_TOP + (1 - dps / yMax) * innerHeight;
  const xFor = (sec: number) => sec * pxPerSecond;

  // Smooth curve through the sliding-window samples.
  const pathPoints: string[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const cmd = i === 0 ? 'M' : 'L';
    pathPoints.push(`${cmd} ${xFor(s.t).toFixed(2)} ${yFor(s.dps).toFixed(2)}`);
  }
  const fullPath = pathPoints.join(' ');

  // Filled area: close the curve down to the baseline.
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
          DPS Chart · {WINDOW_SECONDS}s window
        </span>
        <span className={styles.readout}>
          <strong>{fmt(liveDps)}</strong>
          <span className={styles.readoutMax}> dps · avg {fmt(avgDps)} · peak {fmt(peakDps)}</span>
          <span className={styles.readoutAt}> @ t={Math.min(currentTime, cycleSeconds).toFixed(1)}s</span>
        </span>
      </div>

      <div className={styles.scroll} ref={scrollRef}>
        <svg
          className={styles.svg}
          width={width}
          height={HEIGHT_PX}
          role="img"
          aria-label={`Instantaneous DPS over rotation cycle (${WINDOW_SECONDS}-second sliding window)`}
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

          {/* Per-cast tick marks — small dots at the baseline so the
              user can see when each cast fires without claiming a
              y-value (DPS at that point is the windowed average,
              not the cast's own damage). Gold when fired, dim otherwise. */}
          {events.map((e, i) => {
            const fired = e.time <= currentTime + 1e-6;
            return (
              <circle
                key={`${e.time}-${i}`}
                cx={xFor(e.time)}
                cy={yFor(0)}
                r={2.5}
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
