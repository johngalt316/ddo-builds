import { useState, type ReactNode } from 'react';
import { useBuildStore } from '@/store/buildStore';
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

// ── Override editor (inline) ───────────────────────────────────────────

interface OverrideEditorProps {
  overrideKey: string;
  /** Current override value when one is set; otherwise the engine total
   *  is shown as the input placeholder so the user can tweak from it. */
  value: number | undefined;
  engineTotal: number;
}

function OverrideEditor({ overrideKey, value, engineTotal }: OverrideEditorProps) {
  const setStatOverride = useBuildStore(s => s.setStatOverride);
  // Local input state so we can show in-progress edits before they
  // commit. Commit on blur or Enter to avoid thrashing the engine on
  // every keystroke.
  const [draft, setDraft] = useState<string>(() =>
    value !== undefined ? String(value) : '');

  // Keep draft in sync if the underlying override changes (e.g. cleared
  // from elsewhere, restored from share-URL load).
  const drafts = value !== undefined ? String(value) : '';
  if (drafts !== draft && document.activeElement?.tagName !== 'INPUT') {
    // Only sync when the editor isn't focused — don't yank the input
    // out from under an active typist.
    setDraft(drafts);
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === '') {
      setStatOverride(overrideKey, undefined);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    setStatOverride(overrideKey, parsed);
  }

  return (
    <span
      className={styles.overrideEditor}
      onClick={e => e.stopPropagation()}  // don't toggle row expansion when clicking the editor
    >
      <input
        type="number"
        className={styles.overrideInput}
        value={draft}
        placeholder={String(engineTotal)}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        aria-label={`Override value for ${overrideKey}`}
      />
      <button
        type="button"
        className={styles.overrideClear}
        onClick={() => { setDraft(''); setStatOverride(overrideKey, undefined); }}
        disabled={value === undefined}
        title="Clear override (revert to engine value)"
      >
        ✕
      </button>
    </span>
  );
}

// ── Single breakdown row ────────────────────────────────────────────────

interface RowProps {
  label: string;
  result: BreakdownResult;
  /** When set, the user can override this row's total via the inline
   *  editor (visible only when `editMode` is also true). Active
   *  overrides still display the "overridden" indicator regardless of
   *  edit mode. */
  overrideKey?: string;
  editMode?: boolean;
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

function Row({ label, result, overrideKey, editMode = false }: RowProps) {
  const [open, setOpen] = useState(false);
  const applied = result.contributors.filter(c => c.applied);
  const dominated = result.contributors.filter(c => !c.applied);
  const isOverridden = result.override !== undefined;
  const engineTotal = result.override?.engineTotal ?? result.total;
  // In edit mode the inline editor replaces the count column (which is
  // supplementary). Keeps the row compact on narrow viewports.
  const editing = editMode && !!overrideKey;

  return (
    <div className={styles.row}>
      <button
        className={editing ? `${styles.rowHeader} ${styles.rowHeaderEditing}` : styles.rowHeader}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={open ? styles.chevronOpen : styles.chevron}>▸</span>
        <span className={styles.label}>{label}</span>
        {editing ? (
          <OverrideEditor
            overrideKey={overrideKey!}
            value={isOverridden ? result.total : undefined}
            engineTotal={engineTotal}
          />
        ) : (
          <>
            <span className={isOverridden ? styles.totalOverridden : styles.total}>
              {result.total}
              {isOverridden && <span className={styles.totalOverriddenTag}>OVR</span>}
            </span>
            <span className={styles.count}>
              {applied.length} applied{dominated.length ? ` · ${dominated.length} dominated` : ''}
            </span>
          </>
        )}
      </button>
      {open && (
        <div className={styles.body}>
          {isOverridden && (
            <div className={styles.overrideEngineHint}>
              <strong>Override active</strong> — engine calculation would yield <strong>{engineTotal}</strong>.
              {' '}Clear the override (✕ next to the input in edit mode) to restore the engine value.
            </div>
          )}
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
  /** Override key bases. The three sub-stats get suffixes:
   *  `<base>.<element>` for spellPower, spellCriticalChance, spellCriticalDamage.
   *  Pass undefined when override editing isn't applicable (universal pane). */
  overrideKeyBase?: { power: string; critChance: string; critDamage: string };
  editMode?: boolean;
}

function CombinedSpellRow({
  element, power, critChance, critDamage, overrideKeyBase, editMode = false,
}: CombinedSpellRowProps) {
  const [open, setOpen] = useState(false);

  // Render a sub-breakdown with optional override editor wiring.
  // In edit mode the inline current-value is hidden — the editor takes
  // its place so the user isn't fighting layout space between two
  // representations of the same number.
  function renderSubBreakdown(title: string, result: BreakdownResult, key?: string) {
    const isOverridden = result.override !== undefined;
    const engineTotal = result.override?.engineTotal ?? result.total;
    const editing = editMode && !!key;
    return (
      <div className={styles.subBreakdown}>
        <h4 className={styles.subHeading}>
          {title}
          {!editing && (
            <>
              {' '}
              <span className={isOverridden ? styles.totalOverridden : styles.total}>
                {result.total}
                {isOverridden && <span className={styles.totalOverriddenTag}>OVR</span>}
              </span>
            </>
          )}
          {editing && (
            <span style={{ marginLeft: '0.6rem' }}>
              <OverrideEditor overrideKey={key!} value={isOverridden ? result.total : undefined} engineTotal={engineTotal} />
            </span>
          )}
        </h4>
        {isOverridden && (
          <div className={styles.overrideEngineHint}>
            <strong>Override active</strong> — engine would compute <strong>{engineTotal}</strong>.
          </div>
        )}
        <ContributorTables result={result} />
      </div>
    );
  }

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
          <span className={power.override ? styles.totalOverridden : styles.total}>{power.total}</span>
          <span className={styles.combinedSep}>/</span>
          <span className={critChance.override ? styles.totalOverridden : styles.combinedTotal}>{critChance.total}% Crit</span>
          <span className={styles.combinedSep}>/</span>
          <span className={critDamage.override ? styles.totalOverridden : styles.combinedTotal}>{critDamage.total}% Crit Dmg</span>
        </span>
      </button>
      {open && (
        <div className={styles.body}>
          {renderSubBreakdown('Spell Power',     power,      overrideKeyBase ? `${overrideKeyBase.power}` : undefined)}
          {renderSubBreakdown('Critical Chance', critChance, overrideKeyBase ? `${overrideKeyBase.critChance}` : undefined)}
          {renderSubBreakdown('Critical Damage', critDamage, overrideKeyBase ? `${overrideKeyBase.critDamage}` : undefined)}
        </div>
      )}
    </div>
  );
}

// ── Tab ─────────────────────────────────────────────────────────────────

export function BreakdownsTab() {
  const r = useBreakdowns();
  // Edit-mode is local UI state (not persisted) — the user toggles it
  // when they want to spot-check or override values, then turns it off
  // to read the breakdowns normally. The overrides themselves persist
  // on `build.statOverrides` and survive page reloads + share links.
  const [editMode, setEditMode] = useState(false);
  const overrides = useBuildStore(s => s.build.statOverrides);
  const setStatOverride = useBuildStore(s => s.setStatOverride);
  const overrideCount = overrides ? Object.keys(overrides).length : 0;
  function clearAllOverrides() {
    if (!overrides) return;
    for (const key of Object.keys(overrides)) {
      setStatOverride(key, undefined);
    }
  }

  if (!r) {
    return <div className={styles.loading}>Loading game data…</div>;
  }

  const {
    abilityScores, hitPoints, spellPoints, saves,
    meleePower, rangedPower, doublestrike, doubleshot, sneakAttackDice, imbueDice,
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

      {/* Override-edit toggle. When ON, every row's total becomes an
          editable number input. Overrides themselves persist on the
          build (and through share-link URLs) regardless of this flag. */}
      <label className={editMode ? `${styles.editToggle} ${styles.editToggleActive}` : styles.editToggle}>
        <input
          type="checkbox"
          checked={editMode}
          onChange={e => setEditMode(e.target.checked)}
        />
        <span>Allow manual overrides</span>
        <span className={styles.editHint}>
          {editMode
            ? `Edit any total inline; values persist + ride along on share links. ${overrideCount} active.`
            : overrideCount > 0
              ? `${overrideCount} active override${overrideCount === 1 ? '' : 's'} — toggle on to edit.`
              : 'Hand-edit any breakdown total to spot-check theorycraft scenarios.'}
        </span>
        {overrideCount > 0 && (
          <button
            type="button"
            onClick={e => { e.preventDefault(); clearAllOverrides(); }}
            className={styles.overrideClear}
            style={{ marginLeft: 'auto' }}
            title="Clear every active override"
          >
            Clear all ({overrideCount})
          </button>
        )}
      </label>

      <Section title="General">
        <Row label="Hit Points"   result={hitPoints}   overrideKey="hitPoints"   editMode={editMode} />
        <Row label="Spell Points" result={spellPoints} overrideKey="spellPoints" editMode={editMode} />
      </Section>

      <Section title="Ability Scores">
        {(['STR','DEX','CON','INT','WIS','CHA'] as const).map(s => (
          <Row key={s} label={s} result={abilityScores[s]} overrideKey={`abilityScore.${s}`} editMode={editMode} />
        ))}
      </Section>

      <Section title="Defenses">
        <Row label="Fortitude"                 result={saves.Fortitude}    overrideKey="save.Fortitude"      editMode={editMode} />
        <Row label="Reflex"                    result={saves.Reflex}       overrideKey="save.Reflex"         editMode={editMode} />
        <Row label="Will"                      result={saves.Will}         overrideKey="save.Will"           editMode={editMode} />
        <Row label="Armor Class"               result={ac}                 overrideKey="ac"                  editMode={editMode} />
        <Row label="Dodge"                     result={dodge}              overrideKey="dodge"               editMode={editMode} />
        <Row label="Physical Sheltering (PRR)" result={prr}                overrideKey="prr"                 editMode={editMode} />
        <Row label="Magical Sheltering (MRR)"  result={mrr}                overrideKey="mrr"                 editMode={editMode} />
        <Row label="Spell Resistance"          result={spellResistance}    overrideKey="spellResistance"     editMode={editMode} />
        <Row label="Healing Amp (Positive)"    result={healingAmp}         overrideKey="healingAmp"          editMode={editMode} />
        <Row label="Healing Amp (Negative)"    result={negativeHealingAmp} overrideKey="negativeHealingAmp"  editMode={editMode} />
        <Row label="Healing Amp (Repair)"      result={repairAmp}          overrideKey="repairAmp"           editMode={editMode} />
      </Section>

      <Section title="Melee Combat">
        <Row label="Melee Power"        result={meleePower}      overrideKey="meleePower"      editMode={editMode} />
        <Row label="Doublestrike"       result={doublestrike}    overrideKey="doublestrike"    editMode={editMode} />
        <Row label="Sneak Attack Dice"  result={sneakAttackDice} overrideKey="sneakAttackDice" editMode={editMode} />
        <Row label="Imbue Dice"         result={imbueDice}       overrideKey="imbueDice"       editMode={editMode} />
        <Row label="Melee Combat Speed" result={meleeSpeed}      overrideKey="meleeSpeed"      editMode={editMode} />
      </Section>

      <Section title="Ranged Combat">
        <Row label="Ranged Power"        result={rangedPower}     overrideKey="rangedPower"     editMode={editMode} />
        <Row label="Doubleshot"          result={doubleshot}      overrideKey="doubleshot"      editMode={editMode} />
        <Row label="Sneak Attack Dice"   result={sneakAttackDice} overrideKey="sneakAttackDice" editMode={editMode} />
        <Row label="Imbue Dice"          result={imbueDice}       overrideKey="imbueDice"       editMode={editMode} />
        <Row label="Ranged Combat Speed" result={rangedSpeed}     overrideKey="rangedSpeed"     editMode={editMode} />
      </Section>

      <Section title="Spellcasting">
        <Row label="Caster Level"         result={casterLevel}       overrideKey="casterLevel"        editMode={editMode} />
        <Row label="Spell Penetration"    result={spellPenetration}  overrideKey="spellPenetration"   editMode={editMode} />
        <Row label="Arcane Spell Failure" result={arcaneSpellFailure} overrideKey="arcaneSpellFailure" editMode={editMode} />
        <Row label="Sneak Attack Dice"    result={sneakAttackDice}   overrideKey="sneakAttackDice"    editMode={editMode} />
        <Row label="Imbue Dice"           result={imbueDice}         overrideKey="imbueDice"          editMode={editMode} />
        {SPELL_SCHOOLS.map(school => (
          <Row
            key={school}
            label={`${school} DC`}
            result={spellDCs[school]}
            overrideKey={`spellDC.${school}`}
            editMode={editMode}
          />
        ))}
      </Section>

      <Section title="Skills" defaultOpen={false}>
        {ALL_SKILLS.map(skill => {
          const r = skills[skill.id];
          if (!r) return null;
          return (
            <Row
              key={skill.id}
              label={skill.name}
              result={r}
              overrideKey={`skill.${skill.id}`}
              editMode={editMode}
            />
          );
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
            overrideKeyBase={{
              power:      `spellPower.${t}`,
              critChance: `spellCriticalChance.${t}`,
              critDamage: `spellCriticalDamage.${t}`,
            }}
            editMode={editMode}
          />
        ))}
        <CombinedSpellRow
          element="Universal"
          power={universalSpellPower}
          critChance={universalSpellCriticalChance}
          critDamage={universalSpellCriticalDamage}
          overrideKeyBase={{
            power:      'universalSpellPower',
            critChance: 'universalSpellCriticalChance',
            critDamage: 'universalSpellCriticalDamage',
          }}
          editMode={editMode}
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
