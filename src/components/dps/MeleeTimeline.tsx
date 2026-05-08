// Melee auto-attack timeline.
//
// Renders a fixed-window horizontal strip showing when main-hand and
// off-hand attacks land based on the build's computed APM.  Attacks are
// drawn as thin vertical bars; the DDO "Attack" icon sits on top of each
// bar.  The window is long enough to show ~8–12 attacks at the current
// speed so the cadence is easy to read.

import { useRef, useEffect } from 'react';
import styles from './MeleeTimeline.module.css';

/** Pixels per second — matches RotationTimeline's scale. */
const PX_PER_SECOND = 70;

/** External DDO-wiki attack icon. */
const ATTACK_ICON_SRC = 'https://images.ddowiki.com/Icon_Feat_Attack.png';

interface Props {
  /** Main-hand attacks per minute (raw, before doublestrike). */
  mhAPM: number;
  /** Off-hand attacks per minute.  0 = no TWF. */
  ohAPM: number;
  /** Simulation playhead in seconds. When set the timeline scrolls to keep
   *  the playhead visible and draws a vertical position indicator. */
  playheadTime?: number;
}

/** Build the list of attack timestamps (seconds) within [0, windowSec). */
function buildAttacks(apm: number, windowSec: number): number[] {
  if (apm <= 0) return [];
  const interval = 60 / apm;
  const out: number[] = [];
  for (let t = 0; t < windowSec - 1e-6; t += interval) out.push(t);
  return out;
}

export function MeleeTimeline({ mhAPM, ohAPM, playheadTime }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to keep the playhead in view.
  useEffect(() => {
    if (playheadTime === undefined || !scrollRef.current) return;
    const x = playheadTime * PX_PER_SECOND;
    const el = scrollRef.current;
    const half = el.clientWidth / 2;
    el.scrollLeft = Math.max(0, x - half);
  }, [playheadTime]);
  if (mhAPM <= 0) return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.label}>Auto-attacks</span>
        <span className={styles.rate} style={{ opacity: 0.4 }}>No weapon data</span>
      </div>
    </div>
  );

  // Show enough time to display 10–12 main-hand attacks, capped at 15s.
  const mhInterval  = 60 / mhAPM;
  const windowSec   = Math.min(15, Math.ceil(10 * mhInterval * 10) / 10);

  const mhAttacks = buildAttacks(mhAPM, windowSec);
  const ohAttacks = buildAttacks(ohAPM, windowSec);

  const trackPx  = windowSec * PX_PER_SECOND;

  // Ruler ticks every 1 s for short windows, 2 s for longer ones.
  const tickStep = windowSec <= 8 ? 1 : 2;
  const ticks: number[] = [];
  for (let s = 0; s <= windowSec; s += tickStep) ticks.push(s);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.label}>Auto-attacks</span>
        <span className={styles.rate}>{Math.round(mhAPM)}/min MH</span>
        {ohAPM > 0 && (
          <span className={styles.rateOH}>{Math.round(ohAPM)}/min OH</span>
        )}
      </div>

      <div className={styles.scroll} ref={scrollRef}>
        <div className={styles.track} style={{ width: `${trackPx}px` }}>

          {/* Simulation playhead */}
          {playheadTime !== undefined && (
            <div
              className={styles.playhead}
              style={{ left: `${playheadTime * PX_PER_SECOND}px` }}
              aria-hidden="true"
            />
          )}

          {/* Time ruler */}
          <div className={styles.ruler} aria-hidden="true">
            {ticks.map(s => (
              <div key={s} className={styles.tick} style={{ left: `${s * PX_PER_SECOND}px` }}>
                <span className={styles.tickMark} />
                <span className={styles.tickLabel}>{s}s</span>
              </div>
            ))}
          </div>

          {/* Attack lanes */}
          <div className={styles.lanes}>
            {/* Main-hand lane */}
            <div className={styles.lane}>
              {mhAttacks.map((t, i) => (
                <div
                  key={i}
                  className={styles.bar}
                  style={{ left: `${t * PX_PER_SECOND}px` }}
                  title={`Main-hand attack at t=${t.toFixed(2)}s`}
                >
                  <img
                    src={ATTACK_ICON_SRC}
                    alt="Attack"
                    className={styles.icon}
                    draggable={false}
                  />
                </div>
              ))}
            </div>

            {/* Off-hand lane */}
            {ohAPM > 0 && (
              <div className={styles.laneOH}>
                {ohAttacks.map((t, i) => (
                  <div
                    key={i}
                    className={styles.barOH}
                    style={{ left: `${t * PX_PER_SECOND}px` }}
                    title={`Off-hand attack at t=${t.toFixed(2)}s`}
                  >
                    <img
                      src={ATTACK_ICON_SRC}
                      alt="Attack"
                      className={styles.iconOH}
                      draggable={false}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
