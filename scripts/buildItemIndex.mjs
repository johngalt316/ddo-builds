// Reads all .item files from DDOBuilderV2/Output/DataFiles/Items/ and emits
// a sharded JSON catalog under public/data/items/:
//
//   public/data/items/index.json         — lightweight master list:
//                                            [{ name, slots[], minLevel, file }]
//   public/data/items/by-slot/<slot>.json — full ItemRecord[] per equipment slot
//   public/data/items/itemBuffs.json     — parsed ItemBuffs.xml as { type → BuffEntry }
//
// Design notes:
//   - Run manually after pulling DDOBuilderV2 updates: `npm run import-items`
//   - Output JSON is committed to the repo (~few MB total). Regenerating
//     every `npm run build` would be slow and unnecessary.
//   - Uses happy-dom for DOMParser, so we can share the Universal Effect
//     schema understanding. Pure Node + xml regex would be fragile across
//     8,477 hand-authored files.
//
// Item .item file schema (one Item per file):
//   <Items>
//     <Item>
//       <Name>...</Name>
//       <Icon>...</Icon>
//       <EquipmentSlot><Helmet/></EquipmentSlot>   (one or more child tags)
//       <Buff>...                                   (canonical buff catalog reference)
//       (weapon / armor specific fields)
//     </Item>
//   </Items>
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const HERE = dirname(fileURLToPath(import.meta.url));
const ITEMS_SRC   = resolve(HERE, '../../DDOBuilderV2/Output/DataFiles/Items');
const ITEMBUFFS_SRC = resolve(HERE, '../../DDOBuilderV2/Output/DataFiles/ItemBuffs.xml');
const OUT_DIR     = resolve(HERE, '../public/data/items');
const SLOT_DIR    = resolve(OUT_DIR, 'by-slot');

// ── Equipment slots ──────────────────────────────────────────────────────
// Known <EquipmentSlot> child tag names. Items can list multiple
// (a one-handed weapon goes in Weapon1 OR Weapon2).
//
// Note: rings use a single <Ring/> tag in source items (not Ring1/Ring2);
// the gear-set UI maps Ring items to either Ring1 or Ring2 slots.
const KNOWN_SLOTS = new Set([
  'Helmet','Necklace','Trinket','Cloak','Belt','Goggles',
  'Gloves','Boots','Bracers','Armor','Docent',
  'Weapon1','Weapon2','Quiver','Arrow','Ring',
]);

// ── Parsing helpers ──────────────────────────────────────────────────────

const window = new Window();
const DOMParser = window.DOMParser;

function parseXml(xml) {
  // Strip UTF-8 BOM that DDOBuilderV2 prepends to all its XML files.
  const clean = xml.charCodeAt(0) === 0xFEFF ? xml.slice(1) : xml;
  const doc = new DOMParser().parseFromString(clean, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('XML parse error');
  }
  return doc;
}

function directChildren(parent, tag) {
  const out = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n && n.nodeType === 1 && n.tagName === tag) out.push(n);
  }
  return out;
}

function firstChild(parent, tag) {
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n && n.nodeType === 1 && n.tagName === tag) return n;
  }
  return null;
}

function textOf(parent, tag) {
  const el = firstChild(parent, tag);
  return el?.textContent?.trim() ?? '';
}

function numOf(parent, tag) {
  const el = firstChild(parent, tag);
  if (!el) return undefined;
  const v = parseFloat(el.textContent?.trim() ?? '');
  return Number.isFinite(v) ? v : undefined;
}

function parseAmountText(raw) {
  if (!raw) return [];
  return raw.trim().split(/\s+/)
    .map(s => parseFloat(s))
    .filter(n => Number.isFinite(n));
}

function parseRequirement(el) {
  const value = numOf(el, 'Value');
  return {
    type: textOf(el, 'Type'),
    item: textOf(el, 'Item') || undefined,
    ...(value !== undefined ? { value } : {}),
  };
}

function parseRequirements(block) {
  if (!block) return undefined;
  const allOf = directChildren(block, 'Requirement').map(parseRequirement);
  const oneOf = directChildren(block, 'RequiresOneOf').map(g =>
    directChildren(g, 'Requirement').map(parseRequirement));
  const noneOf = directChildren(block, 'RequiresNoneOf').map(g =>
    directChildren(g, 'Requirement').map(parseRequirement));
  if (!allOf.length && !oneOf.length && !noneOf.length) return undefined;
  return { allOf, oneOf, noneOf };
}

function parseEffect(el) {
  const types = directChildren(el, 'Type').map(t => t.textContent?.trim()).filter(Boolean);
  const items = directChildren(el, 'Item').map(t => t.textContent?.trim()).filter(Boolean);
  const aType = textOf(el, 'AType') || undefined;
  const amountEl = firstChild(el, 'Amount');
  const amount = amountEl ? parseAmountText(amountEl.textContent ?? '') : [];
  const values = [];
  for (const k of ['Value1','Value2','Value3','Value4']) {
    const v = numOf(el, k);
    if (v !== undefined) values.push(v);
  }
  const out = { types };
  const bonus = textOf(el, 'Bonus');
  if (bonus) out.bonus = bonus;
  if (aType) out.amountType = aType;
  if (amount.length) out.amount = amount;
  if (items.length) out.items = items;
  if (values.length) out.values = values;
  const reqs = parseRequirements(firstChild(el, 'Requirements'));
  if (reqs) out.requirements = reqs;
  const dn = textOf(el, 'DisplayName');
  if (dn) out.displayName = dn;
  const desc = textOf(el, 'Description');
  if (desc) out.description = desc;
  if (firstChild(el, 'Percent') !== null) out.isPercent = true;
  if (firstChild(el, 'ApplyAsItemEffect') !== null) out.isApplyAsItemEffect = true;
  return out;
}

// ── Item-file <Buff> parser (REFERENCE TO ItemBuffs.xml) ─────────────────
// Note: items use a flat reference schema (Type + Value1 + BonusType + Item),
// NOT the canonical wrapped <Effect> schema. The reference resolves to a
// canonical buff template at runtime via itemBuffs.json.
function parseItemBuff(el) {
  const out = { type: textOf(el, 'Type') };
  const v1 = numOf(el, 'Value1');
  const v2 = numOf(el, 'Value2');
  const bt = textOf(el, 'BonusType');
  const it = textOf(el, 'Item');
  const desc = textOf(el, 'Description1');
  if (v1 !== undefined) out.value1 = v1;
  if (v2 !== undefined) out.value2 = v2;
  if (bt) out.bonusType = bt;
  if (it) out.item = it;
  if (desc) out.description = desc;
  // Items occasionally inline an <Effect> directly inside <Buff>; capture if present
  const effects = directChildren(el, 'Effect').map(parseEffect);
  if (effects.length) out.effects = effects;
  return out;
}

function parseEquipmentSlots(el) {
  const slotEl = firstChild(el, 'EquipmentSlot');
  if (!slotEl) return [];
  const slots = [];
  for (let i = 0; i < slotEl.childNodes.length; i++) {
    const n = slotEl.childNodes[i];
    if (!n || n.nodeType !== 1) continue;
    if (KNOWN_SLOTS.has(n.tagName)) slots.push(n.tagName);
  }
  return slots;
}

function parseAugmentSlots(itemEl) {
  // .item XML uses <ItemAugment><Type>…</Type></ItemAugment> for each slot
  // (NOT <Slot>). Each item can declare any number of these.
  return directChildren(itemEl, 'ItemAugment').map(s => {
    const out = { type: textOf(s, 'Type') };
    const desc = textOf(s, 'Description');
    if (desc) out.description = desc;
    return out;
  }).filter(s => s.type);
}

function parseBaseDice(itemEl) {
  const bd = firstChild(itemEl, 'BaseDice');
  if (!bd) return undefined;
  const number = numOf(bd, 'Number');
  const sides  = numOf(bd, 'Sides');
  if (number === undefined || sides === undefined) return undefined;
  return { number, sides };
}

function parseItem(itemEl) {
  const name = textOf(itemEl, 'Name');
  if (!name) return null;
  const slots = parseEquipmentSlots(itemEl);

  const out = {
    name,
    icon:  textOf(itemEl, 'Icon'),
    slots,
  };

  const desc = textOf(itemEl, 'Description');
  const drop = textOf(itemEl, 'DropLocation');
  const minL = numOf(itemEl, 'MinLevel');
  const maxL = numOf(itemEl, 'MaxLevel');
  if (desc) out.description = desc;
  if (drop) out.dropLocation = drop;
  if (minL !== undefined) out.minLevel = minL;
  if (maxL !== undefined) out.maxLevel = maxL;

  // Weapon fields
  const weapon = textOf(itemEl, 'Weapon');
  if (weapon) {
    out.weapon = weapon;
    const wd = numOf(itemEl, 'WeaponDamage');
    const cm = numOf(itemEl, 'CriticalMultiplier');
    const ct = numOf(itemEl, 'CriticalThreatRange');
    const am = textOf(itemEl, 'AttackModifier');
    const dm = textOf(itemEl, 'DamageModifier');
    if (wd !== undefined) out.weaponDamage = wd;
    if (cm !== undefined) out.criticalMultiplier = cm;
    if (ct !== undefined) out.criticalThreatRange = ct;
    if (am) out.attackModifier = am;
    if (dm) out.damageModifier = dm;
    const baseDice = parseBaseDice(itemEl);
    if (baseDice) out.baseDice = baseDice;
    const drBypass = directChildren(itemEl, 'DRBypass').map(d => d.textContent?.trim()).filter(Boolean);
    if (drBypass.length) out.drBypass = drBypass;
  }

  // Armor fields
  const armorType = textOf(itemEl, 'Armor');
  if (armorType) {
    const armor = { type: armorType };
    const ab  = numOf(itemEl, 'ArmorBonus');
    const mdb = numOf(itemEl, 'MaximumDexterityBonus');
    const acp = numOf(itemEl, 'ArmorCheckPenalty');
    const asf = numOf(itemEl, 'ArcaneSpellFailure');
    if (ab !== undefined) armor.ac = ab;
    if (mdb !== undefined) armor.mdb = mdb;
    if (acp !== undefined) armor.acp = acp;
    if (asf !== undefined) armor.asf = asf;
    out.armor = armor;
  }

  const mat = textOf(itemEl, 'Material');
  if (mat) out.material = mat;
  const sb  = textOf(itemEl, 'SetBonus');
  if (sb) out.setBonus = sb;

  const buffs = directChildren(itemEl, 'Buff').map(parseItemBuff);
  if (buffs.length) out.buffs = buffs;

  const augments = parseAugmentSlots(itemEl);
  if (augments.length) out.augmentSlots = augments;

  const reqs = parseRequirements(firstChild(itemEl, 'Requirements'));
  if (reqs) out.requirements = reqs;

  return out;
}

// ── ItemBuffs.xml parser (canonical buff catalog) ────────────────────────

function parseItemBuffsXml(xml) {
  const doc = parseXml(xml);
  const result = {};
  for (const buffEl of doc.querySelectorAll('Buff')) {
    const type = textOf(buffEl, 'Type');
    if (!type) continue;
    const entry = {
      type,
      displayText: textOf(buffEl, 'DisplayText'),
      effects: directChildren(buffEl, 'Effect').map(parseEffect),
    };
    if (firstChild(buffEl, 'ApplyToWeaponOnly')) entry.applyToWeaponOnly = true;
    const ignore = directChildren(buffEl, 'Ignore').map(t => t.textContent?.trim()).filter(Boolean);
    if (ignore.length) entry.ignore = ignore;
    result[type] = entry;
  }
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  console.log(`Reading items from ${ITEMS_SRC}…`);
  const files = readdirSync(ITEMS_SRC).filter(f => f.endsWith('.item'));
  console.log(`Found ${files.length} .item files.`);

  const allItems = [];
  const errors = [];
  let skippedCosmetic = 0;

  for (const file of files) {
    const path = resolve(ITEMS_SRC, file);
    try {
      const xml = readFileSync(path, 'utf8');
      const doc = parseXml(xml);
      const itemEls = doc.querySelectorAll('Item');
      for (const el of itemEls) {
        const item = parseItem(el);
        if (!item) continue;
        // Cosmetic-only items have no recognized equipment slot — they
        // can't affect a build, so they're useless for the calculator.
        if (item.slots.length === 0) {
          skippedCosmetic++;
          continue;
        }
        allItems.push({ ...item, _file: file });
      }
    } catch (e) {
      errors.push({ file, error: String(e) });
    }
  }

  console.log(`Parsed ${allItems.length} items (${errors.length} errors, ${skippedCosmetic} cosmetic skipped).`);
  if (errors.length) {
    for (const { file, error } of errors.slice(0, 10)) {
      console.warn(`  ${file}: ${error}`);
    }
    if (errors.length > 10) console.warn(`  …and ${errors.length - 10} more errors.`);
  }

  // Build per-slot shards
  mkdirSync(SLOT_DIR, { recursive: true });
  const bySlot = {};
  for (const item of allItems) {
    for (const slot of item.slots) {
      if (!bySlot[slot]) bySlot[slot] = [];
      bySlot[slot].push(item);
    }
  }
  for (const [slot, items] of Object.entries(bySlot)) {
    const path = resolve(SLOT_DIR, `${slot}.json`);
    writeFileSync(path, JSON.stringify(items, null, 0), 'utf8');
    console.log(`  ${slot}: ${items.length} items → ${path}`);
  }

  // Master index — lightweight, for search
  const index = allItems.map(i => ({
    name: i.name,
    slots: i.slots,
    minLevel: i.minLevel,
    setBonus: i.setBonus,
    icon: i.icon,
  }));
  writeFileSync(resolve(OUT_DIR, 'index.json'), JSON.stringify(index, null, 0), 'utf8');
  console.log(`Wrote master index: ${index.length} entries.`);

  // ItemBuffs.xml — canonical buff catalog
  console.log(`Parsing ItemBuffs.xml…`);
  const buffsXml = readFileSync(ITEMBUFFS_SRC, 'utf8');
  const itemBuffs = parseItemBuffsXml(buffsXml);
  writeFileSync(resolve(OUT_DIR, 'itemBuffs.json'), JSON.stringify(itemBuffs, null, 0), 'utf8');
  console.log(`Wrote itemBuffs: ${Object.keys(itemBuffs).length} buff types.`);

  // Stats summary
  const stats = {
    totalItems: allItems.length,
    bySlot: Object.fromEntries(Object.entries(bySlot).map(([k, v]) => [k, v.length])),
    itemBuffTypes: Object.keys(itemBuffs).length,
    parseErrors: errors.length,
    skippedCosmetic,
  };
  writeFileSync(resolve(OUT_DIR, 'stats.json'), JSON.stringify(stats, null, 2), 'utf8');
  console.log('Done.');
  console.log(JSON.stringify(stats, null, 2));
}

main();
