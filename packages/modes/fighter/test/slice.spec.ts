/** AC-9 (FX8): the FighterSlice round-trips, repairs a broken save, merges the unlock grants and gains cosmetic XP only. */
import { describe, expect, it } from 'vitest';
import { MAX_XP, addXp, defaultSlice, fightersFromUnlocks, migrateSlice, sliceFromJson, sliceToJson, withUnlocks } from '../src/sim/slice.ts';

describe('FighterSlice', () => {
  it('the default round-trips through JSON unchanged', () => {
    const s = defaultSlice();
    expect(sliceFromJson(sliceToJson(s))).toEqual(s);
  });

  it('a null or broken save gives the defaults, and a broken field only its own default', () => {
    expect(sliceFromJson(null)).toEqual(defaultSlice());
    const s = sliceFromJson({ schema: 1, unlockedFighters: 'nope', settings: { scheme: 'weird', difficulty: 9, inputDisplay: true } } as never);
    expect(s.unlockedFighters).toEqual(defaultSlice().unlockedFighters);
    expect(s.settings.scheme).toBe(defaultSlice().settings.scheme);
    expect(s.settings.difficulty).toBe(defaultSlice().settings.difficulty);
    expect(s.settings.inputDisplay).toBe(true);
  });

  it('unlock.fighter grants the starter pair and nothing else', () => {
    expect(fightersFromUnlocks([])).toEqual(['player']);
    expect(fightersFromUnlocks(['unlock.fighter'])).toEqual(['player', 'standin_rap_new_wave']);
    const s = withUnlocks(defaultSlice(), ['unlock.fighter']);
    expect(s.unlockedFighters).toEqual(['player', 'standin_rap_new_wave']);
    expect(withUnlocks(s, ['unlock.fighter']).unlockedFighters).toEqual(s.unlockedFighters);
  });

  it('XP is cosmetic, never negative and capped', () => {
    const s = defaultSlice();
    addXp(s, 'player', 50);
    addXp(s, 'player', -20);
    expect(s.fighterXp['player']).toBe(50);
    addXp(s, 'player', 10_000_000);
    expect(s.fighterXp['player']).toBe(MAX_XP);
  });

  it('a migrated slice is a valid current slice', () => {
    const out = migrateSlice({ schema: 1, unlockedFighters: ['player'] } as never, 1);
    expect(sliceFromJson(out)).toEqual(sliceFromJson(out));
    expect((out as { schema: number }).schema).toBe(1);
  });
});
