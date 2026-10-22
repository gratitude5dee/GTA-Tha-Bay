import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fnv32 } from '../../src/hash.ts';
import { Rng, splitmix32 } from '../../src/rng.ts';
import { BUFFER_WORDS, FM, HASH_SKIP_WORD, NULL_SINK, RNG_CPU, RNG_FIGHT } from '../../src/fight/buffer.ts';
import { FightCore } from '../../src/fight/step.ts';
import { hashBuffer, hashHex, rngNext, rngSeed } from '../../src/fight/hash.ts';
import { packHash } from '../../src/fight/pack.ts';
import { LINEUP, PACK, RULES, randomBot } from './helpers.ts';

const GOLDEN = new URL('../golden/fight/hash.v1.json', import.meta.url);
const TICKS = [0, 60, 600, 1000, 3000, 5000];
const RUN_RULES = { ...RULES, timerFrames: 5940 };

function simulate(ticks: number, snapAt?: number): { hashes: Record<number, string>; snap?: Int32Array; sim: FightCore; buf: Int32Array } {
  const sim = new FightCore();
  const buf = sim.init(PACK, RUN_RULES, 11, LINEUP);
  sim.setPhase(buf, 3);
  const a = randomBot(101, ticks, 1), b = randomBot(202, ticks, -1);
  const hashes: Record<number, string> = {};
  let snap: Int32Array | undefined;
  for (let t = 0; t <= ticks; t++) {
    if (TICKS.includes(t)) hashes[t] = hashHex(sim.hash(buf));
    if (t === snapAt) snap = sim.snapshot(buf);
    if (t < ticks) sim.step(buf, a[t] as number, b[t] as number, NULL_SINK);
  }
  return snap === undefined ? { hashes, sim, buf } : { hashes, snap, sim, buf };
}

describe('hash vectors (hash.v1.json)', () => {
  const run = simulate(5000, 1000);
  it('the golden hashes of the scripted match are reproduced', () => {
    const out = { v: 1, frameDataHash: PACK.hash, seed: 11, rules: RUN_RULES, bots: [101, 202], hashes: run.hashes };
    if (process.env.DV_UPDATE_GOLDEN === '1') writeFileSync(GOLDEN, `${JSON.stringify(out, null, 2)}\n`);
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as typeof out;
    expect(golden.frameDataHash).toBe(PACK.hash);
    expect(run.hashes).toEqual(golden.hashes);
  });
  it('a snapshot at tick 1,000 restored and re-run gives the same hash at tick 3,000', () => {
    const snap = run.snap as Int32Array;
    const a = randomBot(101, 5000, 1), b = randomBot(202, 5000, -1);
    // same buffer: roll back in place
    const sim = new FightCore();
    const buf = sim.init(PACK, RUN_RULES, 11, LINEUP);
    sim.restore(buf, snap);
    for (let t = 1000; t < 3000; t++) sim.step(buf, a[t] as number, b[t] as number, NULL_SINK);
    expect(hashHex(sim.hash(buf))).toBe(run.hashes[3000]);
    // and a second restore of the same snapshot after more play lands on the same state
    for (let t = 3000; t < 3500; t++) sim.step(buf, a[t] as number, b[t] as number, NULL_SINK);
    sim.restore(buf, snap);
    expect(hashHex(sim.hash(buf))).toBe(hashHex(hashBuffer(snap)));
    for (let t = 1000; t < 3000; t++) sim.step(buf, a[t] as number, b[t] as number, NULL_SINK);
    expect(hashHex(sim.hash(buf))).toBe(run.hashes[3000]);
  });
  it('the snapshot is a copy, not a view', () => {
    const snap = run.snap as Int32Array;
    const before = hashHex(hashBuffer(snap));
    run.buf[FM.Tick] = 99999;
    expect(hashHex(hashBuffer(snap))).toBe(before);
  });
  it('changing any single word changes the hash, except the presentation counter', () => {
    const base = hashBuffer(run.snap as Int32Array);
    const buf = (run.snap as Int32Array).slice();
    for (let i = 0; i < BUFFER_WORDS; i++) {
      buf[i] = (buf[i] as number) ^ 1;
      const h = hashBuffer(buf);
      if (i === HASH_SKIP_WORD) expect(h).toEqual(base);
      else expect(h, `word ${i}`).not.toEqual(base);
      buf[i] = (buf[i] as number) ^ 1;
    }
  });
  it('two identical runs agree at every checkpoint and a different seed does not', () => {
    const again = simulate(1000);
    expect(again.hashes[1000]).toBe(run.hashes[1000]);
    const sim = new FightCore();
    const buf = sim.init(PACK, RUN_RULES, 12, LINEUP);
    expect(hashHex(sim.hash(buf))).not.toBe(run.hashes[0]);
  });
  it('the frame-data hash is the SHA-256 of the canonical pack without its hash', () => {
    expect(PACK.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(packHash(PACK)).toBe(PACK.hash);
    const changed = structuredClone(PACK);
    (changed.kits.PLAYER_FIGHTER.moves[0] as { startup: number }).startup = 5;
    expect(packHash(changed)).not.toBe(PACK.hash);
  });
});

describe('the two RNG states in the buffer', () => {
  it('are seeded splitmix32(seed ^ fnv32(name)) and step like Rng', () => {
    const buf = new Int32Array(BUFFER_WORDS);
    rngSeed(buf, RNG_FIGHT, 7, 'fight');
    rngSeed(buf, RNG_CPU, 7, 'cpu');
    const ref = new Rng(splitmix32((7 ^ fnv32('fight')) | 0));
    for (let i = 0; i < 50; i++) expect(rngNext(buf, RNG_FIGHT)).toBe(ref.nextU32());
    expect([buf[RNG_CPU], buf[RNG_CPU + 1], buf[RNG_CPU + 2], buf[RNG_CPU + 3]]).not.toEqual([buf[RNG_FIGHT], buf[RNG_FIGHT + 1], buf[RNG_FIGHT + 2], buf[RNG_FIGHT + 3]]);
  });
  it('init seeds both states', () => {
    const sim = new FightCore();
    const buf = sim.init(PACK, RULES, 7, LINEUP);
    const ref = new Rng(splitmix32((7 ^ fnv32('cpu')) | 0));
    expect(rngNext(buf, RNG_CPU)).toBe(ref.nextU32());
  });
});
