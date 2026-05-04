import { useState } from 'react';
import { useBreakdowns } from '@/hooks/useBreakdowns';
import { StancesPicker } from './StancesPicker';
import type { BreakdownResult } from '@/engine/bonusStacking';
import styles from './BreakdownsTab.module.css';

interface RowProps {
  label: string;
  result: BreakdownResult;
}

function Row({ label, result }: RowProps) {
  const [open, setOpen] = useState(false);
  const applied = result.contributors.filter(c => c.applied);
  const dominated = result.contributors.filter(c => !c.applied);

  // Flat subtotal = sum of all *applied non-percent* bonuses. Percent
  // contributions display as "+X% (+Y)" where Y = round(flatSubtotal × X/100).
  // This matches stackBonuses' calc and lets users see both the % and the
  // actual flat HP delta a percent buff contributes.
  const flatSubtotal = applied
    .filter(c => !c.isPercent)
    .reduce((s, c) => s + c.value, 0);
  const fmtValue = (c: { value: number; isPercent?: boolean }): string => {
    if (c.isPercent) {
      const flat = Math.round(flatSubtotal * c.value / 100);
      const sign = c.value >= 0 ? '+' : '';
      const flatSign = flat >= 0 ? '+' : '';
      return `${sign}${c.value}% (${flatSign}${flat})`;
    }
    return c.value > 0 ? `+${c.value}` : `${c.value}`;
  };

  return (
    <div className={styles.row}>
      <button
        className={styles.rowHeader}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={open ? styles.chevronOpen : styles.chevron}>▸</span>
        <span className={styles.label}>{label}</span>
        <span className={styles.total}>{result.total}</span>
        <span className={styles.count}>
          {applied.length} applied{dominated.length ? ` · ${dominated.length} dominated` : ''}
        </span>
      </button>
      {open && (
        <div className={styles.body}>
          {applied.length === 0 && dominated.length === 0 && (
            <div className={styles.emptyContrib}>No contributors yet (effect sources still being implemented).</div>
          )}
          {applied.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Type</th>
                  <th>Target</th>
                  <th className={styles.numCol}>Value</th>
                </tr>
              </thead>
              <tbody>
                {applied.map((c, i) => (
                  <tr key={`a-${i}`}>
                    <td>{c.source}</td>
                    <td>{c.bonusType || <span className={styles.muted}>untyped</span>}</td>
                    <td>{c.target ?? ''}</td>
                    <td className={styles.numCol}>{fmtValue(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {dominated.length > 0 && (
            <details className={styles.dominated}>
              <summary>{dominated.length} dominated bonus{dominated.length === 1 ? '' : 'es'}</summary>
              <table className={styles.table}>
                <tbody>
                  {dominated.map((c, i) => (
                    <tr key={`d-${i}`} className={styles.dominatedRow}>
                      <td>{c.source}</td>
                      <td>{c.bonusType}</td>
                      <td className={styles.numCol}>{fmtValue(c)}</td>
                      <td className={styles.muted}>← dominated by {c.dominatedBy ?? 'unknown'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export function BreakdownsTab() {
  const r = useBreakdowns();

  if (!r) {
    return <div className={styles.loading}>Loading game data…</div>;
  }

  const {
    abilityScores, hitPoints, saves,
    meleePower, rangedPower, doublestrike, doubleshot,
    meleeSpeed, rangedSpeed,
    healingAmp, negativeHealingAmp, repairAmp,
    ac, dodge, prr, mrr, spellResistance,
    arcaneSpellFailure,
    spellDCs, spellPenetration, casterLevel,
    spellPowers, spellCriticalChance, spellCriticalDamage,
    diagnostics,
  } = r;
  const SPELL_DAMAGE_TYPES = [
    'Fire','Cold','Electric','Acid','Sonic','Force',
    'Light/Alignment','Negative','Poison','Positive','Repair','Rust',
  ] as const;

  return (
    <div className={styles.page}>
      <p className={styles.disclaimer}>
        Live engine output. Sources: feats, enhancements, destinies, active gear, set bonuses, and stances.
        The Stats panes above read from the same engine. A few amount-type categories (Slider, SpellInfo) are still unmodeled — see Diagnostics below.
      </p>

      <StancesPicker />

      <section className={styles.section}>
        <h3 className={styles.heading}>Ability Scores</h3>
        {(['STR','DEX','CON','INT','WIS','CHA'] as const).map(s => (
          <Row key={s} label={s} result={abilityScores[s]} />
        ))}
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Defenses</h3>
        <Row label="Hit Points"            result={hitPoints} />
        <Row label="Fortitude"             result={saves.Fortitude} />
        <Row label="Reflex"                result={saves.Reflex} />
        <Row label="Will"                  result={saves.Will} />
        <Row label="Armor Class"           result={ac} />
        <Row label="Dodge"                 result={dodge} />
        <Row label="Physical Sheltering (PRR)" result={prr} />
        <Row label="Magical Sheltering (MRR)"  result={mrr} />
        <Row label="Spell Resistance"      result={spellResistance} />
        <Row label="Healing Amp (Positive)" result={healingAmp} />
        <Row label="Healing Amp (Negative)" result={negativeHealingAmp} />
        <Row label="Healing Amp (Repair)"   result={repairAmp} />
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Melee Combat</h3>
        <Row label="Melee Power"   result={meleePower} />
        <Row label="Doublestrike"  result={doublestrike} />
        <Row label="Melee Combat Speed" result={meleeSpeed} />
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Ranged Combat</h3>
        <Row label="Ranged Power"  result={rangedPower} />
        <Row label="Doubleshot"    result={doubleshot} />
        <Row label="Ranged Combat Speed" result={rangedSpeed} />
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Spellcasting</h3>
        <Row label="Caster Level"        result={casterLevel} />
        <Row label="Spell Penetration"   result={spellPenetration} />
        <Row label="Arcane Spell Failure" result={arcaneSpellFailure} />
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Spell DCs</h3>
        {(['Abjuration','Conjuration','Divination','Enchantment','Evocation','Illusion','Necromancy','Transmutation'] as const).map(school => (
          <Row key={school} label={school} result={spellDCs[school]} />
        ))}
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Spell Power</h3>
        {SPELL_DAMAGE_TYPES.map(t => (
          <Row key={`pow-${t}`} label={`${t} Spell Power`} result={spellPowers[t]} />
        ))}
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Spell Critical Chance</h3>
        {SPELL_DAMAGE_TYPES.map(t => (
          <Row key={`crit-${t}`} label={`${t} Crit Chance`} result={spellCriticalChance[t]} />
        ))}
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Spell Critical Damage</h3>
        {SPELL_DAMAGE_TYPES.map(t => (
          <Row key={`crd-${t}`} label={`${t} Crit Damage`} result={spellCriticalDamage[t]} />
        ))}
      </section>

      <section className={styles.diagnostics}>
        <h3 className={styles.heading}>Diagnostics</h3>
        <dl>
          <dt>Sourced effects</dt><dd>{diagnostics.totalSourcedEffects}</dd>
          <dt>Applied bonuses</dt><dd>{diagnostics.totalAppliedBonuses}</dd>
          <dt>Requirements failed</dt><dd>{diagnostics.requirementsFailedCount}</dd>
          {diagnostics.unmatchedFeats.length > 0 && (
            <>
              <dt>Unmatched feats</dt>
              <dd className={styles.unmatched}>{diagnostics.unmatchedFeats.join(', ')}</dd>
            </>
          )}
          {Object.keys(diagnostics.unmodeledAmountTypes).length > 0 && (
            <>
              <dt>Unmodeled amount types</dt>
              <dd className={styles.unmatched}>
                {Object.entries(diagnostics.unmodeledAmountTypes)
                  .map(([k, v]) => `${k} (${v})`).join(', ')}
              </dd>
            </>
          )}
        </dl>
      </section>
    </div>
  );
}
