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

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MagicAbility } from '@/engine/dps/abilities';
import styles from './ManageActiveDialog.module.css';

interface Props {
  open: boolean;
  abilities: MagicAbility[];
  /** Current active priority list. Order = priority. */
  active: string[];
  onClose: () => void;
  onApply: (next: string[]) => void;
}

export function ManageActiveDialog({ open, abilities, active, onClose, onApply }: Props) {
  // Working copy so the user can review changes before committing.
  const [draft, setDraft] = useState<string[]>(active);
  const [filter, setFilter] = useState('');
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setDraft([...active]);
      setFilter('');
    }
  }, [open, active]);

  const abilityById = useMemo(() => {
    const m = new Map<string, MagicAbility>();
    for (const a of abilities) m.set(a.id, a);
    return m;
  }, [abilities]);

  const draftSet = useMemo(() => new Set(draft), [draft]);

  // Inactive abilities split into class spells (by level) + SLAs (by category).
  const inactiveSections = useMemo(() => {
    const lc = filter.trim().toLowerCase();
    const filtered = abilities.filter(a => {
      if (draftSet.has(a.id)) return false;
      if (!lc) return true;
      return a.name.toLowerCase().includes(lc)
          || a.school.toLowerCase().includes(lc)
          || (a.slaSource?.toLowerCase().includes(lc) ?? false);
    });
    // Class spells grouped by spell level.
    const byLevel = new Map<number, MagicAbility[]>();
    // SLAs grouped under one section regardless of category.
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
  }, [abilities, draftSet, filter]);

  // Resolved active list — drops ids whose ability is no longer trained.
  const activeResolved = useMemo(() => {
    const lc = filter.trim().toLowerCase();
    return draft.flatMap(id => {
      const a = abilityById.get(id);
      if (!a) return [];
      if (lc && !a.name.toLowerCase().includes(lc) && !a.school.toLowerCase().includes(lc)) {
        return [];
      }
      return [a];
    });
  }, [draft, abilityById, filter]);

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
          <h3 className={styles.title}>Manage Active Spells</h3>
          <span className={styles.count}>
            {draft.length} of {abilities.length} active
          </span>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className={styles.toolbar}>
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
                    <span className={styles.rowName}>{a.displayName}</span>
                    <span className={styles.rowMeta}>
                      {a.source === 'spell'
                        ? <span>L{a.spellLevel}</span>
                        : <span>SLA</span>}
                      <span>·</span>
                      <span>{a.school}</span>
                      <span>·</span>
                      <span>{a.cost} SP</span>
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
            <h4 className={styles.sectionHeading}>Available · click to add</h4>
            {inactiveSections.levels.length === 0 && inactiveSections.slas.length === 0 ? (
              <div className={styles.empty}>
                {abilities.length === 0
                  ? 'No damaging spells trained or SLAs granted. Train spells in the Spells tab first.'
                  : filter
                    ? `No matches for "${filter}".`
                    : 'Every available ability is in the active list.'}
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
                    <h5 className={styles.groupHeading}>Spell-Like Abilities</h5>
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
      <span className={styles.rowName}>{a.displayName}</span>
      <span className={styles.rowMeta}>
        {a.source === 'sla' && a.slaSource && (
          <>
            <span className={styles.slaSource} title={a.slaSource}>{a.slaSource}</span>
            <span>·</span>
          </>
        )}
        <span>{a.school}</span>
        <span>·</span>
        <span>{a.cost} SP</span>
        {a.cooldown > 0 && (<><span>·</span><span>{a.cooldown}s CD</span></>)}
      </span>
    </button>
  );
}
