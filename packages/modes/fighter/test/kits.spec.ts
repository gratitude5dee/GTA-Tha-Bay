// M08b1 AC-6 / AC-9 (kits): the eight roster kits follow FX2 and the committed player kit is final.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FighterDef, FightTuning } from '@dv/shared/fight';
import { derivedAdvantage } from '@dv/shared/fight';
import { lintKit } from '../src/lint/index.ts';
import { loadFameOptions } from '../src/lint/options.ts';

const root = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as T;
const tuning = read<FightTuning>('config/fighter.tuning.json');
const kitDir = path.join(root, 'content/fighter/kits');
const kits = new Map<string, FighterDef>();
for (const f of readdirSync(kitDir).filter((x) => x.endsWith('.json')).sort()) {
  const k = JSON.parse(readFileSync(path.join(kitDir, f), 'utf8')) as FighterDef;
  kits.set(k.slot, k);
}
const options = loadFameOptions(root);

/** FX2: walk speeds (forward / back) and the gimmick state word of each slot. */
const FX2: Record<string, { walk: [number, number]; gimmick: string; specials: string[]; supers: string[] }> = {
  RAP_HYPHY_ELDER: { walk: [80, 58], gimmick: 'frenzy', specials: ['slangWave', 'skidDash', 'frenzy'], supers: ['turfRush', 'overdrive'] },
  RAP_LYRICIST: { walk: [62, 48], gimmick: 'string', specials: ['wordSalvo', 'rewind', 'hardStop'], supers: ['wallOfWords', 'finalDraft'] },
  RAP_NEW_WAVE: { walk: [70, 55], gimmick: 'pulse', specials: ['pulseNear', 'stepDash', 'detonate'], supers: ['markerChain', 'floorTakeover'] },
  TECH_VISIONARY: { walk: [60, 46], gimmick: 'agents', specials: ['dispatchAgent', 'pivot', 'recall'], supers: ['roadmapRush', 'hardPivot'] },
  TECH_HACKER: { walk: [68, 52], gimmick: 'patch', specials: ['patch', 'glitchStep', 'echo'], supers: ['hotfixBarrage', 'rollback'] },
  ATH_SHOOTER: { walk: [58, 50], gimmick: 'charge', specials: ['arcShot', 'backstepFade', 'lobCover'], supers: ['tripleArc', 'gumballVolley'] },
  ATH_POWER_BACK: { walk: [52, 42], gimmick: 'armor', specials: ['shoulderCharge', 'collarToss', 'brace'], supers: ['wreckingRun', 'fullClearance'] },
  INFLUENCER: { walk: [66, 52], gimmick: 'poll', specials: ['hotTake', 'swapPlaces', 'pollPop'], supers: ['viralMoment', 'trending'] },
};

describe('the nine committed kits', () => {
  it('are the player and the eight roster slots', () => {
    expect([...kits.keys()].sort()).toEqual(['ATH_POWER_BACK', 'ATH_SHOOTER', 'INFLUENCER', 'PLAYER_FIGHTER', 'RAP_HYPHY_ELDER', 'RAP_LYRICIST', 'RAP_NEW_WAVE', 'TECH_HACKER', 'TECH_VISIONARY']);
  });
  for (const [slot, k] of kits) {
    it(`${slot} lints clean (schema, frame data, loops, fame domain, habits, gimmick pairing)`, () => {
      expect(lintKit(k, tuning, options(slot))).toEqual([]);
    });
  }
});

describe('FX2: eight kits with a gimmick, three specials, an L2 super, a Showstopper, a Shutdown and a taunt', () => {
  for (const [slot, want] of Object.entries(FX2)) {
    const k = kits.get(slot) as FighterDef;
    it(`${slot}`, () => {
      expect(k.health).toBeGreaterThanOrEqual(9500);
      expect(k.health).toBeLessThanOrEqual(10500);
      expect([k.walk.f, k.walk.b]).toEqual(want.walk);
      expect(k.gimmick?.id).toBe(want.gimmick);
      const specials = k.moves.filter((m) => m.kind === 'special' && m.schemes.includes('simple')).map((m) => m.id);
      expect(specials).toEqual(want.specials);
      expect(k.supers.map((m) => m.id)).toEqual(want.supers);
      const [l2, show] = k.supers;
      expect(l2?.hypeCost).toBe(2000);
      expect(show?.hypeCost).toBe(3000);
      const shut = k.shutdown, taunt = k.taunt;
      expect(shut.startup - 1 + shut.active + shut.recovery).toBe(170);
      expect(shut.kind).toBe('shutdown');
      expect(taunt.kind).toBe('taunt');
      expect(k.ai.habits).toHaveLength(12);
    });
  }
});

describe('the Showstopper is 3,200 at a 50 % minimum scale and the player kit is final', () => {
  it('every Showstopper that strikes deals 3,200 and costs three stocks', () => {
    for (const [slot, k] of kits) {
      const show = k.supers.find((m) => (m.hypeCost ?? 0) === 3000);
      expect(show, slot).toBeDefined();
      if (show && show.hits.length > 0) expect(show.hits[0]?.hit.damage, slot).toBe(3200);
    }
  });
  it('no kit keeps a placeholder tag', () => {
    for (const [slot, k] of kits) {
      const all = [...k.moves, ...k.supers, k.shutdown, k.taunt];
      expect(all.filter((m) => m.tags.includes('placeholder')).map((m) => m.id), slot).toEqual([]);
    }
  });
  it('PLAYER_FIGHTER keeps the FX3 advantages after the final Showstopper, Shutdown and taunt', () => {
    const p = kits.get('PLAYER_FIGHTER') as FighterDef;
    const m = p.moves.find((x) => x.id === '5L') as FighterDef['moves'][number];
    expect(derivedAdvantage(m, (m.hits[0] as { hit: Parameters<typeof derivedAdvantage>[1] }).hit)).toEqual({ advHit: 4, advBlock: 1 });
    expect(p.supers.find((x) => x.id === 'showstopper')?.hits[0]?.hit.damage).toBe(3200);
  });
});

describe('shipped names are original (FX2 name hygiene)', () => {
  const research = ['go dumb', 'freestyle', 'stiff arm', 'chat vote', 'beat drop', '3-point', 'three-point'];
  it('no move id, name key or tag carries a research name', () => {
    for (const [slot, k] of kits) {
      const text = [...k.moves, ...k.supers, k.shutdown, k.taunt].flatMap((m) => [m.id, m.nameKey, ...m.tags]).join(' ').toLowerCase().replace(/[_-]/g, ' ');
      for (const r of research) expect(text.includes(r), `${slot}: ${r}`).toBe(false);
    }
  });
  it('the replaced names are the shipped ones', () => {
    expect(kits.get('RAP_HYPHY_ELDER')?.moves.some((m) => m.id === 'frenzy')).toBe(true);
    expect(kits.get('ATH_SHOOTER')?.moves.some((m) => m.id === 'arcShot')).toBe(true);
    expect(kits.get('ATH_POWER_BACK')?.moves.some((m) => m.id === 'collarToss')).toBe(true);
  });
});
