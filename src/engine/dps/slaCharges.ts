// Manual per-rest charge counts for SLAs whose granting effect doesn't
// encode the value. Many feat-granted SLAs (especially past-life feats)
// ship with `<Amount>0 0 0 0</Amount>` — the four-slot array is allocated
// but every value is unset, so the effect-time read of Amount[0] yields
// zero (which we treat as "unlimited"). For SLAs that should actually be
// charge-limited, add a row here.
//
// Each entry matches a sourced SLA by:
//   • a substring of the source label (e.g. "Past Life: Arcane Initiate")
//   • the spell name granted
//
// Values mean: per-rest charges. Charges reset on rest, which is outside
// the rotation simulation window — so for a 60s cycle the timeline
// enforces them as a hard cap.
//
// Tracked in `docs/DATA_PATCHES.md`.

export interface SlaChargePatch {
  /** Substring matched against `CollectedSLA.source` (case-sensitive). */
  sourceContains: string;
  /** Exact match against `CollectedSLA.name`. */
  spellName: string;
  /** Per-rest charges (must be > 0; use 0 / omit for unlimited). */
  charges: number;
}

export const SLA_CHARGE_PATCHES: readonly SlaChargePatch[] = [
  { sourceContains: 'Past Life: Arcane Initiate', spellName: 'Magic Missile', charges: 10 },
];

/**
 * Look up the manual charge patch for a sourced SLA. Returns the charge
 * count, or 0 (unlimited) when no entry matches.
 */
export function lookupSlaChargePatch(source: string, spellName: string): number {
  for (const p of SLA_CHARGE_PATCHES) {
    if (p.spellName === spellName && source.includes(p.sourceContains)) {
      return p.charges;
    }
  }
  return 0;
}
