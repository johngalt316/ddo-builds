import { useState, type ReactNode } from 'react';
import { useBreakdowns } from '@/hooks/useBreakdowns';
import { StancesPicker } from './StancesPicker';
import type { BreakdownResult } from '@/engine/bonusStacking';
import skillsJson from '@/data/skills.json';
import type { Skill } from '@/types/gameData';
import styles from './BreakdownsTab.module.css';

const ALL_SKILLS = skillsJson as unknown as Skill[];

// ── Collapsible section wrapper ─────────────────────────────────────────

interface SectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={styles.section}>
      <button
        className={styles.sectionHeader}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={open ? styles.sectionChevronOpen : styles.sectionChevron}>▸</span>
        <span className={styles.sectionTitle}>{title}</span>
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </section>
  );
}

// ── Single breakdown row ────────────────────────────────────────────────

interface RowProps {
  label: string;
  result: BreakdownResult;
}

function fmtValue(c: { value: number; isPercent?: boolean }, flatSubtotal: number): string {
  if (c.isPercent) {
    const flat = Math.round(flatSubtotal * c.value / 100);
    const sign = c.value >= 0 ? '+' : '';
    const flatSign = flat >= 0 ? '+' : '';
    return `${sign}${c.value}% (${flatSign}${flat})`;
  }
  return c.value > 0 ? `+${c.value}` : `${c.value}`;
}

function ContributorTables({ result }: { result: BreakdownResult }) {
  const applied = result.contributors.filter(c => c.applied);
  const dominated = result.contributors.filter(c => !c.applied);
  const flatSubtotal = applied.filter(c => !c.isPercent).reduce((s, c) => s + c.value, 0);

  return (
    <>
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
                <td className={styles.numCol}>{fmtValue(c, flatSubtotal)}</td>
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
                  <td className={styles.numCol}>{fmtValue(c, flatSubtotal)}</td>
                  <td className={styles.muted}>← dominated by {c.dominatedBy ?? 'unknown'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}

function Row({ label, result }: RowProps) {
  const [open, setOpen] = useState(false);
  const applied = result.contributors.filter(c => c.applied);
  const dominated = result.contributors.filter(c => !c.applied);

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
          <ContributorTables result={result} />
        </div>
      )}
    </div>
  );
}

// ── Combined per-element row: power / crit / crit-damage in one ────────

interface CombinedSpellRowProps {
  element: string;
  power: BreakdownResult;
  critChance: BreakdownResult;
  critDamage: BreakdownResult;
}

function CombinedSpellRow({ element, power, critChance, critDamage }: CombinedSpellRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.row}>
      <button
        className={styles.rowHeaderCombined}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={open ? styles.chevronOpen : styles.chevron}>▸</span>
        <span className={styles.label}>{element} Spell Power</span>
        <span className={styles.combinedTotals}>
          <span className={styles.total}>{power.total}</span>
          <span className={styles.combinedSep}>/</span>
          <span className={styles.combinedTotal}>{critChance.total}% Crit</span>
          <span className={styles.combinedSep}>/</span>
          <span className={styles.combinedTotal}>{critDamage.total}% Crit Dmg</span>
        </span>
      </button>
      {open && (
        <div className={styles.body}>
          <div className={styles.subBreakdown}>
            <h4 className={styles.subHeading}>Spell Power</h4>
            <ContributorTables result={power} />
          </div>
          <div className={styles.subBreakdown}>
            <h4 className={styles.subHeading}>Critical Chance</h4>
            <ContributorTables result={critChance} />
          </div>
          <div className={styles.subBreakdown}>
            <h4 className={styles.subHeading}>Critical Damage</h4>
            <ContributorTables result={critDamage} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab ─────────────────────────────────────────────────────────────────

export function BreakdownsTab() {
  const r = useBreakdowns();

  if (!r) {
    return <div className={styles.loading}>Loading game data…</div>;
  }

  const {
    abilityScores, hitPoints, spellPoints, saves,
    meleePower, rangedPower, doublestrike, doubleshot, sneakAttackDice,
    meleeSpeed, rangedSpeed,
    healingAmp, negativeHealingAmp, repairAmp,
    ac, dodge, prr, mrr, spellResistance,
    arcaneSpellFailure,
    spellDCs, spellPenetration, casterLevel,
    universalSpellPower, universalSpellCriticalChance, universalSpellCriticalDamage,
    spellPowers, spellCriticalChance, spellCriticalDamage,
    skills,
    diagnostics,
  } = r;
  const SPELL_DAMAGE_TYPES = [
    'Acid','Chaos','Cold','Electric','Evil','Fire','Force','Light/Alignment',
    'Negative','Poison','Positive','Repair','Sonic',
  ] as const;
  const SPELL_SCHOOLS = [
    'Abjuration','Conjuration','Divination','Enchantment',
    'Evocation','Illusion','Necromancy','Transmutation',
  ] as const;

  return (
    <div className={styles.page}>
      <p className={styles.disclaimer}>
        Live engine output. Sources: feats, enhancements, destinies, active gear, set bonuses, and stances.
        The Stats panes above read from the same engine. A few amount-type categories (Slider, SpellInfo) are still unmodeled — see Diagnostics below.
      </p>

      <StancesPicker />

      <Section title="General">
        <Row label="Hit Points"   result={hitPoints} />
        <Row label="Spell Points" result={spellPoints} />
      </Section>

      <Section title="Ability Scores">
        {(['STR','DEX','CON','INT','WIS','CHA'] as const).map(s => (
          <Row key={s} label={s} result={abilityScores[s]} />
        ))}
      </Section>

      <Section title="Defenses">
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
      </Section>

      <Section title="Melee Combat">
        <Row label="Melee Power"      result={meleePower} />
        <Row label="Doublestrike"     result={doublestrike} />
        <Row label="Sneak Attack Dice" result={sneakAttackDice} />
        <Row label="Melee Combat Speed" result={meleeSpeed} />
      </Section>

      <Section title="Ranged Combat">
        <Row label="Ranged Power"     result={rangedPower} />
        <Row label="Doubleshot"       result={doubleshot} />
        <Row label="Sneak Attack Dice" result={sneakAttackDice} />
        <Row label="Ranged Combat Speed" result={rangedSpeed} />
      </Section>

      <Section title="Spellcasting">
        <Row label="Caster Level"        result={casterLevel} />
        <Row label="Spell Penetration"   result={spellPenetration} />
        <Row label="Arcane Spell Failure" result={arcaneSpellFailure} />
        <Row label="Sneak Attack Dice"   result={sneakAttackDice} />
        {SPELL_SCHOOLS.map(school => (
          <Row key={school} label={`${school} DC`} result={spellDCs[school]} />
        ))}
      </Section>

      <Section title="Skills" defaultOpen={false}>
        {ALL_SKILLS.map(skill => {
          const r = skills[skill.id];
          if (!r) return null;
          return <Row key={skill.id} label={skill.name} result={r} />;
        })}
      </Section>

      <Section title="Spell Damage">
        {SPELL_DAMAGE_TYPES.map(t => (
          <CombinedSpellRow
            key={t}
            element={t}
            power={spellPowers[t]}
            critChance={spellCriticalChance[t]}
            critDamage={spellCriticalDamage[t]}
          />
        ))}
        <CombinedSpellRow
          element="Universal"
          power={universalSpellPower}
          critChance={universalSpellCriticalChance}
          critDamage={universalSpellCriticalDamage}
        />
      </Section>

      <Section title="Diagnostics" defaultOpen={false}>
        <dl className={styles.diagnosticsDl}>
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
      </Section>
    </div>
  );
}
