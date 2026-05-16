import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useBuildStore, MAX_FILIGREE, MAX_ARTIFACT_FILIGREE } from '@/store/buildStore';
import { useGameDataStore } from '@/store/gameDataStore';
import { AugmentPickerDialog } from './AugmentPickerDialog';
import { FiligreePickerDialog } from './FiligreePickerDialog';
import { FindGearDialog } from './FindGearDialog';
import { SetBonusPill, SetBonusTooltip } from './SetBonusPill';
import { useHoverAnchor } from './useHoverAnchor';
import type { GearItem, GearSet, GearSlot, FiligreeSlot } from '@/types/build';
import type { DDOFiligreeData } from '@/types/ddoData';
import { formatBuffFriendly, formatRareBonus } from '@/utils/formatBuff';
import styles from './GearSection.module.css';

// Visual layout for the slot grid. 5 rows × 4 columns. `null` = empty cell
// (used to mirror the in-game paper-doll spacing).
const SLOT_LAYOUT: (GearSlot | null)[][] = [
  ['Goggles', 'Helmet',   'Necklace', 'Trinket'],
  ['Armor',   null,       null,       'Cloak'  ],
  ['Bracers', null,       null,       'Belt'   ],
  ['Ring1',   'Boots',    'Gloves',   'Ring2'  ],
  ['MainHand','OffHand',  'Quiver',   'Arrow'  ],
];

/** Map a build-side GearSlot → the canonical item slot tag used in items.json
 *  (and the FindGearDialog slot dropdown). MainHand/OffHand/Ring1/Ring2 use
 *  Weapon1/Weapon2/Ring on the item side. */
function slotToItemTag(slot: GearSlot): string {
  switch (slot) {
    case 'MainHand': return 'Weapon1';
    case 'OffHand':  return 'Weapon2';
    case 'Ring1':
    case 'Ring2':    return 'Ring';
    default:         return slot;
  }
}

export function GearSection() {
  const build              = useBuildStore(s => s.build);
  const setActiveGearSet   = useBuildStore(s => s.setActiveGearSet);
  const createGearSet      = useBuildStore(s => s.createGearSet);
  const renameGearSet      = useBuildStore(s => s.renameGearSet);
  const duplicateGearSet   = useBuildStore(s => s.duplicateGearSet);
  const deleteGearSet      = useBuildStore(s => s.deleteGearSet);
  const unequipItem        = useBuildStore(s => s.unequipItem);
  const setBonuses         = useGameDataStore(s => s.setBonuses);
  const itemSetIndex       = useGameDataStore(s => s.itemSetIndex);
  const augments           = useGameDataStore(s => s.augments);
  const [open, setOpen]    = useState(true);
  const [activeSetIdx, setActiveSetIdx] = useState(0);
  // Track which slot is selected for the details panel. We resolve to the
  // item from the (live) viewing set on each render so changes via the picker
  // immediately reflect in the panel.
  const [selectedSlot, setSelectedSlot] = useState<GearSlot | null>(null);
  const [augPicker, setAugPicker]       = useState<{
    itemSlot: GearSlot;
    augmentSlotIdx: number;
    slotType: string;
    itemMinLevel?: number;
  } | null>(null);
  // FindGearDialog state. When non-null, the dialog is open. `slotFilter` is
  // the canonical item-slot tag (e.g. "Helmet", "Weapon1") to pre-filter, or
  // undefined for the toolbar's "any" search.
  const [findOpen, setFindOpen] = useState<{ slotFilter?: string } | null>(null);
  const [filPicker, setFilPicker] = useState<{ target: 'weapon' | 'artifact'; slotIdx: number } | null>(null);

  const sets = build.gearSets;

  // Default to the build's active gear set on first render / when sets change.
  useMemo(() => {
    if (sets.length === 0) return;
    const idx = sets.findIndex(s => s.name === build.activeGearSet);
    if (idx >= 0) setActiveSetIdx(idx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build.activeGearSet, sets.length]);

  const viewingSet     = sets[activeSetIdx];
  const isViewingActive = viewingSet?.name === build.activeGearSet;

  // Surface active set bonuses for the viewing set. Mirrors the engine's
  // walkSetBonuses logic: count each item's distinct set memberships once,
  // combining item-tagged sets (item.setBonus / itemSetIndex fallback) with
  // augment-granted sets (Lost Purpose augments etc. — `augment.setBonus`).
  // Two augments granting the same set on one item count as 1 tick.
  const activeSetBonuses = useMemo(() => {
    const items = viewingSet?.items ?? [];
    const augSetByName = new Map<string, string>();
    for (const a of augments) {
      if (a.setBonus) augSetByName.set(a.name, a.setBonus);
    }
    const counts = new Map<string, number>();
    for (const it of items) {
      const setsOnItem = new Set<string>();
      const direct = it.setBonus ?? itemSetIndex[it.name];
      if (direct) setsOnItem.add(direct);
      for (const slot of it.augmentSlots ?? []) {
        if (!slot.selectedAugment) continue;
        const sb = augSetByName.get(slot.selectedAugment);
        if (sb) setsOnItem.add(sb);
      }
      for (const setName of setsOnItem) {
        counts.set(setName, (counts.get(setName) ?? 0) + 1);
      }
    }
    if (counts.size === 0) return [];
    const sbIdx = new Map(setBonuses.map(sb => [sb.type, sb]));
    return [...counts.entries()].map(([name, count]) => {
      const sb = sbIdx.get(name);
      const tiers = sb?.buffs.map(b => b.equippedCount).sort((a, b) => a - b) ?? [];
      const activeTier = [...tiers].reverse().find(t => t <= count) ?? 0;
      const nextTier   = tiers.find(t => t > count);
      return {
        name, count, activeTier, nextTier,
        knownInCatalog: !!sb,
        buffs: sb?.buffs ?? [],
      };
    }).sort((a, b) => b.count - a.count);
  }, [viewingSet, itemSetIndex, setBonuses, augments]);

  function handleNewSet() {
    const proposed = `Set ${sets.length + 1}`;
    const name = window.prompt('New gear set name:', proposed);
    if (name) createGearSet(name);
  }
  function handleRenameSet() {
    if (!viewingSet) return;
    const name = window.prompt('Rename gear set:', viewingSet.name);
    if (name) renameGearSet(viewingSet.name, name);
  }
  function handleDuplicateSet() {
    if (!viewingSet) return;
    const name = window.prompt('Copy gear set as:', `${viewingSet.name} (copy)`);
    if (name) duplicateGearSet(viewingSet.name, name);
  }
  function handleDeleteSet() {
    if (!viewingSet || sets.length <= 1) return;   // refuse to delete the last set
    if (!window.confirm(`Delete gear set "${viewingSet.name}"?`)) return;
    deleteGearSet(viewingSet.name);
    setActiveSetIdx(0);
    setSelectedSlot(null);
  }

  // Single-click: surface the slot's details (read-only).
  // Double-click: open Find Gear filtered to that slot (active set only).
  function handleSlotSelect(slot: GearSlot) {
    setSelectedSlot(slot);
  }
  function handleSlotEdit(slot: GearSlot) {
    if (!isViewingActive) return;
    setSelectedSlot(slot);
    setFindOpen({ slotFilter: slotToItemTag(slot) });
  }
  function handleSlotRemove(slot: GearSlot) {
    if (!isViewingActive) return;
    unequipItem(slot);
    if (selectedSlot === slot) setSelectedSlot(null);
  }

  // Resolve `selectedSlot` against the live viewing set so the details panel
  // re-renders when the user equips/changes the item in that slot.
  const selectedItem = selectedSlot
    ? (viewingSet?.items.find(it => it.slot === selectedSlot) ?? null)
    : null;

  return (
    <section className={styles.section}>
      <button
        className={styles.header}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className={open ? styles.chevronOpen : styles.chevron}>▸</span>
        <span className={styles.title}>Gear</span>
        {sets.length > 0 && (
          <span className={styles.count}>
            {sets.length} set{sets.length !== 1 ? 's' : ''}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.body}>
          {sets.length === 0 ? (
            <div className={styles.empty}>
              <p>No gear set yet. Double-click any slot to find an item, or import a .DDOBuild file.</p>
              <SlotGrid
                items={[]}
                onSlotSelect={() => { /* no-op: nothing to select yet */ }}
                onSlotEdit={(s) => setFindOpen({ slotFilter: slotToItemTag(s) })}
                selectedSlot={null}
              />
            </div>
          ) : (
            <>
              {/* Set selector tabs + CRUD toolbar */}
              <div className={styles.setBar}>
                <div className={styles.setTabs} role="tablist">
                  {sets.map((set, i) => {
                    const viewing = i === activeSetIdx;
                    return (
                      <button
                        key={i}
                        role="tab"
                        aria-selected={viewing}
                        className={viewing ? styles.setTabActive : styles.setTab}
                        onClick={() => {
                          setActiveSetIdx(i);
                          setSelectedSlot(null);
                          // The breakdowns and engine read `build.activeGearSet`,
                          // so making the clicked tab the active set keeps the
                          // stat panes and gear panel in sync.
                          if (set.name !== build.activeGearSet) setActiveGearSet(set.name);
                        }}
                        title="Switch to this gear set"
                      >
                        {set.name}
                      </button>
                    );
                  })}
                </div>
                <div className={styles.setActions}>
                  <button
                    className={styles.findBtn}
                    onClick={() => setFindOpen({})}
                    title="Search all items"
                    disabled={!isViewingActive}
                  >🔍 Find</button>
                  <button className={styles.setBtn} onClick={handleNewSet} title="New set">+</button>
                  <button className={styles.setBtn} onClick={handleRenameSet} title="Rename" disabled={!viewingSet}>✎</button>
                  <button className={styles.setBtn} onClick={handleDuplicateSet} title="Duplicate" disabled={!viewingSet}>⧉</button>
                  <button
                    className={styles.setBtnDanger}
                    onClick={handleDeleteSet}
                    title={sets.length <= 1 ? 'Cannot delete the last set' : 'Delete set'}
                    disabled={sets.length <= 1}
                  >✕</button>
                </div>
              </div>

              {/* Active set bonuses surfacing */}
              {activeSetBonuses.length > 0 && (
                <div className={styles.setBonusRow}>
                  {activeSetBonuses.map(sb => (
                    <SetBonusPill
                      key={sb.name}
                      name={sb.name}
                      count={sb.count}
                      variant={sb.activeTier > 0
                        ? 'active'
                        : sb.knownInCatalog ? 'pending' : 'unknown'}
                      buffs={sb.buffs}
                      unknownNote="Set name not in SetBonuses.xml"
                    />
                  ))}
                </div>
              )}

              <SlotGrid
                items={viewingSet?.items ?? []}
                onSlotSelect={handleSlotSelect}
                onSlotEdit={handleSlotEdit}
                onSlotRemove={isViewingActive ? handleSlotRemove : undefined}
                selectedSlot={selectedSlot}
              />

              {selectedItem && (
                <GearDetails
                  item={selectedItem}
                  editable={isViewingActive}
                  onEditAugment={(idx) => {
                    const aug = selectedItem.augmentSlots?.[idx];
                    if (!aug) return;
                    setAugPicker({
                      itemSlot: selectedItem.slot,
                      augmentSlotIdx: idx,
                      slotType: aug.slotType,
                      itemMinLevel: selectedItem.minLevel,
                    });
                  }}
                />
              )}

              {viewingSet && (
                <FiligreePanel
                  set={viewingSet}
                  editable={isViewingActive}
                  onPickSlot={(target, slotIdx) =>
                    setFilPicker({ target, slotIdx })
                  }
                />
              )}

              {!isViewingActive && viewingSet && (
                <div className={styles.viewingHint}>
                  Viewing <em>{viewingSet.name}</em> — read-only.{' '}
                  <button
                    className={styles.makeActiveBtn}
                    onClick={() => setActiveGearSet(viewingSet.name)}
                  >Make active to edit</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <AugmentPickerDialog
        open={augPicker !== null}
        itemSlot={augPicker?.itemSlot ?? null}
        augmentSlotIdx={augPicker?.augmentSlotIdx ?? null}
        slotType={augPicker?.slotType ?? null}
        itemMinLevel={augPicker?.itemMinLevel}
        onClose={() => setAugPicker(null)}
      />

      <FindGearDialog
        open={findOpen !== null}
        initialSlot={findOpen?.slotFilter}
        onClose={() => setFindOpen(null)}
      />

      <FiligreePickerDialog
        open={filPicker !== null}
        target={filPicker?.target ?? null}
        slotIdx={filPicker?.slotIdx ?? null}
        onClose={() => setFilPicker(null)}
      />
    </section>
  );
}

// ── Slot grid ─────────────────────────────────────────────────────

function SlotGrid({
  items, onSlotSelect, onSlotEdit, onSlotRemove, selectedSlot,
}: {
  items: GearItem[];
  onSlotSelect: (slot: GearSlot) => void;
  onSlotEdit: (slot: GearSlot) => void;
  onSlotRemove?: (slot: GearSlot) => void;
  selectedSlot: GearSlot | null;
}) {
  const itemBuffs = useGameDataStore(s => s.itemBuffs);
  const itemBySlot = useMemo(() => {
    const m = new Map<GearSlot, GearItem>();
    for (const it of items) m.set(it.slot, it);
    return m;
  }, [items]);

  return (
    <div className={styles.slotGrid}>
      {SLOT_LAYOUT.flat().map((slot, i) => {
        if (slot === null) {
          return <div key={`empty-${i}`} className={styles.slotSpacer} aria-hidden />;
        }
        const item = itemBySlot.get(slot);
        const selected = slot === selectedSlot;
        const buffSummary = item
          ? item.buffs.map(b => {
              const { headline, detail } = formatBuffFriendly(b, itemBuffs);
              return detail ? `${headline}: ${detail}` : headline;
            }).join('\n')
          : '';
        const titleHead = item
          ? `${item.name}${item.minLevel ? ` (Lv ${item.minLevel})` : ''}`
          : `${slot} — double-click to find an item`;
        const title = item
          ? `${titleHead}${buffSummary ? `\n\n${buffSummary}` : ''}\n\n(Double-click to replace)`
          : titleHead;
        return (
          <div key={slot} className={styles.slotWrapper}>
            <button
              className={[
                styles.slot,
                item ? styles.slotFilled : styles.slotEmpty,
                selected ? styles.slotSelected : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onSlotSelect(slot)}
              onDoubleClick={() => onSlotEdit(slot)}
              title={title}
            >
              <span className={styles.slotLabel}>{slot}</span>
              {item ? (
                <>
                  <img
                    src={`/assets/images/ItemImages/${item.icon}.png`}
                    alt=""
                    className={styles.slotIcon}
                    onError={e => {
                      const img = e.currentTarget;
                      img.src = '/assets/images/ItemImages/NoImage.png';
                    }}
                  />
                  <span className={styles.slotName}>{item.name}</span>
                </>
              ) : (
                <span className={styles.slotEmptyText}>+</span>
              )}
            </button>
            {item && onSlotRemove && (
              <button
                type="button"
                className={styles.slotRemove}
                onClick={e => { e.stopPropagation(); onSlotRemove(slot); }}
                title={`Remove ${item.name}`}
                aria-label={`Remove ${item.name}`}
              >×</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Item details panel ────────────────────────────────────────────

function GearDetails({
  item,
  editable,
  onEditAugment,
}: {
  item: GearItem;
  editable: boolean;
  onEditAugment: (augmentSlotIdx: number) => void;
}) {
  const itemBuffs = useGameDataStore(s => s.itemBuffs);
  const augments  = useGameDataStore(s => s.augments);
  const setBonuses = useGameDataStore(s => s.setBonuses);
  const augmentByName = useMemo(() => {
    const m = new Map<string, typeof augments[number]>();
    for (const a of augments) m.set(a.name, a);
    return m;
  }, [augments]);
  const setBonusByName = useMemo(() => {
    const m = new Map<string, typeof setBonuses[number]>();
    for (const s of setBonuses) m.set(s.type, s);
    return m;
  }, [setBonuses]);
  return (
    <div className={styles.details}>
      <div className={styles.detailsHeader}>
        <img
          src={`/assets/images/ItemImages/${item.icon}.png`}
          alt=""
          className={styles.detailsIcon}
          onError={e => { e.currentTarget.src = '/assets/images/ItemImages/NoImage.png'; }}
        />
        <div>
          <h3 className={styles.detailsName}>{item.name}</h3>
          <div className={styles.detailsMeta}>
            <span>{item.slot}</span>
            {item.minLevel && <span>Min Level {item.minLevel}</span>}
            {item.material && <span>{item.material}</span>}
            {item.setBonus && <span className={styles.setBonus}>Set: {item.setBonus}</span>}
          </div>
        </div>
      </div>

      {(item.augmentSlots?.length ?? 0) > 0 && (
        <div className={styles.augments}>
          <h4 className={styles.augmentsHeading}>Augments</h4>
          <div className={styles.augmentSlots}>
            {(item.augmentSlots ?? []).map((aug, i) => {
              const filled = !!aug.selectedAugment;
              const className = filled
                ? styles.augmentSlotFilled
                : editable
                  ? styles.augmentSlotEditable
                  : styles.augmentSlotEmpty;

              // Build a useful tooltip. For set-granting augments (Lost
              // Purpose etc.) show the set's tier breakdown so the user
              // can see what they actually get from this augment.
              let titleText: string;
              if (!filled) {
                titleText = editable
                  ? `Click to add a ${aug.slotType} augment`
                  : `Empty ${aug.slotType} slot`;
              } else {
                const augData = augmentByName.get(aug.selectedAugment!);
                const lines = [`${aug.slotType} — ${aug.selectedAugment}`];
                if (augData?.description) lines.push('', augData.description);
                if (augData?.setBonus) {
                  const sb = setBonusByName.get(augData.setBonus);
                  if (sb && sb.buffs.length > 0) {
                    lines.push('', `Set tiers — ${augData.setBonus}:`);
                    for (const b of [...sb.buffs].sort((a, z) => a.equippedCount - z.equippedCount)) {
                      const body = (b.description?.trim()) || '(no description)';
                      lines.push(`  ${b.equippedCount} pc — ${body}`);
                    }
                  }
                }
                if (editable) lines.push('', `Click to change ${aug.slotType} augment`);
                titleText = lines.join('\n');
              }

              return (
                <button
                  key={i}
                  className={className}
                  onClick={() => editable && onEditAugment(i)}
                  disabled={!editable}
                  title={titleText}
                >
                  <span className={styles.augmentSlotType}>{aug.slotType}</span>
                  <span className={styles.augmentSlotValue}>
                    {aug.selectedAugment ?? (editable ? '+' : '—')}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {item.description && <p className={styles.description}>{item.description}</p>}

      {item.buffs.length > 0 && (
        <div className={styles.buffs}>
          <h4 className={styles.buffsHeading}>Effects</h4>
          <ul className={styles.buffList}>
            {item.buffs.map((b, i) => {
              const { headline, detail } = formatBuffFriendly(b, itemBuffs);
              return (
                <li key={i} className={styles.buff}>
                  <strong className={styles.buffHeadline}>{headline}</strong>
                  {detail && <span className={styles.buffDetail}>: {detail}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {item.dropLocation && (
        <p className={styles.dropLocation}>
          <strong>Source:</strong> {item.dropLocation}
        </p>
      )}
    </div>
  );
}

// ── Filigree panel (sentient-weapon + artifact) ───────────────────

function FiligreePanel({
  set,
  editable,
  onPickSlot,
}: {
  set: GearSet;
  editable: boolean;
  onPickSlot: (target: 'weapon' | 'artifact', slotIdx: number) => void;
}) {
  const filigrees          = useGameDataStore(s => s.filigrees);
  const filigreeSetBonuses = useGameDataStore(s => s.filigreeSetBonuses);
  const setFiligreeRare    = useBuildStore(s => s.setFiligreeRare);
  const setFiligree        = useBuildStore(s => s.setFiligree);
  const clearFiligrees     = useBuildStore(s => s.clearFiligrees);

  const filIdx = useMemo(() => {
    const m = new Map<string, DDOFiligreeData>();
    for (const f of filigrees) m.set(f.name, f);
    return m;
  }, [filigrees]);

  // Count filigrees per set name (across both weapon + artifact slots) and
  // resolve each to its tier ladder for the surfacing pills below.
  const filigreeSetSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const slot of [...(set.filigrees ?? []), ...(set.artifactFiligrees ?? [])]) {
      if (!slot.name) continue;
      const f = filIdx.get(slot.name);
      if (!f?.setBonus) continue;
      counts.set(f.setBonus, (counts.get(f.setBonus) ?? 0) + 1);
    }
    if (counts.size === 0) return [];
    const sbIdx = new Map(filigreeSetBonuses.map(sb => [sb.name, sb]));
    return [...counts.entries()].map(([name, count]) => {
      const sb = sbIdx.get(name);
      const tiers = sb?.buffs.map(b => b.equippedCount).sort((a, b) => a - b) ?? [];
      const activeTier = [...tiers].reverse().find(t => t <= count) ?? 0;
      const nextTier   = tiers.find(t => t > count);
      return {
        name, count, activeTier, nextTier,
        knownInCatalog: !!sb,
        buffs: sb?.buffs ?? [],
      };
    }).sort((a, b) => b.count - a.count);
  }, [set.filigrees, set.artifactFiligrees, filIdx, filigreeSetBonuses]);

  const padTo = (list: FiligreeSlot[] | undefined, n: number): FiligreeSlot[] => {
    const out: FiligreeSlot[] = list ? [...list] : [];
    while (out.length < n) out.push({});
    return out.slice(0, n);
  };

  const weaponSlots   = padTo(set.filigrees, MAX_FILIGREE);
  const artifactSlots = padTo(set.artifactFiligrees, MAX_ARTIFACT_FILIGREE);

  // Index summary by set name so each tile's tooltip can show the live tier
  // ladder for its filigree's set.
  const summaryBySet = useMemo(() => {
    const m = new Map<string, typeof filigreeSetSummary[number]>();
    for (const sb of filigreeSetSummary) m.set(sb.name, sb);
    return m;
  }, [filigreeSetSummary]);

  function renderGrid(target: 'weapon' | 'artifact', slots: FiligreeSlot[]) {
    return (
      <div className={styles.filigreeGrid}>
        {slots.map((slot, i) => (
          <FiligreeSlotTile
            key={i}
            slot={slot}
            index={i}
            editable={editable}
            filigree={slot.name ? filIdx.get(slot.name) : undefined}
            setSummary={(() => {
              if (!slot.name) return undefined;
              const f = filIdx.get(slot.name);
              return f?.setBonus ? summaryBySet.get(f.setBonus) : undefined;
            })()}
            onPick={() => onPickSlot(target, i)}
            onToggleRare={() => setFiligreeRare(target, i, !slot.rare)}
            onRemove={() => setFiligree(target, i, null)}
          />
        ))}
      </div>
    );
  }

  const weaponCount   = weaponSlots.filter(s => s.name).length;
  const artifactCount = artifactSlots.filter(s => s.name).length;

  return (
    <>
      <div className={styles.filigreeSection}>
        <h4 className={styles.filigreeHeading}>
          <span>Sentient weapon filigrees</span>
          <span className={styles.filigreeCount}>{weaponCount} / {MAX_FILIGREE}</span>
          {editable && weaponCount > 0 && (
            <button
              type="button"
              className={styles.filigreeReset}
              onClick={() => clearFiligrees('weapon')}
              title="Clear all sentient weapon filigrees"
            >Reset</button>
          )}
        </h4>
        {renderGrid('weapon', weaponSlots)}
      </div>
      <div className={styles.filigreeSection}>
        <h4 className={styles.filigreeHeading}>
          <span>Artifact filigrees</span>
          <span className={styles.filigreeCount}>{artifactCount} / {MAX_ARTIFACT_FILIGREE}</span>
          {editable && artifactCount > 0 && (
            <button
              type="button"
              className={styles.filigreeReset}
              onClick={() => clearFiligrees('artifact')}
              title="Clear all artifact filigrees"
            >Reset</button>
          )}
        </h4>
        {renderGrid('artifact', artifactSlots)}
      </div>
      {filigreeSetSummary.length > 0 && (
        <div className={styles.filigreeSection}>
          <h4 className={styles.filigreeHeading}>
            <span>Filigree set bonuses</span>
          </h4>
          <div className={styles.setBonusRow}>
            {filigreeSetSummary.map(sb => (
              <SetBonusPill
                key={sb.name}
                name={sb.name}
                count={sb.count}
                variant={sb.activeTier > 0
                  ? 'active'
                  : sb.knownInCatalog ? 'pending' : 'unknown'}
                buffs={sb.buffs}
                unknownNote="Set name not in filigree set catalog"
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Filigree slot tile (one cell of the weapon/artifact grid) ─────

interface FiligreeSlotTileProps {
  slot: FiligreeSlot;
  index: number;
  editable: boolean;
  filigree?: DDOFiligreeData;
  setSummary?: {
    name: string;
    count: number;
    buffs: import('@/types/ddoData').DDOBuffBlock[];
    knownInCatalog: boolean;
  };
  onPick: () => void;
  onToggleRare: () => void;
  onRemove: () => void;
}

function FiligreeSlotTile({
  slot, index, editable, filigree, setSummary, onPick, onToggleRare, onRemove,
}: FiligreeSlotTileProps) {
  const filled = !!slot.name;
  // Every filigree has a rare version in the live game even when the local
  // XML data only lists the base effect — always offer the toggle on filled
  // slots so users can pick it.
  const rareBonus = filigree ? formatRareBonus(filigree.effects) : undefined;
  const displayName = filled
    ? slot.rare && rareBonus
      ? `${slot.name} (${rareBonus})`
      : slot.name
    : undefined;
  const { anchor, onMouseEnter, onMouseLeave } = useHoverAnchor();

  return (
    <div
      className={[
        styles.filigreeSlot,
        filled ? styles.filigreeSlotFilled : styles.filigreeSlotEmpty,
      ].join(' ')}
      onClick={() => editable && onPick()}
      onMouseEnter={filled && setSummary ? onMouseEnter : undefined}
      onMouseLeave={filled && setSummary ? onMouseLeave : undefined}
      role={editable ? 'button' : undefined}
      title={!filled
        ? (editable ? `Empty slot ${index + 1} — click to fill` : `Empty slot ${index + 1}`)
        : undefined}
    >
      <span className={styles.filigreeSlotIdx}>#{index + 1}</span>
      {filled ? (
        <>
          <span className={styles.filigreeSlotName}>{displayName}</span>
          {filigree?.setBonus && (
            <span className={styles.filigreeSlotSet}>{filigree.setBonus}</span>
          )}
          <button
            type="button"
            className={[
              styles.filigreeRareToggle,
              slot.rare ? styles.filigreeRareToggleOn : '',
            ].filter(Boolean).join(' ')}
            onClick={e => {
              e.stopPropagation();
              if (editable) onToggleRare();
            }}
            disabled={!editable}
            title={slot.rare
              ? `Rare bonus active${rareBonus ? `: ${rareBonus}` : ''} — click to disable`
              : `Click to apply rare bonus${rareBonus ? `: ${rareBonus}` : ''}`}
          >
            {slot.rare ? '★ Rare' : '☆ Rare'}
          </button>
          {editable && (
            <button
              type="button"
              className={styles.filigreeRemove}
              onClick={e => { e.stopPropagation(); onRemove(); }}
              title={`Remove ${slot.name}`}
              aria-label={`Remove ${slot.name}`}
            >×</button>
          )}
        </>
      ) : (
        <span className={styles.filigreeSlotName}>+</span>
      )}

      {anchor && setSummary && createPortal(
        <SetBonusTooltip
          anchor={anchor}
          name={setSummary.name}
          count={setSummary.count}
          buffs={setSummary.buffs}
          unknownNote={setSummary.knownInCatalog ? undefined : 'Set name not in filigree catalog'}
        />,
        document.body,
      )}
    </div>
  );
}
