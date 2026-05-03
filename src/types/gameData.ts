import type { Stat, Alignment } from './build';

export type BabProgression = 'full' | 'three_quarter' | 'half';
export type SaveProgression = 'high' | 'low';
export type FeatType = 'general' | 'fighter' | 'metamagic' | 'epic' | 'racial';

export interface AbilityBonus {
  stat?: Stat;
  any?: number;
  value?: number;
}

export interface Race {
  id: string;
  name: string;
  description: string;
  abilityBonuses: Partial<Record<Stat, number>> & { any?: number };
  skillBonuses: Partial<Record<string, number>>;
  racialTraits: string[];
  hitPointBonus: number;
  availableAlignments: Alignment[];
}

export interface ClassSaveProgressions {
  fortitude: SaveProgression;
  reflex: SaveProgression;
  will: SaveProgression;
}

export interface DDOClass {
  id: string;
  name: string;
  description: string;
  hitDie: number;
  babProgression: BabProgression;
  saveProgressions: ClassSaveProgressions;
  skillPointsPerLevel: number;
  classSkills: string[];
  spellcaster: boolean;
  spellcastingAbility: Stat | null;
  availableAlignments: Alignment[];
}

export interface FeatPrerequisite {
  type: 'feat' | 'bab' | 'stat' | 'class' | 'race';
  id?: string;
  value?: number;
  stat?: Stat;
  classId?: string;
  classLevel?: number;
}

export interface Feat {
  id: string;
  name: string;
  description: string;
  type: FeatType;
  prerequisites: FeatPrerequisite[];
  stackable: boolean;
}

export interface Skill {
  id: string;
  name: string;
  keyAbility: Stat;
  armorCheckPenalty: boolean;
  trainedOnly: boolean;
}

export interface Enhancement {
  id: string;
  name: string;
  description: string;
  treeId: string;
  tier: number;
  maxRanks: number;
  apCostPerRank: number;
  prerequisites: string[];
}

export interface EnhancementTree {
  id: string;
  name: string;
  classId: string | null;
  raceId: string | null;
  enhancements: Enhancement[];
}
