import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Rng, type JsonValue } from '@dv/shared';
import type { BarkTag } from '@dv/shared/contracts/c10-npc';
import { compileInk, missingKnots } from '../../../tools/soul/src/ink.ts';
import { BarkSystem, type BarkEmit } from '../src/barks/bark-system.ts';
import { BarkPools, FILLER_ARCHETYPES, PoolError, builtinPools, fillerArchetype, parsePool } from '../src/barks/pools.ts';
import { SubtitleLane } from '../src/barks/subtitle-lane.ts';
import { BRAIN_CONFIG, SIM_HZ } from '../src/brains/config.ts';
import { InkRunner } from '../src/ink/ink-runner.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const BARKS = path.join(ROOT, 'content/npcs/barks');
const TAGS: BarkTag[] = [
  'bump', 'greet_pass', 'idle', 'busy', 'flee', 'car_crash_nearby', 'heat_low', 'heat_high', 'rain', 'fog', 'night', 'compliment_car',
  'player_wins_race', 'player_loses_race', 'sideshow', 'goodbye',
];

describe('bark pools', () => {
  it('ships a valid pool for each filler archetype with every tag and lines of at most 80 characters', () => {
    const pools = builtinPools();
    for (const a of FILLER_ARCHETYPES) {
      const pool = pools.get(`archetype:${a}`);
      expect(pool, a).toBeDefined();
      for (const tag of TAGS) expect(pool?.has(tag), `${a} ${tag}`).toBe(true);
      for (const l of pool?.pool.lines ?? []) {
        expect(l.text.length).toBeLessThanOrEqual(80);
        expect(l.audio).toBeNull();
      }
    }
    expect(pools.owners()).toHaveLength(5);
  });

  it('refuses a pool the schema rejects and a duplicate line id', () => {
    expect(() => parsePool({ schema: 'bark-pool/1', owner: 'archetype:civilian', voiceRef: null, lines: [{ id: 'x', tag: 'nope', text: 'hi', audio: null, cues: null, weight: 1 }] })).toThrow(PoolError);
    const line = { id: 'dup', tag: 'idle', text: 'hi', audio: null, cues: null, weight: 1 };
    expect(() => parsePool({ schema: 'bark-pool/1', owner: 'archetype:civilian', voiceRef: null, lines: [line, line] })).toThrow(/duplicate/);
  });

  it('picks by weight, avoids the line said last and falls back to the archetype pool of an NPC', () => {
    const pools = new BarkPools();
    const idx = pools.add({
      schema: 'bark-pool/1', owner: 'archetype:civilian', voiceRef: null,
      lines: [
        { id: 'a', tag: 'idle', text: 'A', audio: null, cues: null, weight: 1 },
        { id: 'b', tag: 'idle', text: 'B', audio: null, cues: null, weight: 3 },
      ],
    });
    const rng = new Rng(7);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 400; i++) counts[(idx.pick('idle', rng)?.id ?? 'a') as 'a' | 'b']++;
    expect(counts.b).toBeGreaterThan(counts.a * 2);
    for (let i = 0; i < 20; i++) expect(idx.pick('idle', rng, 'b')?.id).toBe('a');
    expect(idx.pick('rain', rng)).toBeNull();
    expect(pools.forNpc('ro-batista', 'civilian')?.owner).toBe('archetype:civilian');
    expect(pools.forNpc('ro-batista', 'vendor')).toBeUndefined();
  });

  it('keeps a filler pedestrian in one archetype, with civilians the most common', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const a = fillerArchetype(i * 2654435761);
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    expect(counts.get('civilian') ?? 0).toBeGreaterThan(400);
    expect(fillerArchetype(12345)).toBe(fillerArchetype(12345));
  });
});

describe('bark ink (filler Talk)', () => {
  for (const a of FILLER_ARCHETYPES) {
    it(`${a}.ink compiles, matches its committed json and plays two-line exchanges`, async () => {
      const src = fs.readFileSync(path.join(BARKS, `${a}.ink`), 'utf8');
      const out = compileInk(src);
      expect(out.errors).toEqual([]);
      expect(out.json).not.toBeNull();
      expect(missingKnots(out.knots)).toEqual([]);
      const jsonPath = path.join(BARKS, `${a}.ink.json`);
      const compiled = `${out.json}\n`;
      // `DV_WRITE_BARK_INK=1 pnpm check:unit -- packages/npc/test/barks.spec.ts` refreshes the committed files after an edit of an .ink
      if (process.env['DV_WRITE_BARK_INK'] === '1') fs.writeFileSync(jsonPath, compiled);
      expect(fs.readFileSync(jsonPath, 'utf8')).toBe(compiled);
      const runner = await InkRunner.create(compiled);
      for (const knot of ['greeting', 'smalltalk', 'busy', 'deflect', 'farewell'] as const) {
        const lines = runner.play(knot);
        expect(lines, `${a} ${knot}`).toHaveLength(2);
        expect(lines[0]?.tags).toContain('who:player');
        expect(lines[1]?.tags ?? []).not.toContain('who:player');
        for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(120);
      }
    });
  }
});

function harness(overrides: Partial<{ maxAudible: number }> = {}) {
  const emitted: BarkEmit[] = [];
  const pools = builtinPools();
  const bark = new BarkSystem({
    pools,
    rng: new Rng(99),
    cfg: { ...BRAIN_CONFIG.barks, ...overrides },
    emit: (e) => emitted.push(e),
  });
  return { bark, emitted };
}
const player = { x: 0, z: 0 };
const req = (key: string, tag: BarkTag, x = 3, z = 0) => ({ tag, key, owner: 'archetype:civilian', speaker: 'passerby', x, z });

describe('BarkSystem cooldowns (AC-3)', () => {
  it('lets one entity bark once in 20 s when ten bumps arrive in 5 s', () => {
    const { bark, emitted } = harness();
    const verdicts: string[] = [];
    for (let i = 0; i < 10; i++) verdicts.push(bark.request(i * 30, req('amb:c:260', 'bump'), player));
    expect(verdicts.filter((v) => v === 'played')).toHaveLength(1);
    expect(verdicts.slice(1).every((v) => v === 'cooldown')).toBe(true);
    expect(emitted).toHaveLength(1);
  });

  it('keeps the same tag quiet for 60 s and lets another tag through after 20 s', () => {
    const { bark, emitted } = harness();
    expect(bark.request(0, req('amb:c:260', 'bump'), player)).toBe('played');
    expect(bark.request(19 * SIM_HZ, req('amb:c:260', 'idle'), player)).toBe('cooldown');
    expect(bark.request(21 * SIM_HZ, req('amb:c:260', 'bump'), player)).toBe('tag-cooldown');
    expect(bark.request(21 * SIM_HZ, req('amb:c:260', 'idle'), player)).toBe('played');
    expect(bark.request(59 * SIM_HZ, req('amb:c:260', 'bump'), player)).toBe('tag-cooldown');
    expect(bark.request(61 * SIM_HZ, req('amb:c:260', 'bump'), player)).toBe('played');
    expect(emitted.map((e) => e.tag)).toEqual(['bump', 'idle', 'bump']);
  });

  it('never has more than two barks audible at once', () => {
    const { bark } = harness();
    const v = ['a', 'b', 'c', 'd'].map((k) => bark.request(0, req(`amb:c:${k}`, 'idle'), player));
    expect(v).toEqual(['played', 'played', 'full', 'full']);
    expect(bark.audible()).toBe(2);
    // after their subtitles ran out a third may speak
    expect(bark.request(10 * SIM_HZ, req('amb:c:e', 'idle'), player)).toBe('played');
  });

  it('drops a bark from beyond the radius or with no player, and a tag the pool lacks', () => {
    const { bark } = harness();
    expect(bark.request(0, req('amb:c:1', 'idle', 80, 0), player)).toBe('far');
    expect(bark.request(0, req('amb:c:1', 'idle'), null)).toBe('far');
    expect(bark.request(0, { ...req('amb:c:2', 'idle'), owner: 'archetype:nobody' }, player)).toBe('no-line');
  });

  it('emits the line, its subtitle time and a null audio for a placeholder pool', () => {
    const { bark, emitted } = harness();
    bark.request(100, req('amb:c:260', 'bump'), player);
    const e = emitted[0] as BarkEmit;
    expect(e.audio).toBeNull();
    expect(e.endTick - e.tick).toBe(Math.ceil(Math.max(1.5, 0.06 * e.text.length) * SIM_HZ));
    expect(e.speaker).toBe('passerby');
  });

  it('hashes, saves and loads its cooldown table', () => {
    const a = harness();
    a.bark.request(0, req('amb:c:1', 'bump'), player);
    a.bark.request(0, req('amb:c:2', 'idle'), player);
    const written: (string | number)[] = [];
    const w = {
      u8: (v: number) => void written.push(v), u32: (v: number) => void written.push(v), i32: (v: number) => void written.push(v),
      f64: (v: number) => void written.push(v), str: (v: string) => void written.push(v),
    };
    a.bark.save(w);
    const b = harness();
    let i = 0;
    const r = {
      u8: () => written[i++] as number, u32: () => written[i++] as number, i32: () => written[i++] as number,
      f64: () => written[i++] as number, str: () => written[i++] as string,
    };
    b.bark.load(r);
    expect(b.bark.stateHash()).toBe(a.bark.stateHash());
    expect(b.bark.request(10, req('amb:c:1', 'bump'), player)).toBe('cooldown');
  });
});

describe('SubtitleLane', () => {
  function lane(peek?: () => JsonValue | null | undefined) {
    const patches: (JsonValue | null)[] = [];
    const l = new SubtitleLane({ patch: (_k, v) => void patches.push(v), ...(peek ? { peek } : {}) });
    return { l, patches };
  }

  it('patches hud.subtitle with speaker, text and times, and clears it when the time is up', () => {
    const { l, patches } = lane();
    l.show('passerby', 'Hey, watch it!', 120, 240);
    expect(patches[0]).toEqual({ speaker: 'passerby', text: 'Hey, watch it!', startMs: 2000, endMs: 4000 });
    l.update(239);
    expect(patches).toHaveLength(1);
    l.update(240);
    expect(patches[1]).toBeNull();
    l.update(300);
    expect(patches).toHaveLength(2);
  });

  it('leaves a subtitle that someone else patched in the meantime', () => {
    const { l, patches } = lane(() => ({ speaker: 'mission', text: 'Another line' }));
    l.show('passerby', 'Hey!', 0, 60);
    l.update(60);
    expect(patches).toHaveLength(1);
  });

  it('replaces an older line with a newer one', () => {
    const { l, patches } = lane();
    l.show('a', 'one', 0, 100);
    l.show('b', 'two', 10, 110);
    l.update(100);
    expect(patches).toHaveLength(2);
    l.update(110);
    expect(patches).toHaveLength(3);
  });
});
