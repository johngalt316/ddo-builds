// Phase 6.2 — Pick + order the "Active" subset of trained damaging spells.
//
// Trained spells (Spells tab) → Active set (this dialog, ordered by
// priority) → Rotation (timeline). The order in the active list IS the
// spell priority — the optimizer (6.6) and palette consume it in this
// order.
//
// Layout:
//   • Search + Select-all / Clear shortcuts on top.
//   • "Active · drag to reorder" section showing the ordered list with
//     drag handles, priority badge, and × to remove.
//   • "Available · click to add" section grouped by spell level for
//     fast browsing of the rest of the trained book.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AbilityCategory, AttackMode, MagicAbility } from '@/engine/dps/abilities';
import styles from './ManageActiveDialog.module.css';

interface Props {
  open: boolean;
  abilities: MagicAbility[];
  /** Current active priority list. Order = priority. */
  active: string[];
  onClose: () => void;
  onApply: (next: string[]) => void;
  /** Reset the draft to the top-N highest-DPC damaging abilities — wired
   *  by the parent so the same auto-seed logic that runs on first build
   *  load is re-runnable on demand. Hidden when not provided. */
  onResetToTop?: () => string[];
  /** Which attack type to show by default when the dialog opens.
   *  Matches the active Attack Type dropdown in the panel. */
  /** Which attack type to pre-select when the dialog opens. Boosts are
   *  always shown alongside any mode (they don't interrupt auto attacks). */
  defaultAttackMode?: AttackMode;
}

const TABS: { id: AbilityCategory; label: string }[] = [
  { id: 'damage',  label: 'Damage'  },
  { id: 'cc',      label: 'CC'      },
  { id: 'debuff',  label: 'Debuff'  },
  { id: 'heal',    label: 'Heals'   },
  { id: 'boost',   label: 'Boosts'  },
  { id: 'utility', label: 'Utility' },
];

export function ManageActiveDialog({ open, abilities, active, onClose, onApply, onResetToTop, defaultAttackMode }: Props) {
  // Working copy so the user can review changes before committing.
  const [draft, setDraft] = useState<string[]>(active);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<AbilityCategory>('damage');
  const [attackMode, setAttackMode] = useState<AttackMode>(defaultAttackMode ?? 'magic');
  // When true, charge-based abilities (per-rest SLAs / clickies with
  // limited charges) are visible in the Available list. Default ON so
  // action boosts and reaper boosts — which both share charge pools —
  // show up in the Boosts tab. Toggle off to hide one-shot consumables.
  const [includeCharged, setIncludeCharged] = useState(true);
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Re-init on open transition only — not on every parent re-render.
  useEffect(() => {
    if (open) {
      setDraft([...active]);
      setFilter('');
      setTab('damage');
      setIncludeCharged(true);
      setAttackMode(defaultAttackMode ?? 'magic');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Per-tab counts so the tab strip can show a quick "(N)" hint
  // for the inactive Available pool the user is browsing.
  // Boosts are always visible alongside any attack mode — they don't
  // interrupt auto attacks so they're relevant no matter what's active.
  function matchesMode(mode: AttackMode, abilityMode: AttackMode): boolean {
    if (abilityMode === 'boost') return true;          // boosts show in all modes
    if (mode === 'boost') return abilityMode === 'boost';
    return abilityMode === mode;
  }

  const inactiveCountsByTab = useMemo(() => {
    const draftSet = new Set(draft);
    const counts: Record<AbilityCategory, number> = {
      damage: 0, cc: 0, debuff: 0, heal: 0, boost: 0, utility: 0,
    };
    for (const a of abilities) {
      if (draftSet.has(a.id)) continue;
      if (!matchesMode(attackMode, a.attackMode)) continue;
      if (!includeCharged && a.charges > 0) continue;
      counts[a.category]++;
    }
    return counts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abilities, draft, includeCharged, attackMode]);

  const abilityById = useMemo(() => {
    const m = new Map<string, MagicAbility>();
    for (const a of abilities) m.set(a.id, a);
    return m;
  }, [abilities]);

  const draftSet = useMemo(() => new Set(draft), [draft]);

  // Inactive abilities filtered by current tab + charge toggle, then
  // split for the rendering pass below.
  const inactiveSections = useMemo(() => {
    const lc = filter.trim().toLowerCase();
    const filtered = abilities.filter(a => {
      if (draftSet.has(a.id)) return false;
      if (!matchesMode(attackMode, a.attackMode)) return false;
      if (a.category !== tab) return false;
      if (!includeCharged && a.charges > 0) return false;
      if (!lc) return true;
      return a.name.toLowerCase().includes(lc)
          || a.school.toLowerCase().includes(lc)
          || (a.slaSource?.toLowerCase().includes(lc) ?? false);
    });
    // Class spells (in the Damage / Heals tab) group by spell level.
    // SLA-style entries (Boosts tab + any SLA-sourced damage/heal) get
    // a single combined section so the user doesn't see one-row
    // "Spell-Like Abilities" headers.
    const byLevel = new Map<number, MagicAbility[]>();
    const slaList: MagicAbility[] = [];
    for (const a of filtered) {
      if (a.source === 'sla') {
        slaList.push(a);
        continue;
      }
      const lvl = a.spellLevel ?? 0;
      const list = byLevel.get(lvl) ?? [];
      list.push(a);
      byLevel.set(lvl, list);
    }
    return {
      levels: [...byLevel.entries()].sort(([a], [b]) => a - b),
      slas: slaList,
    };
  }, [abilities, draftSet, filter, tab, includeCharged]);

  // Resolved active list — drops ids whose ability is no longer trained.
  const activeResolved = useMemo(() => {
    const lc = filter.trim().toLowerCase();
    return draft.flatMap(id => {
      const a = abilityById.get(id);
      if (!a) return [];
      if (!matchesMode(attackMode, a.attackMode)) return [];
      if (lc && !a.name.toLowerCase().includes(lc) && !a.school.toLowerCase().includes(lc)) {
        return [];
      }
      return [a];
    });
  }, [draft, abilityById, filter, attackMode]);

  if (!open) return null;

  function add(id: string) {
    setDraft(prev => prev.includes(id) ? prev : [...prev, id]);
  }
  function remove(id: string) {
    setDraft(prev => prev.filter(x => x !== id));
  }
  function reorder(from: number, to: number) {
    if (from === to) return;
    setDraft(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return prev;
      next.splice(to, 0, moved);
      return next;
    });
  }
  function selectAll() {
    // Keep the order of any already-active picks; append the rest in catalog
    // order so first-time users get a sensible priority cycle.
    const present = new Set(draft);
    const rest = abilities.filter(a => !present.has(a.id)).map(a => a.id);
    setDraft([...draft, ...rest]);
  }
  function clearAll() {
    setDraft([]);
  }
  function apply() {
    onApply(draft);
    onClose();
  }

  function onDragStart(e: React.DragEvent<HTMLDivElement>, idx: number) {
    dragFrom.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }
  function onDragOver(e: React.DragEvent<HTMLDivElement>, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== idx) setDragOver(idx);
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>, idx: number) {
    e.preventDefault();
    const from = dragFrom.current;
    dragFrom.current = null;
    setDragOver(null);
    if (from === null || from === idx) return;
    reorder(from, idx);
  }
  function onDragEnd() {
    dragFrom.current = null;
    setDragOver(null);
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-label="Manage active spells"
        onClick={e => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h3 className={styles.title}>Manage Rotation</h3>
          <span className={styles.count}>
            {draft.length} of {abilities.length} active
          </span>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className={styles.toolbar}>
          <select
            className={styles.modeSelect}
            value={attackMode}
            onChange={e => setAttackMode(e.target.value as AttackMode)}
            aria-label="Attack type filter"
            title="Filter abilities by attack type"
          >
            <option value="magic">Magic</option>
            <option value="melee">Melee</option>
            <option value="ranged">Ranged</option>
            <option value="boost">Boosts only</option>
          </select>
          <input
            type="search"
            className={styles.search}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter by name or school"
            autoFocus
          />
          <button type="button" className={styles.linkBtn} onClick={selectAll}>Select all</button>
          <button type="button" className={styles.linkBtn} onClick={clearAll}>Clear</button>
          {onResetToTop && (
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => setDraft(onResetToTop())}
              title="Replace the active list with the top-10 highest-DPC damage abilities"
            >Top 10</button>
          )}
        </div>

        <div className={styles.body}>
          <section className={styles.section}>
            <h4 className={styles.sectionHeading}>
              Active · drag to reorder priority
            </h4>
            {activeResolved.length === 0 ? (
              <div className={styles.empty}>
                {draft.length === 0
                  ? 'No spells active yet. Click an entry below to add it to the priority list.'
                  : `No active spells match "${filter}".`}
              </div>
            ) : (
              <div className={styles.activeList}>
                {activeResolved.map((a, i) => (
                  <div
                    key={a.id}
                    draggable
                    onDragStart={e => onDragStart(e, i)}
                    onDragOver={e => onDragOver(e, i)}
                    onDrop={e => onDrop(e, i)}
                    onDragEnd={onDragEnd}
                    className={[
                      styles.activeRow,
                      dragOver === i ? styles.activeRowDragOver : '',
                    ].filter(Boolean).join(' ')}
                    title="Drag to reorder priority"
                  >
                    <span className={styles.dragHandle} aria-hidden="true">⋮⋮</span>
                    <span className={styles.priorityBadge}>#{i + 1}</span>
                    {a.icon && (
                      <img
                        src={`/assets/images/SpellImages/${a.icon}.png`}
                        alt=""
                        className={styles.rowIcon}
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <span className={styles.rowName}>
                      {a.displayName}
                      {a.placeholderDamage && (
                        <span className={styles.placeholderTag} title="Damage rolls not yet modeled — value is a placeholder.">
                          ⚠ TODO
                        </span>
                      )}
                    </span>
                    <span className={styles.rowMeta}>
                      {a.source === 'spell'
                        ? <span>L{a.spellLevel}</span>
                        : <span>SLA</span>}
                      {a.school && (<><span>·</span><span>{a.school}</span></>)}
                      {(a.costBreakdown?.total ?? a.cost) > 0 && (
                        <><span>·</span><span>{a.costBreakdown?.total ?? a.cost} SP</span></>
                      )}
                      {a.cooldown > 0 && (<><span>·</span><span>{a.cooldown}s CD</span></>)}
                      {a.charges > 0 && (<><span>·</span><span>{a.charges}× /rest</span></>)}
                    </span>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => remove(a.id)}
                      aria-label={`Remove ${a.displayName} from active`}
                      title={`Remove ${a.displayName}`}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.availableHeader}>
              <h4 className={styles.sectionHeading}>Available · click to add</h4>
              <label className={styles.chargedToggle} title="Per-rest charges (e.g. Reaper Boosts) consume a charge each cast">
                <input
                  type="checkbox"
                  checked={includeCharged}
                  onChange={e => setIncludeCharged(e.target.checked)}
                />
                Show charge-limited abilities
              </label>
            </div>
            <div className={styles.tabStrip} role="tablist" aria-label="Filter by category">
              {TABS.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={tab === t.id ? styles.tabActive : styles.tab}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  {inactiveCountsByTab[t.id] > 0 && (
                    <span className={styles.tabCount}> ({inactiveCountsByTab[t.id]})</span>
                  )}
                </button>
              ))}
            </div>
            {inactiveSections.levels.length === 0 && inactiveSections.slas.length === 0 ? (
              <div className={styles.empty}>
                {abilities.length === 0
                  ? 'No damaging spells trained or SLAs granted. Train spells in the Spells tab first.'
                  : filter
                    ? `No matches for "${filter}" in ${tab}.`
                    : `No ${tab} abilities left to add${!includeCharged ? ' (try enabling charge-limited)' : ''}.`}
              </div>
            ) : (
              <>
                {inactiveSections.levels.map(([level, list]) => (
                  <div key={`L${level}`} className={styles.group}>
                    <h5 className={styles.groupHeading}>Level {level}</h5>
                    <div className={styles.rows}>
                      {list.map(a => renderAddRow(a, add))}
                    </div>
                  </div>
                ))}
                {inactiveSections.slas.length > 0 && (
                  <div className={styles.group}>
                    <h5 className={styles.groupHeading}>
                      {tab === 'boost' ? 'Boosts & Clickies' : 'Spell-Like Abilities'}
                    </h5>
                    <div className={styles.rows}>
                      {inactiveSections.slas.map(a => renderAddRow(a, add))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.applyBtn} onClick={apply}>Apply</button>
        </footer>
      </div>
    </div>
  );
}

function renderAddRow(a: MagicAbility, add: (id: string) => void) {
  return (
    <button
      key={a.id}
      type="button"
      className={styles.addRow}
      onClick={() => add(a.id)}
      title={[
        `Add ${a.displayName} to active priority`,
        a.source === 'sla' && a.slaSource ? `Source: ${a.slaSource}` : '',
        a.placeholderDamage
          ? 'Damage values not yet modeled — placeholder; rotation DPS will read 0 until rolls are added.'
          : '',
      ].filter(Boolean).join('\n')}
    >
      <span className={styles.addIcon} aria-hidden="true">+</span>
      {a.icon && (
        <img
          src={`/assets/images/SpellImages/${a.icon}.png`}
          alt=""
          className={styles.rowIcon}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <span className={styles.rowName}>
        {a.displayName}
        {a.placeholderDamage && (
          <span className={styles.placeholderTag} title="Damage rolls not yet modeled — value is a placeholder.">
            ⚠ TODO
          </span>
        )}
      </span>
      <span className={styles.rowMeta}>
        {(() => {
          const segs: ReactNode[] = [];
          if (a.source === 'sla' && a.slaSource) {
            segs.push(<span key="src" className={styles.slaSource} title={a.slaSource}>{a.slaSource}</span>);
          }
          if (a.school)        segs.push(<span key="sch">{a.school}</span>);
          {
            const cost = a.costBreakdown?.total ?? a.cost;
            if (cost > 0) segs.push(<span key="sp">{cost} SP</span>);
          }
          if (a.cooldown > 0)  segs.push(<span key="cd">{a.cooldown}s CD</span>);
          if (a.charges > 0)   segs.push(<span key="ch" title={`${a.charges} charges per rest`}>{a.charges}× /rest</span>);
          return segs.flatMap((s, i) =>
            i === 0 ? [s] : [<span key={`sep${i}`}>·</span>, s]
          );
        })()}
      </span>
    </button>
  );
}
