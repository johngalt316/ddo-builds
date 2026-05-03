import { useStats } from '@/hooks/useStats';
import styles from './StatsSection.module.css';

export function StatsSection() {
  const s = useStats();

  return (
    <section className={styles.statsSection}>
      <h2 className={styles.heading}>Stats</h2>
      <div className={styles.panes}>
        <OverallPane stats={s} />
        <MeleePane stats={s} />
        <RangedPane stats={s} />
        <MagicPane stats={s} />
      </div>
    </section>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function fmtSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

interface RowProps {
  label: string;
  value: string | number;
  hint?: string;
  muted?: boolean;
}
function StatRow({ label, value, hint, muted }: RowProps) {
  return (
    <div className={styles.row}>
      <dt className={styles.rowLabel}>
        {label}
        {hint && <span className={styles.hint}>{hint}</span>}
      </dt>
      <dd className={muted ? styles.rowValueMuted : styles.rowValue}>{value}</dd>
    </div>
  );
}

// ── Panes ───────────────────────────────────────────────────────────

type Stats = ReturnType<typeof useStats>;

function OverallPane({ stats }: { stats: Stats }) {
  return (
    <div className={styles.pane}>
      <h3 className={styles.paneHeading}>Overall</h3>
      <dl className={styles.list}>
        <StatRow label="Hit Points"      value={stats.hitPoints} />
        <StatRow label="Spell Points"    value={stats.spellPoints || '—'} />
        <StatRow label="Healing Amp"     value={stats.healingAmp ? `+${stats.healingAmp}%` : '—'} />
        <StatRow label="PRR"             value={stats.prr} hint="phys. resist" muted />
        <StatRow label="MRR"             value={stats.mrr} hint="magic resist" muted />
        <StatRow label="AC"              value={stats.ac} muted />
        <StatRow label="Fortitude"       value={fmtSigned(stats.saves.fortitude)} />
        <StatRow label="Reflex"          value={fmtSigned(stats.saves.reflex)} />
        <StatRow label="Will"            value={fmtSigned(stats.saves.will)} />
      </dl>
      <p className={styles.disclaimer}>PRR / MRR / AC are not yet engine-backed</p>
    </div>
  );
}

function MeleePane({ stats }: { stats: Stats }) {
  const critList = stats.improvedCriticalGroups.length
    ? stats.improvedCriticalGroups.join(', ')
    : '—';
  const attackChain = stats.attackChain.length ? stats.attackChain.join(' / ') : '—';
  return (
    <div className={styles.pane}>
      <h3 className={styles.paneHeading}>Melee</h3>
      <dl className={styles.list}>
        <StatRow label="Melee Power"      value={`+${stats.meleePower}`} />
        <StatRow label="Doublestrike"     value={stats.doublestrike ? `+${stats.doublestrike}%` : '—'} />
        <StatRow label="Damage Attr"      value={`${stats.meleeDamageAttr.stat} ${fmtSigned(stats.meleeDamageAttr.mod)}`} />
        <StatRow label="Attack Bonus"     value={fmtSigned(stats.meleeAttackBonus)} hint="BAB + attr" />
        <StatRow label="Attacks / round"  value={stats.meleeAttackCount} hint="iterative" />
        <StatRow label="Improved Crit"    value={critList} />
        <StatRow label="Attack chain"     value={attackChain} />
      </dl>
      <h4 className={styles.subHeading}>Procs &amp; Debuffs</h4>
      <p className={styles.placeholder}>Equip gear to see procs (e.g. Dripping with Magma) and debuffs (e.g. Legendary Ash).</p>
    </div>
  );
}

function RangedPane({ stats }: { stats: Stats }) {
  // Identify ranged-relevant Improved Critical
  const hasRangedCrit = stats.improvedCriticalGroups.some(g => g.includes('Ranged') || g.includes('Thrown'));
  return (
    <div className={styles.pane}>
      <h3 className={styles.paneHeading}>Ranged</h3>
      <dl className={styles.list}>
        <StatRow label="Ranged Power"   value={`+${stats.rangedPower}`} />
        <StatRow label="Doubleshot"     value={stats.doubleshot ? `+${stats.doubleshot}%` : '—'} />
        <StatRow label="DEX modifier"   value={fmtSigned(stats.rangedDexBonus)} />
        <StatRow label="Attack Bonus"   value={fmtSigned(stats.rangedAttackBonus)} hint="BAB + DEX" />
        <StatRow label="Improved Crit"  value={hasRangedCrit ? 'Yes' : '—'} />
      </dl>
      <h4 className={styles.subHeading}>Procs &amp; Debuffs</h4>
      <p className={styles.placeholder}>Equip a bow / crossbow to see ranged-specific procs and on-hit effects.</p>
    </div>
  );
}

function MagicPane({ stats }: { stats: Stats }) {
  return (
    <div className={styles.pane}>
      <h3 className={styles.paneHeading}>Magic</h3>
      <dl className={styles.list}>
        <StatRow label="Spell Points"   value={stats.spellPoints || '—'} />
        <StatRow
          label="Caster Level"
          value={stats.primarySpellcaster
            ? `${stats.primarySpellcaster.level} (${stats.primarySpellcaster.className})`
            : '—'}
        />
        <StatRow
          label="Spell Penetration"
          value={stats.spellPenetration > 0 ? `+${stats.spellPenetration}` : '—'}
        />
        <StatRow
          label="Spell Focus"
          value={stats.spellFocusSchools.length ? stats.spellFocusSchools.join(', ') : '—'}
        />
        <StatRow
          label="Metamagic"
          value={stats.metamagicFeats.length ? stats.metamagicFeats.length.toString() : '—'}
          hint={stats.metamagicFeats.length ? stats.metamagicFeats.join(', ') : ''}
        />
      </dl>
      <h4 className={styles.subHeading}>Procs &amp; Buffs</h4>
      <p className={styles.placeholder}>Equip an implement / weapon to see spell power, crit chance, and on-cast effects.</p>
    </div>
  );
}
