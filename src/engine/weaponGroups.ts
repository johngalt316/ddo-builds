// Weapon group resolution for the engine's Weapon*Class effect family.
//
// `Weapon*Class` enhancement effects (WeaponDamageBonusClass,
// WeaponCriticalRangeClass, etc.) are class-restricted bonuses that fire
// only when the wielded weapon is in a specific group. The XML names the
// group via the effect's `<Item>` field (e.g. "Two Handed", "Sword",
// "Focus Weapon").
//
// Group membership has two sources:
//
//   1. **Static categories** — every weapon type belongs to a fixed set of
//      groups (Greatsword → Two Handed, Heavy Blades, Sword, Martial,
//      Slashing, Melee). Hardcoded in `STATIC_GROUPS` below; covers
//      every weapon in the items catalog.
//
//   2. **Dynamic groups** — built up from `AddGroupWeapon` effects in the
//      build's active enhancements / feats / class abilities. Each
//      `AddGroupWeapon` effect contributes to a named group; the first
//      `<Item>` is the group name, subsequent items are weapon types
//      added to that group. Examples:
//         - Kensei "Focus Weapon"           — whatever the player picked
//         - Bard "Swashbuckling"            — light blades, throwing
//         - Monk "Centered"                 — handwraps, kama, etc.
//         - Divine "Favored Weapon"         — deity-derived
//         - Race "Proficiency"              — racial bonus prof
//
// `weaponInGroup` answers "is this weapon in this group?" by consulting
// both sources.

/** Static map: weapon name (matching `gear.weapon` field) → groups it
 *  belongs to. Spelling matches the items catalog
 *  (`public/data/items/by-slot/Weapon1.json`). Group names match the
 *  values used in `<Item>` on Weapon*Class effects in tree XMLs. */
const STATIC_GROUPS: Record<string, readonly string[]> = {
  // ── Unarmed ─────────────────────────────────────────────────────────
  'Handwraps':                ['Unarmed', 'Light', 'Melee', 'Simple'],

  // ── One-handed simple ───────────────────────────────────────────────
  'Club':                     ['One Handed', 'Bludgeoning', 'Simple', 'Melee', 'Light'],
  'Dagger':                   ['One Handed', 'Piercing', 'Simple', 'Melee', 'Light', 'Thrown'],
  'Light Mace':               ['One Handed', 'Bludgeoning', 'Simple', 'Melee', 'Light'],
  'Heavy Mace':               ['One Handed', 'Bludgeoning', 'Simple', 'Melee'],
  'Morningstar':              ['One Handed', 'Bludgeoning', 'Simple', 'Melee'],
  'Sickle':                   ['One Handed', 'Slashing', 'Simple', 'Melee', 'Light'],
  'Light Hammer':             ['One Handed', 'Bludgeoning', 'Martial', 'Melee', 'Light', 'Thrown'],

  // ── One-handed martial ──────────────────────────────────────────────
  'Battle Axe':               ['One Handed', 'Slashing', 'Martial', 'Melee', 'Axe'],
  'Hand Axe':                 ['One Handed', 'Slashing', 'Martial', 'Melee', 'Light', 'Axe'],
  'Heavy Pick':               ['One Handed', 'Piercing', 'Martial', 'Melee'],
  'Light Pick':               ['One Handed', 'Piercing', 'Martial', 'Melee', 'Light'],
  'Longsword':                ['One Handed', 'Slashing', 'Martial', 'Melee', 'Sword', 'Heavy Blades'],
  'Rapier':                   ['One Handed', 'Piercing', 'Martial', 'Melee', 'Sword', 'Light Blades'],
  'Scimitar':                 ['One Handed', 'Slashing', 'Martial', 'Melee', 'Sword', 'Light Blades'],
  'Shortsword':               ['One Handed', 'Piercing', 'Martial', 'Melee', 'Sword', 'Light', 'Light Blades'],
  'Warhammer':                ['One Handed', 'Bludgeoning', 'Martial', 'Melee'],

  // ── One-handed exotic ───────────────────────────────────────────────
  'Bastard Sword':            ['One Handed', 'Slashing', 'Exotic', 'Melee', 'Sword', 'Heavy Blades'],
  'Dwarven Axe':              ['One Handed', 'Slashing', 'Exotic', 'Melee', 'Axe'],
  'Khopesh':                  ['One Handed', 'Slashing', 'Exotic', 'Melee', 'Sword'],
  'Kama':                     ['One Handed', 'Slashing', 'Exotic', 'Melee', 'Light'],
  'Kukri':                    ['One Handed', 'Slashing', 'Exotic', 'Melee', 'Light', 'Light Blades'],

  // ── Two-handed ──────────────────────────────────────────────────────
  'Quarterstaff':             ['Two Handed', 'Bludgeoning', 'Simple', 'Melee'],
  'Great Club':               ['Two Handed', 'Bludgeoning', 'Martial', 'Melee'],
  'Great Axe':                ['Two Handed', 'Slashing', 'Martial', 'Melee', 'Axe'],
  'Great Sword':              ['Two Handed', 'Slashing', 'Martial', 'Melee', 'Sword', 'Heavy Blades'],
  'Maul':                     ['Two Handed', 'Bludgeoning', 'Martial', 'Melee'],
  'Falchion':                 ['Two Handed', 'Slashing', 'Martial', 'Melee', 'Sword', 'Heavy Blades'],

  // ── Ranged: bows ────────────────────────────────────────────────────
  'Shortbow':                 ['Ranged', 'Simple', 'Bows', 'Bow', 'Two Handed', 'Piercing'],
  'Longbow':                  ['Ranged', 'Martial', 'Bows', 'Bow', 'Two Handed', 'Piercing'],

  // ── Ranged: crossbows ───────────────────────────────────────────────
  'Light Crossbow':           ['Ranged', 'Simple', 'Crossbow', 'Two Handed', 'Piercing'],
  'Heavy Crossbow':           ['Ranged', 'Simple', 'Crossbow', 'Two Handed', 'Piercing'],
  'Great Crossbow':           ['Ranged', 'Exotic', 'Crossbow', 'Two Handed', 'Piercing'],
  'Repeating Light Crossbow': ['Ranged', 'Exotic', 'Crossbow', 'RepeatingCrossbow', 'Two Handed', 'Piercing'],
  'Repeating Heavy Crossbow': ['Ranged', 'Exotic', 'Crossbow', 'RepeatingCrossbow', 'Two Handed', 'Piercing'],

  // ── Ranged: throwing ────────────────────────────────────────────────
  'Dart':                     ['Ranged', 'Thrown', 'Simple', 'Light', 'Piercing'],
  'Shuriken':                 ['Ranged', 'Thrown', 'Exotic', 'Light', 'Piercing'],
  'Throwing Axe':             ['Ranged', 'Thrown', 'Martial', 'Light', 'Slashing', 'Axe'],
  'Throwing Dagger':          ['Ranged', 'Thrown', 'Simple', 'Light', 'Piercing'],
  'Throwing Hammer':          ['Ranged', 'Thrown', 'Martial', 'Light', 'Bludgeoning'],

  // ── Off-hand-only ───────────────────────────────────────────────────
  'Orb':                      ['Orb'],
  'Rune Arm':                 ['Rune Arm'],
  'Collar':                   ['Collar'],
};

/** Static groups for the given weapon name. Empty list when unknown
 *  (defensive — most callers should still consult the dynamic map). */
export function staticGroupsFor(weaponType: string): readonly string[] {
  return STATIC_GROUPS[weaponType] ?? [];
}

/**
 * True when the wielded `weaponType` is in the named `groupName`. Checks
 * the static category map first, then falls back to the dynamic groups
 * built from `AddGroupWeapon` effects.
 *
 * The dynamic map's special "All" entry means "every weapon counts as
 * being in this group" — used by Cleric / Paladin "Favored Weapon"
 * enhancements that apply universally once granted.
 */
export function weaponInGroup(
  weaponType: string,
  groupName: string,
  dynamicGroups: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const staticHit = STATIC_GROUPS[weaponType]?.includes(groupName);
  if (staticHit) return true;
  const dyn = dynamicGroups.get(groupName);
  if (!dyn) return false;
  return dyn.has(weaponType) || dyn.has('All');
}
