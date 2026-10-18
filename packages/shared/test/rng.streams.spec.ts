import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng, ctrU32, fnv32, splitmix32, streams } from '../src/index.ts';

function golden<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./golden/${name}`, import.meta.url), 'utf8')) as T;
}

// Independent BigInt references.
const M32 = 0xffffffffn;
const rotl = (x: bigint, k: bigint): bigint => ((x << k) | (x >> (32n - k))) & M32;
function refXoshiro(state: readonly number[], n: number): number[] {
  let [s0, s1, s2, s3] = state.map(BigInt) as [bigint, bigint, bigint, bigint];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(Number((rotl((s1 * 5n) & M32, 7n) * 9n) & M32));
    const t = (s1 << 9n) & M32;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11n);
  }
  return out;
}
function refSplitmix(x: number): number {
  let z = (BigInt(x) + 0x9e3779b9n) & M32;
  z = ((z ^ (z >> 16n)) * 0x21f0aaadn) & M32;
  z = ((z ^ (z >> 15n)) * 0x735a2d97n) & M32;
  return Number(z ^ (z >> 15n));
}

describe('splitmix32 and xoshiro128**', () => {
  it('splitmix32 equals the BigInt reference and the golden file', () => {
    const g = golden<{ splitmix32: { x: number; out: number }[] }>('rng.v1.json');
    for (const { x, out } of g.splitmix32) {
      expect(splitmix32(x)).toBe(out);
      expect(refSplitmix(x)).toBe(out);
    }
    for (let i = 0; i < 1000; i++) {
      const x = (Math.imul(i, 0x9e3779b1) ^ i) >>> 0;
      expect(splitmix32(x)).toBe(refSplitmix(x));
    }
  });

  it('xoshiro128** outputs equal rng.v1.json and the BigInt reference from the same state', () => {
    const g = golden<{ xoshiro: { seed: number; initial: number[]; out: number[] }[] }>('rng.v1.json');
    for (const { seed, initial, out } of g.xoshiro) {
      const r = new Rng(seed);
      expect(r.getState()).toEqual(initial);
      const got = out.map(() => r.nextU32());
      expect(got).toEqual(out);
      expect(refXoshiro(initial, out.length)).toEqual(out);
    }
  });

  it('nextFloat is in [0, 1) with 2^-32 resolution and range(lo, hi) stays in [lo, hi)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 10000; i++) {
      const f = r.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      expect(f * 4294967296).toBe(Math.floor(f * 4294967296));
      const v = r.range(-3, 5);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThan(5);
    }
  });

  it('an all-zero state is refused (the generator would stay at zero)', () => {
    const r = new Rng(1);
    r.setState([0, 0, 0, 0]);
    const first = r.nextU32();
    const second = r.nextU32();
    expect(first === 0 && second === 0).toBe(false);
  });
});

describe('named streams (seed 0xC0FFEE)', () => {
  const SEED = 0xc0ffee;
  const draw = (name: string, n: number, s = streams(SEED)): number[] => {
    const r = s.get(name);
    return Array.from({ length: n }, () => r.nextU32());
  };

  it('world and weather differ; a re-seeded stream repeats exactly', () => {
    const world = draw('world', 1000);
    const weather = draw('weather', 1000);
    expect(world).not.toEqual(weather);
    expect(world.filter((v, i) => v === weather[i]).length).toBeLessThan(5);
    expect(draw('world', 1000)).toEqual(world);
    expect(draw('weather', 1000, streams(SEED))).toEqual(weather);
    expect(draw('world', 1000, streams(SEED + 1))).not.toEqual(world);
  });

  it('draw order across streams does not matter', () => {
    const s = streams(SEED);
    const w1 = s.get('world');
    const e1 = s.get('weather');
    const interleaved: number[] = [];
    const weatherSeq: number[] = [];
    for (let i = 0; i < 100; i++) {
      interleaved.push(w1.nextU32());
      weatherSeq.push(e1.nextU32());
    }
    expect(interleaved).toEqual(draw('world', 100));
    expect(weatherSeq).toEqual(draw('weather', 100));
  });

  it('setState(getState()) taken at draw 500 resumes the identical tail', () => {
    const s = streams(SEED);
    const r = s.get('world');
    for (let i = 0; i < 500; i++) r.nextU32();
    const saved = r.getState();
    const tail = Array.from({ length: 500 }, () => r.nextU32());
    const other = new Rng(0);
    other.setState(saved);
    expect(Array.from({ length: 500 }, () => other.nextU32())).toEqual(tail);
    // And through the stream table (checkpoint path).
    const t = streams(SEED);
    const w = t.get('world');
    for (let i = 0; i < 500; i++) w.nextU32();
    const states = t.states();
    const u = streams(SEED);
    u.setStates(states);
    expect(Array.from({ length: 500 }, () => u.get('world').nextU32())).toEqual(tail);
  });

  it('stream outputs equal rng.v1.json; stream names are listed in code-unit order', () => {
    const g = golden<{ streams: { seed: number; name: string; fnv32: number; initial: number[]; out: number[] }[] }>('rng.v1.json');
    const s = streams(SEED);
    for (const e of g.streams) {
      expect(fnv32(e.name)).toBe(e.fnv32);
      const r = s.get(e.name);
      expect(r.getState()).toEqual(e.initial);
      expect(e.out.map(() => r.nextU32())).toEqual(e.out);
    }
    expect(s.streamNames()).toEqual([...s.streamNames()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });
});

describe('ctrU32 (stateless counter hash, C02 1.1)', () => {
  it('equals ctr.v1.json and splitmix32((seed ^ fnv32(stream)) + imul(counter, 0x9E3779B1))', () => {
    const g = golden<{ cases: { seed: number; stream: string; counter: number; out: number }[] }>('ctr.v1.json');
    expect(g.cases.length).toBeGreaterThanOrEqual(96);
    for (const c of g.cases) {
      expect(ctrU32(c.seed, c.stream, c.counter)).toBe(c.out);
      expect(refSplitmix(Number((BigInt((c.seed ^ fnv32(c.stream)) >>> 0) + BigInt(Math.imul(c.counter, 0x9e3779b1) >>> 0)) & M32))).toBe(c.out);
    }
  });

  it('is stateless and counters spread', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(ctrU32(1, 'hire', i));
    expect(seen.size).toBeGreaterThan(4990);
    expect(ctrU32(1, 'hire', 17)).toBe(ctrU32(1, 'hire', 17));
    expect(ctrU32(1, 'hire', 17)).not.toBe(ctrU32(1, 'board', 17));
  });
});
