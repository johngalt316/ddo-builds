// Custom effect type names this project has added on top of the
// auto-generated `effectTypes.ts` (which mirrors DDOBuilderV2's
// Effect.h). Keep this file separate so a regen of `effectTypes.ts`
// doesn't wipe our additions.
//
// Append a string here when introducing a new effect type in the XML
// data. The engine still has to add a routing case for the new type
// to actually consume its bonuses.

export const CUSTOM_EFFECT_TYPES = [
  /** Granted by reaper-tree "Reaper's Charge" enhancements
   *  (DireCharge / DAReapersCharge / GrimReapersCharge). Each rank
   *  adds 1 to the build's shared reaper-charge pool. */
  'MaxReaperCharge',
] as const;

export type CustomEffectType = typeof CUSTOM_EFFECT_TYPES[number];
