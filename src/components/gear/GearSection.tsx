import { useState, useMemo } from 'react';
import { useBuildStore } from '@/store/buildStore';
import type { GearItem, GearSlot, GearSet } from '@/types/build';
import styles from './GearSection.module.css';

const SLOT_ORDER: GearSlot[] = [
  'Helmet','Goggles','Necklace','Trinket','Cloak',
  'Armor','Belt','Bracers','Gloves','Boots',
  'Ring1','Ring2','MainHand','OffHand','Quiver','Arrow',
];

export function GearSection() {
  const build         = useBuildStore(s => s.build);
  const [open, setOpen]               = useState(true);
  const [activeSetIdx, setActiveSetIdx] = useState(0);
  const [selectedItem, setSelectedItem] = useState<GearItem | null>(null);

  const sets = build.gearSets;

  // Default to the build's active gear set on first render
  useMemo(() => {
    if (sets.length === 0) return;
    const idx = sets.findIndex(s => s.name === build.activeGearSet);
    if (idx >= 0) setActiveSetIdx(idx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build.activeGearSet, sets.length]);

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
              No gear loaded. Import a .DDOBuild file to populate gear sets.
            </div>
          ) : (
            <>
              {/* Set selector tabs */}
              {sets.length > 1 && (
                <div className={styles.setTabs} role="tablist">
                  {sets.map((set, i) => (
                    <button
                      key={i}
                      role="tab"
                      aria-selected={i === activeSetIdx}
                      className={i === activeSetIdx ? styles.setTabActive : styles.setTab}
                      onClick={() => { setActiveSetIdx(i); setSelectedItem(null); }}
                    >
                      {set.name}
                      {set.name === build.activeGearSet && <span className={styles.activeBadge}>★</span>}
                    </button>
                  ))}
                </div>
              )}

              <GearGrid
                set={sets[activeSetIdx]!}
                selectedItem={selectedItem}
                onSelect={setSelectedItem}
              />

              {selectedItem && <GearDetails item={selectedItem} />}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ── Slot grid ─────────────────────────────────────────────────────

function GearGrid({
  set, selectedItem, onSelect,
}: {
  set: GearSet;
  selectedItem: GearItem | null;
  onSelect: (item: GearItem | null) => void;
}) {
  const itemBySlot = useMemo(() => {
    const m = new Map<GearSlot, GearItem>();
    for (const it of set.items) m.set(it.slot, it);
    return m;
  }, [set]);

  return (
    <div className={styles.slotGrid}>
      {SLOT_ORDER.map(slot => {
        const item = itemBySlot.get(slot);
        const selected = item && selectedItem?.name === item.name;
        return (
          <button
            key={slot}
            className={[
              styles.slot,
              item ? styles.slotFilled : styles.slotEmpty,
              selected ? styles.slotSelected : '',
            ].filter(Boolean).join(' ')}
            onClick={() => item && onSelect(selected ? null : item)}
            disabled={!item}
            title={item ? item.name : slot}
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
              <span className={styles.slotEmptyText}>—</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Item details panel ────────────────────────────────────────────

function GearDetails({ item }: { item: GearItem }) {
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

      {item.description && <p className={styles.description}>{item.description}</p>}

      {item.buffs.length > 0 && (
        <div className={styles.buffs}>
          <h4 className={styles.buffsHeading}>Effects</h4>
          <ul className={styles.buffList}>
            {item.buffs.map((b, i) => (
              <li key={i} className={styles.buff}>
                {b.bonusType && <span className={styles.buffBonus}>{b.bonusType}</span>}
                <span className={styles.buffType}>
                  {b.item ?? b.type}
                  {b.description1 && b.description1 !== b.item && ` (${b.description1})`}
                </span>
                {b.value1 !== undefined && (
                  <span className={styles.buffValue}>
                    {b.value1}{b.value2 !== undefined ? `–${b.value2}` : ''}
                  </span>
                )}
              </li>
            ))}
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
