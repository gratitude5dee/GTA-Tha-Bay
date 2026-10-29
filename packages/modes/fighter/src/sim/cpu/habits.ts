/**
 * Named CPU habits (FC10.4, `content/fighter/ai/habits.json`). A kit lists up to twelve habit ids in priority order
 * (`FighterDef.ai.habits`); a level enables the first 3 / 5 / 8 / 12 of them (habit variety). The ids here are the ones the
 * decision code proposes; `habits.json` describes them and `fighter:lint` checks that every kit names only known ids.
 * Sim code under the C02 lint.
 */

export const DEFAULT_HABITS: readonly string[] = [
  'walk_in', 'poke_neutral', 'block_reach', 'anti_air', 'punish_unsafe', 'throw_close', 'fireball_zone', 'heavy_bait', 'dash_in', 'jump_in',
  'super_spend', 'check_parry',
];

/** The first `n` habits of a kit's list (a kit with no list uses the default order). */
export function enabledHabits(list: readonly string[], n: number): ReadonlySet<string> {
  const src = list.length > 0 ? list : DEFAULT_HABITS;
  return new Set(src.slice(0, n));
}
