import { useEffect, useMemo, useState } from 'react';
import { useBuild } from '@/hooks/useBuild';
import { useGameDataStore } from '@/store/gameDataStore';
import { iconUrl } from '@/utils/ddoXmlParser';
import { passesRequirements } from '@/engine/evaluateEffect';
import { buildBuildContext } from '@/engine/collectEffects';
import type { DDOFeatData } from '@/types/ddoData';
import styles from './FeatPickerDialog.module.css';

// Acquire types we let users add manually. Automatic / past-life feats
// are handled elsewhere or driven by class data, so we hide them.
const SELECTABLE_ACQUIRE = new Set(['Train']);

interface Props {
  open: boolean;
  onClose: () => void;
  /** Existing slotIndex to replace (edit mode). Undefined → append a new slot. */
  editingSlotIndex?: number;
}

export function FeatPickerDialog({ open, onClose, editingSlotIndex }: Props) {
  const ub = useBuild();
  const gameData = useGameDataStore();
  const featIcons = useGameDataStore(s => s.featIcons);
  const [query, setQuery]     = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [showBlocked, setShowBlocked] = useState(false);

  // Build a temporary BuildContext for requirement evaluation.
  const ctx = useMemo(
    () => buildBuildContext({
      build: ub.build,
      classes: gameData.classes,
      effectiveScores: ub.effectiveScores as unknown as Record<string, number>,
      bab: ub.bab,
    }),
    [ub.build, gameData.classes, ub.effectiveScores, ub.bab],
  );

  // Discover all distinct feat groups for the filter dropdown.
  const allGroups = useMemo(() => {
    const s = new Set<string>();
    for (const f of gameData.feats) for (const g of f.groups) s.add(g);
    return [...s].sort();
  }, [gameData.feats]);

  // Already-selected feat names (excluding the slot we're editing) so we can
  // dim duplicates. DDO does allow some feats to be taken multiple times
  // (MaxTimesAcquire > 1) — surface that as a count limit.
  const featCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of ub.build.feats) {
      if (f.slotIndex === editingSlotIndex) continue;
      m.set(f.featId, (m.get(f.featId) ?? 0) + 1);
    }
    return m;
  }, [ub.build.feats, editingSlotIndex]);

  // Filter visible feats.
  const lowQuery = query.trim().toLowerCase();
  const visibleFeats = useMemo(() => {
    return gameData.feats
      .filter(f => SELECTABLE_ACQUIRE.has(f.acquire))
      .filter(f => !groupFilter || f.groups.includes(groupFilter))
      .filter(f =>
        !lowQuery
        || f.name.toLowerCase().includes(lowQuery)
        || f.description.toLowerCase().includes(lowQuery))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [gameData.feats, groupFilter, lowQuery]);

  // Close on Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function pick(feat: DDOFeatData) {
    const slotIndex = editingSlotIndex
      ?? ((ub.build.feats.length === 0)
            ? 0
            : Math.max(...ub.build.feats.map(f => f.slotIndex)) + 1);
    ub.addFeat({ slotIndex, featId: feat.name });
    onClose();
  }

  function gateInfo(feat: DDOFeatData): { ok: boolean; reason: string } {
    const ok = passesRequirements(feat.requirements, ctx);
    const limit = feat.maxTimesAcquire || 1;
    const taken = featCounts.get(feat.name) ?? 0;
    if (!ok) return { ok: false, reason: 'requirements not met' };
    if (taken >= limit) return { ok: false, reason: `already taken (max ${limit})` };
    return { ok: true, reason: '' };
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()} role="dialog" aria-label="Pick a feat">
        <div className={styles.header}>
          <h3>{editingSlotIndex !== undefined ? 'Replace feat' : 'Add feat'}</h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.controls}>
          <input
            type="search"
            className={styles.search}
            placeholder={`Search ${gameData.feats.length} feats…`}
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <select
            className={styles.groupFilter}
            value={groupFilter}
            onChange={e => setGroupFilter(e.target.value)}
            aria-label="Filter by group"
          >
            <option value="">All groups</option>
            {allGroups.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={showBlocked}
              onChange={e => setShowBlocked(e.target.checked)}
            />
            Show ineligible
          </label>
        </div>

        <div className={styles.list}>
          {visibleFeats.map(feat => {
            const gate = gateInfo(feat);
            if (!gate.ok && !showBlocked) return null;
            const iconKey = featIcons[feat.name.toLowerCase()] ?? feat.icon;
            const iconSrc = iconKey ? iconUrl(iconKey, 'Feat') : '';
            return (
              <button
                key={feat.name}
                className={gate.ok ? styles.featRow : styles.featRowBlocked}
                onClick={() => gate.ok && pick(feat)}
                disabled={!gate.ok}
                title={gate.ok ? feat.name : `${feat.name} — ${gate.reason}`}
              >
                {iconSrc
                  ? <img className={styles.featIcon} src={iconSrc} alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  : <div className={styles.featIconPlaceholder} />}
                <div className={styles.featBody}>
                  <div className={styles.featName}>{feat.name}</div>
                  {feat.description && (
                    <div className={styles.featDesc}>{feat.description.slice(0, 200)}{feat.description.length > 200 ? '…' : ''}</div>
                  )}
                  {!gate.ok && <div className={styles.gateMsg}>{gate.reason}</div>}
                </div>
              </button>
            );
          })}
          {visibleFeats.length === 0 && (
            <div className={styles.empty}>No feats match your filter.</div>
          )}
        </div>
      </div>
    </div>
  );
}
