import { create } from 'zustand';
import type {
  DDOClassData, DDORaceData, DDOFeatData, EnhancementTreeData,
  DDOBonusType, DDOStanceData, DDOWeaponGroup, DDOSetBonusData,
  DDOAugmentData,
  DDOFiligreeData,
  DDOFiligreeSetBonus,
  DDOSpellData,
  DDOOptionalBuff,
  DDOGuildBuff,
  DDOMetamagicData,
  ItemBuffCatalog,
} from '@/types/ddoData';
import {
  parseClassXml,
  parseRaceXml,
  parseFeatsXml,
  parseEnhancementTreeXml,
  parseFeatIcons,
  parseBonusTypesXml,
  parseStancesXml,
  parseWeaponGroupsXml,
  parseSetBonusesXml,
  parseAugmentsXml,
  parseFiligreesXml,
  parseSpellsXml,
  parseSelfPartyBuffsXml,
  parseGuildBuffsXml,
  parseMetamagicsXml,
} from '@/utils/ddoXmlParser';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface GameDataState {
  status: LoadStatus;
  error: string | null;
  classes: DDOClassData[];
  races: DDORaceData[];
  feats: DDOFeatData[];
  enhancementTrees: EnhancementTreeData[];
  // Phase 1 additions — Phase 2 engine prerequisites
  bonusTypes: DDOBonusType[];
  stances: DDOStanceData[];
  weaponGroups: DDOWeaponGroup[];
  setBonuses: DDOSetBonusData[];
  /** Canonical item-buff template catalog (Phase 1 preprocess output). */
  itemBuffs: ItemBuffCatalog;
  /** All augment definitions (Ruby of X, Topaz of Y, etc.) — used by the gear augment picker. */
  augments: DDOAugmentData[];
  /** All filigree definitions (sentient weapon / artifact filigrees). */
  filigrees: DDOFiligreeData[];
  /** Filigree set bonuses (one per set, tiered buffs). */
  filigreeSetBonuses: DDOFiligreeSetBonus[];
  /** Global spell catalog from Spells.xml. Class linkage lives on each
   *  DDOClassData.spells (joined by spell name). */
  spells: DDOSpellData[];
  /** Toggleable self/party buffs from SelfAndPartyBuffs.xml. */
  selfPartyBuffs: DDOOptionalBuff[];
  /** Guild buffs from GuildBuffs.xml — auto-applied based on build.guildLevel. */
  guildBuffs: DDOGuildBuff[];
  /** Metamagic catalog from Metamagics.xml — base SP cost + eligibility
   *  flag + cost-reduction effect type per metamagic. Used by the DPS
   *  engine to compute per-cast SP surcharge. */
  metamagics: DDOMetamagicData[];
  /**
   * Item name → set name lookup, derived from public/data/items/index.json.
   * .DDOBuild files often omit `<SetBonus>` even for items that belong to a
   * set, so the engine uses this as a fallback during set-bonus counting.
   */
  itemSetIndex: Record<string, string>;
  /** Comprehensive lowercased feat-name → icon-name map built from ALL data sources */
  featIcons: Record<string, string>;
  loadGameData: () => Promise<void>;
  getClass: (name: string) => DDOClassData | undefined;
  getRace: (name: string) => DDORaceData | undefined;
  getBonusType: (name: string) => DDOBonusType | undefined;
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function loadMany<T>(
  urls: string[],
  parse: (xml: string) => T | null,
): Promise<T[]> {
  const results = await Promise.all(
    urls.map(url => fetchXml(url).then(xml => (xml ? parse(xml) : null))),
  );
  return results.filter(Boolean) as T[];
}

export const useGameDataStore = create<GameDataState>((set, get) => ({
  status: 'idle',
  error: null,
  classes: [],
  races: [],
  feats: [],
  enhancementTrees: [],
  bonusTypes: [],
  stances: [],
  weaponGroups: [],
  setBonuses: [],
  itemBuffs: {},
  itemSetIndex: {},
  augments: [],
  filigrees: [],
  filigreeSetBonuses: [],
  spells: [],
  selfPartyBuffs: [],
  guildBuffs: [],
  metamagics: [],
  featIcons: {},

  loadGameData: async () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });

    try {
      const [
        classManifest, raceManifest, featsXml, treeListRes,
        bonusTypesXml, stancesXml, weaponGroupsXml, setBonusesXml,
        itemBuffsJson, itemIndexJson, augmentManifest, filigreeManifest, spellsXml,
        selfPartyBuffsXml,
        guildBuffsXml,
        metamagicsXml,
      ] = await Promise.all([
        fetchXml('/data/classes.json'),
        fetchXml('/data/races.json'),
        fetchXml('/data/Feats.xml'),
        fetchXml('/data/enhancementTrees.json'),
        fetchXml('/data/BonusTypes.xml'),
        fetchXml('/data/Stances.xml'),
        fetchXml('/data/WeaponGroupings.xml'),
        fetchXml('/data/SetBonuses.xml'),
        fetchXml('/data/items/itemBuffs.json'),
        fetchXml('/data/items/index.json'),
        fetchXml('/data/augments.json'),
        fetchXml('/data/filigreeSets.json'),
        fetchXml('/data/Spells.xml'),
        fetchXml('/data/SelfAndPartyBuffs.xml'),
        fetchXml('/data/GuildBuffs.xml'),
        fetchXml('/data/Metamagics.xml'),
      ]);

      const classFiles: string[] = classManifest ? (JSON.parse(classManifest) as string[]) : [];
      const raceFiles:  string[] = raceManifest  ? (JSON.parse(raceManifest)  as string[]) : [];
      const classUrls  = classFiles.map(f => `/data/Classes/${f}`);
      const raceUrls   = raceFiles.map(f  => `/data/Races/${f}`);

      // Fetch class and race XML once; reuse for both data parsing and icon extraction
      const [classXmls, raceXmls] = await Promise.all([
        Promise.all(classUrls.map(fetchXml)),
        Promise.all(raceUrls.map(fetchXml)),
      ]);

      const classes = classXmls
        .map(xml => (xml ? parseClassXml(xml) : null))
        .filter((c): c is DDOClassData => c !== null);

      const races = raceXmls
        .map(xml => (xml ? parseRaceXml(xml) : null))
        .filter((r): r is DDORaceData => r !== null);

      // Merge feat definitions from Feats.xml + every class XML + every race XML.
      // Class XMLs (Epic, ArcaneTrickster, …) define class-specific feats
      // (Past Life, Arcane Pulse, …) that aren't in the main Feats.xml.
      // First definition wins (Feats.xml is most authoritative).
      const featByName = new Map<string, DDOFeatData>();
      const featSources = [featsXml, ...classXmls, ...raceXmls].filter((s): s is string => !!s);
      for (const xml of featSources) {
        for (const f of parseFeatsXml(xml)) {
          const key = f.name.toLowerCase();
          if (!featByName.has(key)) featByName.set(key, f);
        }
      }
      const feats: DDOFeatData[] = [...featByName.values()];

      const treeFiles: string[] = treeListRes ? (JSON.parse(treeListRes) as string[]) : [];
      const enhancementTrees: EnhancementTreeData[] = await loadMany(
        treeFiles.map(f => `/data/EnhancementTrees/${f}`),
        parseEnhancementTreeXml,
      );

      // Build comprehensive feat icon map from ALL sources:
      // Feats.xml → class XML files → race XML files
      // Later sources can override earlier ones, so more specific
      // (class-specific) icon names win over generic Feats.xml entries.
      const featIcons: Record<string, string> = {};
      if (featsXml) Object.assign(featIcons, parseFeatIcons(featsXml));
      for (const xml of classXmls) {
        if (xml) Object.assign(featIcons, parseFeatIcons(xml));
      }
      for (const xml of raceXmls) {
        if (xml) Object.assign(featIcons, parseFeatIcons(xml));
      }

      const bonusTypes:   DDOBonusType[]   = bonusTypesXml   ? parseBonusTypesXml(bonusTypesXml)     : [];
      const stances:      DDOStanceData[]  = stancesXml      ? parseStancesXml(stancesXml)           : [];
      const weaponGroups: DDOWeaponGroup[] = weaponGroupsXml ? parseWeaponGroupsXml(weaponGroupsXml) : [];
      const setBonuses:   DDOSetBonusData[] = setBonusesXml  ? parseSetBonusesXml(setBonusesXml)     : [];

      let itemBuffs: ItemBuffCatalog = {};
      if (itemBuffsJson) {
        try { itemBuffs = JSON.parse(itemBuffsJson) as ItemBuffCatalog; }
        catch { /* keep empty catalog; engine logs unmatched buffs */ }
      }

      // Item name → set name fallback for .DDOBuild files that omit SetBonus.
      const itemSetIndex: Record<string, string> = {};
      if (itemIndexJson) {
        try {
          const idx = JSON.parse(itemIndexJson) as { name: string; setBonus?: string }[];
          for (const i of idx) {
            if (i.setBonus) itemSetIndex[i.name] = i.setBonus;
          }
        } catch { /* keep empty; sets just won't fire from name fallback */ }
      }

      // Augment definitions: 31 small XML files. Fetch in parallel.
      const augmentFiles: string[] = augmentManifest ? (JSON.parse(augmentManifest) as string[]) : [];
      const augmentXmls = await Promise.all(
        augmentFiles.map(f => fetchXml(`/data/Augments/${f}`)),
      );
      const augments: DDOAugmentData[] = [];
      for (const xml of augmentXmls) {
        if (xml) augments.push(...parseAugmentsXml(xml));
      }

      // Filigrees: 65 small XML files, each defines both a set bonus and
      // its individual filigrees. Fetch in parallel.
      const filigreeFiles: string[] = filigreeManifest ? (JSON.parse(filigreeManifest) as string[]) : [];
      const filigreeXmls = await Promise.all(
        filigreeFiles.map(f => fetchXml(`/data/FiligreeSets/${f}`)),
      );
      const filigrees: DDOFiligreeData[] = [];
      const filigreeSetBonuses: DDOFiligreeSetBonus[] = [];
      for (const xml of filigreeXmls) {
        if (xml) {
          const parsed = parseFiligreesXml(xml);
          filigrees.push(...parsed.filigrees);
          filigreeSetBonuses.push(...parsed.setBonuses);
        }
      }

      const spells: DDOSpellData[] = spellsXml ? parseSpellsXml(spellsXml) : [];
      const selfPartyBuffs: DDOOptionalBuff[] = selfPartyBuffsXml
        ? parseSelfPartyBuffsXml(selfPartyBuffsXml) : [];
      const guildBuffs: DDOGuildBuff[] = guildBuffsXml ? parseGuildBuffsXml(guildBuffsXml) : [];
      const metamagics: DDOMetamagicData[] = metamagicsXml ? parseMetamagicsXml(metamagicsXml) : [];

      set({
        status: 'ready',
        classes, races, feats, enhancementTrees, featIcons,
        bonusTypes, stances, weaponGroups, setBonuses, itemBuffs, itemSetIndex,
        augments, filigrees, filigreeSetBonuses, spells, selfPartyBuffs, guildBuffs,
        metamagics,
      });
    } catch (e) {
      set({ status: 'error', error: String(e) });
    }
  },

  getClass: (name) => get().classes.find(c => c.name.toLowerCase() === name.toLowerCase()),
  getRace:  (name) => get().races.find(r => r.name.toLowerCase() === name.toLowerCase()),
  getBonusType: (name) => get().bonusTypes.find(b => b.name.toLowerCase() === name.toLowerCase()),
}));

export type { GameData } from '@/types/ddoData';
