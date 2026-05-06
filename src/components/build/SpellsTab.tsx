import { useMemo, useState } from 'react';
import { useBuild } from '@/hooks/useBuild';
import { useBuildStore } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { useBreakdowns } from '@/hooks/useBreakdowns';
import type { DDOClassData, DDOSpellData } from '@/types/ddoData';
import type { AvailableStance } from '@/engine/collectEffects';
import { SpellPickerDialog } from './SpellPickerDialog';
import styles from './SpellsTab.module.css';

/** Mirror engine's `indexClasses` so lookups match build.classes' classId. */
function classNameToId(name: string): string {
  return name.toLowerCase().replace(/[\s']+/g, '_').replace(/-/g, '_');
}

// Metamagic toggles that the engine + DPS calculator track. Names match
// the in-game stance text exactly (so they line up with the per-feat
// `<Stance><Name>` blocks in Feats.xml / Epic.class.xml). `flag` joins
// to the boolean keys on `DDOSpellData['metamagic']` for the per-spell
// "applicable metamagics" tooltip in the spell picker — Eschew Materials
// has no per-spell flag (it's a global component-cost reduction) so its
// `flag` is undefined.
const METAMAGICS: { name: string; flag?: keyof DDOSpellData['metamagic'] }[] = [
  { name: 'Empower Spell',         flag: 'empower' },
  { name: 'Empower Healing Spell', flag: 'empowerHealing' },
  { name: 'Maximize Spell',        flag: 'maximize' },
  { name: 'Quicken Spell',         flag: 'quicken' },
  { name: 'Heighten Spell',        flag: 'heighten' },
  { name: 'Intensify Spell',       flag: 'intensify' },
  { name: 'Embolden Spell',        flag: 'embolden' },
  { name: 'Enlarge Spell',         flag: 'enlarge' },
  { name: 'Extend Spell',          flag: 'extend' },
  { name: 'Accelerate Spell',      flag: 'accelerate' },
  { name: 'Eschew Materials' /* no per-spell flag */ },
];

/** Set of metamagic stance names — used to (a) override the stance
 *  group when the source XML doesn't tag it (e.g. Eschew Materials,
 *  whose `<Stance>` block omits `<Group>`) and (b) detect when the
 *  Stances panel should render with multi-select toggleMetamagic
 *  semantics instead of mutual-exclusion stance toggling. */
const METAMAGIC_NAMES: Set<string> = new Set(METAMAGICS.map(m => m.name));

/** Display label used as the group header for the metamagic block in
 *  the Stances panel. Matches `<Group>` values in the source XML so
 *  metamagics with the explicit tag also land here. */
const METAMAGIC_GROUP = 'Metamagics';

export function SpellsTab() {
  const { build } = useBuild();
  const classes  = useGameDataStore(s => s.classes);
  const spells   = useGameDataStore(s => s.spells);
  const r        = useBreakdowns();

  // Per-class level counts keyed by classId (snake_case lowercase).
  const classLevels = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of build.classes) {
      m.set(c.classId, (m.get(c.classId) ?? 0) + c.levels);
    }
    return m;
  }, [build.classes]);

  // Casting classes with at least one slot at the current class level.
  // Match by normalizing the catalog class name to the same id format.
  const castingTabs = useMemo(() => {
    const out: { cls: DDOClassData; classLevel: number; slots: number[] }[] = [];
    for (const cls of classes) {
      const lvl = classLevels.get(classNameToId(cls.name)) ?? 0;
      if (lvl === 0) continue;
      const slots = cls.spellSlotsByLevel[lvl - 1] ?? [];
      if (slots.some(n => n > 0)) {
        out.push({ cls, classLevel: lvl, slots });
      }
    }
    return out;
  }, [classes, classLevels]);

  // Counts split by category — drives sub-tab labels.
  const slaCounts = useMemo(() => {
    const c = { feat: 0, enhancement: 0, gear: 0, other: 0 };
    if (r) for (const s of r.slas) c[s.category]++;
    return c;
  }, [r]);
  const slaCount = (slaCounts.enhancement + slaCounts.gear + slaCounts.other);
  const featCount = slaCounts.feat;

  const stanceCount = r?.availableStances.length ?? 0;
  const activeBuffsCount = build.activePartyBuffs?.length ?? 0;

  // Sub-tab state. '__sla__' = enhancement/gear SLA list; '__feats__' =
  // feat-granted SLAs; '__stances__' = stances/mantles; '__buffs__' =
  // self/party buffs; else a class name.
  const [activeSubTab, setActiveSubTab] = useState<string>('__sla__');
  const subTabs = [
    ...castingTabs.map(t => ({ id: t.cls.name, label: `${t.cls.name} Spells` })),
    { id: '__sla__',     label: `SLAs (${slaCount})` },
    { id: '__feats__',   label: `Feat Abilities (${featCount})` },
    { id: '__stances__', label: `Stances & Mantles (${stanceCount})` },
    { id: '__buffs__',   label: `Self/Party Buffs${activeBuffsCount > 0 ? ` (${activeBuffsCount} on)` : ''}` },
  ];

  // Resolve the active class tab, if any. Falls through to SLA when the
  // tab name no longer exists (e.g. user removed the only Wizard level).
  const activeClass = castingTabs.find(t => t.cls.name === activeSubTab);
  const effectiveTab = activeClass ? activeClass.cls.name : activeSubTab;

  return (
    <div className={styles.panel}>
      <div className={styles.subTabs} role="tablist">
        {subTabs.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === effectiveTab}
            className={t.id === effectiveTab ? styles.subTabActive : styles.subTab}
            onClick={() => setActiveSubTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.body}>
        {activeClass ? (
          <ClassSpellPanel
            cls={activeClass.cls}
            classLevel={activeClass.classLevel}
            slots={activeClass.slots}
            spellCatalog={spells}
          />
        ) : effectiveTab === '__feats__' ? (
          <SLAList
            spellCatalog={spells}
            categoryFilter={['feat']}
            emptyHint="No feat-granted abilities yet. Past-life feats and certain selected feats grant spell-like abilities here."
          />
        ) : effectiveTab === '__stances__' ? (
          <StancesPanel />
        ) : effectiveTab === '__buffs__' ? (
          <PartyBuffsPanel />
        ) : castingTabs.length === 0 && r && r.slas.length === 0 ? (
          <div className={styles.empty}>
            This build has no casting classes and no spell-like abilities yet.
            Add a casting class level (Cleric, Wizard, Paladin, etc.) or train an
            enhancement / past-life that grants an SLA.
          </div>
        ) : (
          <SLAList
            spellCatalog={spells}
            categoryFilter={['enhancement', 'gear', 'other']}
            emptyHint="No spell-like abilities from enhancements or gear yet. Enhancement-tree picks like 'Conjuration I: Shield' grant SLAs here."
          />
        )}
      </div>
    </div>
  );
}

// ── SLA tab — read-only list of granted spell-like abilities ─────────

function SLAList({
  spellCatalog, categoryFilter, emptyHint,
}: {
  spellCatalog: DDOSpellData[];
  categoryFilter: ('feat' | 'enhancement' | 'gear' | 'other')[];
  emptyHint: string;
}) {
  const r = useBreakdowns();
  // Look up an SLA's icon by spell name (most SLAs share their name with a
  // catalog spell, e.g. "Magic Missile", "Shield", "Abundant Step").
  const iconByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of spellCatalog) if (s.icon) m.set(s.name, s.icon);
    return m;
  }, [spellCatalog]);

  if (!r) return <div className={styles.empty}>Loading…</div>;
  const slas = r.slas.filter(s => categoryFilter.includes(s.category));
  if (slas.length === 0) {
    return <div className={styles.empty}>{emptyHint}</div>;
  }
  return (
    <table className={styles.slaTable}>
      <thead>
        <tr>
          <th />
          <th>Name</th>
          <th>Casting Class</th>
          <th>Cost</th>
          <th>Max CL</th>
          <th>Cooldown</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {slas.map((s, i) => {
          const icon = iconByName.get(s.name);
          return (
            <tr key={`${s.name}|${s.source}|${i}`}>
              <td className={styles.slaIconCell}>
                {icon && (
                  <img
                    src={`/assets/images/SpellImages/${icon}.png`}
                    alt=""
                    className={styles.slaIcon}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
              </td>
              <td className={styles.slaName}>{s.name}</td>
              <td>{s.castingClass || '—'}</td>
              <td className={styles.numCol}>{s.cost || '—'}</td>
              <td className={styles.numCol}>{s.maxCasterLevel || '—'}</td>
              <td className={styles.numCol}>{s.cooldown ? `${s.cooldown}s` : '—'}</td>
              <td className={styles.slaSource}>{s.source}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Per-class spell panel ─────────────────────────────────────────────

function ClassSpellPanel({
  cls, slots, spellCatalog,
}: {
  cls: DDOClassData;
  classLevel: number;
  slots: number[];
  spellCatalog: DDOSpellData[];
}) {
  const { build } = useBuild();
  const trainSpell   = useBuildStore(s => s.trainSpell);
  const untrainSpell = useBuildStore(s => s.untrainSpell);
  const [picker, setPicker] = useState<{ spellLevel: number; slotIdx: number } | null>(null);

  const trained = build.trainedSpells?.[cls.name] ?? {};
  const activeMetamagics = build.activeMetamagics ?? [];

  // Index the global spell catalog by name for quick lookups.
  const spellByName = useMemo(() => {
    const m = new Map<string, DDOSpellData>();
    for (const s of spellCatalog) m.set(s.name, s);
    return m;
  }, [spellCatalog]);

  // Spells trainable for this class — filtered later by spell level on each row.
  const classSpellsByLevel = useMemo(() => {
    const m = new Map<number, { name: string; data?: DDOSpellData }[]>();
    for (const cs of cls.spells) {
      const list = m.get(cs.level) ?? [];
      list.push({ name: cs.name, data: spellByName.get(cs.name) });
      m.set(cs.level, list);
    }
    return m;
  }, [cls.spells, spellByName]);

  return (
    <div>
      <div className={styles.slotGrid}>
        {slots.map((count, idx) => {
          const spellLevel = idx + 1;
          if (count === 0) return null;
          const trainedAtLevel = trained[String(spellLevel)] ?? [];
          return (
            <div key={spellLevel} className={styles.slotRow}>
              <div className={styles.slotRowLabel}>
                <span className={styles.slotLevel}>L{spellLevel}</span>
                <span className={styles.slotCount}>{trainedAtLevel.length}/{count}</span>
              </div>
              <div className={styles.slotRowTiles}>
                {Array.from({ length: count }, (_, i) => {
                  const trainedName = trainedAtLevel[i];
                  const data = trainedName ? spellByName.get(trainedName) : undefined;
                  return (
                    <SpellSlotTile
                      key={i}
                      trainedName={trainedName}
                      data={data}
                      activeMetamagics={activeMetamagics}
                      onClick={() => setPicker({ spellLevel, slotIdx: i })}
                      onClear={() =>
                        trainedName && untrainSpell(cls.name, spellLevel, trainedName)
                      }
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <SpellPickerDialog
        open={picker !== null}
        spellLevel={picker?.spellLevel ?? null}
        availableSpells={picker
          ? (classSpellsByLevel.get(picker.spellLevel) ?? []).filter(s =>
              !(trained[String(picker.spellLevel)] ?? []).includes(s.name)
              || (trained[String(picker.spellLevel)] ?? [])[picker.slotIdx] === s.name)
          : []}
        onClose={() => setPicker(null)}
        onPick={(name) => {
          if (!picker) return;
          // Replace the slot if currently filled, otherwise just train.
          const cur = trained[String(picker.spellLevel)] ?? [];
          const existing = cur[picker.slotIdx];
          if (existing) untrainSpell(cls.name, picker.spellLevel, existing);
          trainSpell(cls.name, picker.spellLevel, name);
          setPicker(null);
        }}
      />
    </div>
  );
}

// ── Single slot tile ──────────────────────────────────────────────────

function SpellSlotTile({
  trainedName, data, activeMetamagics, onClick, onClear,
}: {
  trainedName?: string;
  data?: DDOSpellData;
  activeMetamagics: string[];
  onClick: () => void;
  onClear: () => void;
}) {
  if (!trainedName) {
    return (
      <button
        className={styles.slotEmpty}
        onClick={onClick}
        title="Click to train a spell"
      >+</button>
    );
  }
  // Tooltip combining school, school-DC info, applicable metamagics.
  const applicableMetamagics: string[] = [];
  if (data) {
    for (const { name, flag } of METAMAGICS) {
      if (!flag) continue;                                 // Eschew Materials etc. — not per-spell
      if (data.metamagic[flag] && activeMetamagics.includes(name)) {
        applicableMetamagics.push(name);
      }
    }
  }
  const titleParts: string[] = [trainedName];
  if (data?.school) titleParts.push(`School: ${data.school}`);
  if (data?.cost !== undefined) titleParts.push(`Cost: ${data.cost} SP`);
  if (data?.maxCasterLevel) titleParts.push(`Max CL: ${data.maxCasterLevel}`);
  if (applicableMetamagics.length) titleParts.push(`Active metamagics: ${applicableMetamagics.join(', ')}`);
  if (data?.description) titleParts.push('', data.description);
  return (
    <button
      className={styles.slotFilled}
      onClick={onClick}
      onContextMenu={e => { e.preventDefault(); onClear(); }}
      title={titleParts.join('\n')}
    >
      {data?.icon && (
        <img
          src={`/assets/images/SpellImages/${data.icon}.png`}
          alt=""
          className={styles.slotIcon}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <div className={styles.slotText}>
        <span className={styles.slotName}>{trainedName}</span>
        {data?.school && <span className={styles.slotSchool}>{data.school}</span>}
      </div>
    </button>
  );
}


// ── Stances & Mantles panel ─────────────────────────────────────────

function StancesPanel() {
  const r = useBreakdowns();
  const active = useBuildStore(s => s.build.activeStances);
  const setStances       = useBuildStore(s => s.setStances);
  // Use the stable EMPTY_METAMAGICS reference instead of an inline `?? []`
  // — a fresh `[]` each selector call would fail useSyncExternalStore's
  // Object.is equality check and force-rerender on every store snapshot,
  // looping forever.
  const activeMetamagics = useBuildStore(s => s.build.activeMetamagics ?? EMPTY_METAMAGICS);
  const toggleMetamagic  = useBuildStore(s => s.toggleMetamagic);
  // Use a stable empty array when the engine hasn't run yet — otherwise the
  // `?? []` fallback creates a new reference each render and the useMemos
  // below would re-run forever (per react-hooks/exhaustive-deps lint).
  const stances = useMemo(() => r?.availableStances ?? EMPTY_STANCES, [r]);

  // Group stances by `<Group>` text from the XML, with one override:
  // any stance whose name matches a known metamagic (from METAMAGICS)
  // is forced into the "Metamagics" bucket — that catches Eschew
  // Materials, whose source XML omits `<Group>` and would otherwise
  // land under "Other".
  const grouped = useMemo(() => {
    const byGroup = new Map<string, AvailableStance[]>();
    for (const s of stances) {
      const g = METAMAGIC_NAMES.has(s.data.name)
        ? METAMAGIC_GROUP
        : (s.data.group || 'Other');
      const list = byGroup.get(g) ?? [];
      list.push(s);
      byGroup.set(g, list);
    }
    return [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [stances]);

  // Build name → stance metadata index for incompat lookup on toggle.
  const stanceByName = useMemo(() => {
    const m = new Map<string, AvailableStance>();
    for (const s of stances) m.set(s.data.name, s);
    return m;
  }, [stances]);

  function toggle(name: string) {
    const isOn = active.includes(name);
    if (isOn) {
      setStances(active.filter(n => n !== name));
      return;
    }
    // Turn on: drop other stances in the same group + any explicit incompats.
    const target = stanceByName.get(name);
    const toDrop = new Set<string>();
    if (target) {
      // Other stances in the same Group (mutual exclusion within group).
      if (target.data.group) {
        for (const s of stances) {
          if (s.data.name !== name && s.data.group === target.data.group) {
            toDrop.add(s.data.name);
          }
        }
      }
      // Explicit IncompatibleStance list.
      for (const inc of target.data.incompatibleStances) toDrop.add(inc);
    }
    const next = active.filter(n => !toDrop.has(n));
    next.push(name);
    setStances(next);
  }

  if (!r) return <div className={styles.empty}>Loading…</div>;

  const activeStanceSet      = new Set(active);
  const activeMetamagicSet   = new Set(activeMetamagics);
  return (
    <div className={styles.stancesContainer}>
      {stances.length === 0 ? (
        <div className={styles.empty}>
          No stances or mantles available. Take a stance feat (Mountain
          Stance, Power Attack, etc.) or an enhancement / destiny that
          grants one.
        </div>
      ) : grouped.map(([group, list]) => {
        // Metamagics are multi-select and drive `build.activeMetamagics`
        // (the DPS calculator's input) instead of `activeStances`. The
        // mutual-exclusion logic in `toggle()` doesn't apply here — the
        // user can stack any combination of metamagics simultaneously.
        const isMetamagicGroup = group === METAMAGIC_GROUP;
        return (
          <section key={group} className={styles.stanceGroup}>
            <h4 className={styles.stanceGroupHeading}>{group}</h4>
            <div className={styles.stanceCards}>
              {list.map(s => {
                const on = isMetamagicGroup
                  ? activeMetamagicSet.has(s.data.name)
                  : activeStanceSet.has(s.data.name);
                const summary = stanceSummary(s.data.description, s.rank);
                const titleParts = [
                  s.rank > 1 ? `${s.data.name} ×${s.rank}` : s.data.name,
                ];
                if (s.data.description) titleParts.push('', s.data.description);
                titleParts.push('', `Source: ${s.source}`);
                if (s.data.incompatibleStances.length) {
                  titleParts.push(`Disables: ${s.data.incompatibleStances.join(', ')}`);
                }
                return (
                  <button
                    key={s.data.name}
                    type="button"
                    className={on ? styles.stanceCardOn : styles.stanceCardOff}
                    onClick={() => isMetamagicGroup
                      ? toggleMetamagic(s.data.name)
                      : toggle(s.data.name)
                    }
                    title={titleParts.join('\n')}
                  >
                    <StanceIcon icon={s.data.icon} />
                    <div className={styles.stanceCardBody}>
                      <span className={styles.stanceCardName}>
                        {s.data.name}
                        {s.rank > 1 && (
                          <span className={styles.stanceRankBadge}>×{s.rank}</span>
                        )}
                      </span>
                      {summary && (
                        <span className={styles.stanceCardSummary}>{summary}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Stance icons live across multiple folders depending on the granting source:
 *   - FeatImages (most monk stances, Power Attack, Combat Expertise, …)
 *   - EnhancementImages (Stalwart Defense, mantles, defensive stances)
 *   - SpellImages (some mantle / spell-style stances)
 *   - UIImages (a few system stances)
 * Try them in order; hide the img if none resolves.
 */
function StanceIcon({ icon }: { icon: string }) {
  if (!icon) return null;
  const FALLBACK_DIRS = ['FeatImages', 'EnhancementImages', 'SpellImages', 'UIImages'];
  return (
    <img
      src={`/assets/images/${FALLBACK_DIRS[0]}/${icon}.png`}
      alt=""
      className={styles.stanceIcon}
      data-fallback-idx="0"
      onError={e => {
        const img = e.currentTarget as HTMLImageElement & { dataset: DOMStringMap };
        const next = Number(img.dataset.fallbackIdx ?? '0') + 1;
        if (next < FALLBACK_DIRS.length) {
          img.dataset.fallbackIdx = String(next);
          img.src = `/assets/images/${FALLBACK_DIRS[next]}/${icon}.png`;
        } else {
          img.style.display = 'none';
        }
      }}
    />
  );
}

/** Extract a one-line summary of a stance's effects from its (often
 *  multi-line, prose-heavy) description. Strategy:
 *   1. Skip leading "<Stance> grants:" / "<Stance> mode:" preamble lines.
 *   2. Collapse `+[a/b/c/d] Stat` value tables — for past-life stances we
 *      use the user's actual `rank` (1-indexed) to pick the right tier;
 *      for non-stacking stances `rank=1` falls through to the highest tier.
 *   3. Stop at "at the cost of" / "while in" / "until you" trailing clauses.
 *  Falls back to the first non-empty line trimmed to ~140 chars. */
function stanceSummary(description: string, rank: number = 1): string {
  if (!description) return '';
  const lines = description.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';
  // Drop a leading "<Name> grants:" / "<Name>:" preamble line.
  const isPreamble = (l: string) =>
    /(?:grants?|provides?|gives?|allows?):?$/i.test(l) ||
    /^[A-Z][\w' ]+:$/.test(l);
  const start = isPreamble(lines[0]!) ? 1 : 0;
  const body = lines.slice(start).join(' ');
  // Collapse `[a/b/c]` tables. For past-life stances pick `rank-1`; for
  // ordinary tiered stances (no stacking source) the data lists per-toggle-
  // tier values and we want the highest, which is what rank=1 falls back
  // to via the Math.min clamp below.
  const collapsed = body.replace(/\[([^\]]+)\]/g, (_, inner: string) => {
    const parts = inner.split('/').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return inner;
    // Past-life stances: rank>1 means N stacks → take parts[rank-1].
    // Other stances: rank===1, take the highest (last) tier.
    const idx = rank > 1
      ? Math.min(rank - 1, parts.length - 1)
      : parts.length - 1;
    return parts[idx] ?? inner;
  });
  // Stop at "at the cost of" / "while in" / "until you" trailing clauses.
  const trimmed = collapsed
    .split(/(?:\bat the cost of\b|\bwhile in\b|\buntil you\b)/i)[0]!
    .trim();
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed;
}

// ── Self / Party Buffs panel ────────────────────────────────────────

// Module-level constant so the selector below returns a stable reference
// when activePartyBuffs is undefined — otherwise React's useSyncExternalStore
// sees a fresh `[]` snapshot every render and triggers an infinite update loop.
const EMPTY_BUFFS: readonly string[] = [];
const EMPTY_METAMAGICS: readonly string[] = [];
// Same trick for stances when the engine hasn't loaded yet — keeps useMemo
// dependency identity stable across renders.
const EMPTY_STANCES: readonly AvailableStance[] = [];

function PartyBuffsPanel() {
  const buffs = useGameDataStore(s => s.selfPartyBuffs);
  const active = useBuildStore(s => s.build.activePartyBuffs ?? EMPTY_BUFFS);
  const togglePartyBuff = useBuildStore(s => s.togglePartyBuff);
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);

  const lc = filter.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!lc) return buffs;
    return buffs.filter(b =>
      b.name.toLowerCase().includes(lc) ||
      b.description.toLowerCase().includes(lc));
  }, [buffs, lc]);

  const activeSet = new Set(active);
  // Default to "show active only" when not searching to keep the panel
  // approachable — there are 138 buffs in the catalog.
  const visible = showAll || lc
    ? filtered
    : filtered.filter(b => activeSet.has(b.name));

  if (buffs.length === 0) {
    return <div className={styles.empty}>Loading party buffs…</div>;
  }

  return (
    <div className={styles.partyBuffsContainer}>
      <div className={styles.partyBuffsToolbar}>
        <input
          type="search"
          className={styles.partyBuffsSearch}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={`Filter ${buffs.length} buffs (Bless, Haste, Recitation, …)`}
        />
        <span className={styles.partyBuffsCount}>{active.length} active</span>
        <button
          type="button"
          className={styles.partyBuffsLinkBtn}
          onClick={() => setShowAll(v => !v)}
        >
          {showAll ? 'show active only' : 'show all'}
        </button>
        {active.length > 0 && (
          <button
            type="button"
            className={styles.partyBuffsClearBtn}
            onClick={() => {
              for (const name of [...active]) togglePartyBuff(name);
            }}
            title="Turn off every active party buff"
          >
            clear all
          </button>
        )}
      </div>

      {visible.length === 0 && (
        <div className={styles.empty}>
          {lc
            ? `No buffs match "${filter}".`
            : 'No party buffs active. Click "show all" to browse the catalog.'}
        </div>
      )}

      <div className={styles.partyBuffsChips}>
        {visible.map(b => {
          const on = activeSet.has(b.name);
          return (
            <button
              key={b.name}
              type="button"
              className={on ? styles.partyBuffChipOn : styles.partyBuffChipOff}
              onClick={() => togglePartyBuff(b.name)}
              title={b.description}
            >
              {b.icon && (
                <img
                  src={`/assets/images/UIImages/${b.icon}.png`}
                  alt=""
                  className={styles.partyBuffIcon}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <span>{b.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
