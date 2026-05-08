// Shared number-formatting helpers used across the DPS UI.
// Replaces a forest of per-file `fmt`, `fmt0`, `fmt1`, `fmt2`, `fmtPct`
// definitions that had drifted apart in precision and rounding rules.

/** Locale-grouped number with up to `decimals` fractional digits.
 *  Default 0 — the most common case (DPS, damage totals, attacks/min). */
export function fmt(n: number, decimals = 0): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

/** Compact rendering: round when ≥10, otherwise show 1 decimal.
 *  Used in tooltips and small badges where 8.5 and 1,234 must both fit. */
export function fmtAdaptive(n: number): string {
  return n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1);
}

/** Fraction (0–1) → "12.3%". Tiny values below 0.001 render as "<0.1%"
 *  so sub-tenth-percent damage sources don't appear as 0.0%. */
export function fmtPct(frac: number): string {
  return frac >= 0.001 ? `${(frac * 100).toFixed(1)}%` : '<0.1%';
}
