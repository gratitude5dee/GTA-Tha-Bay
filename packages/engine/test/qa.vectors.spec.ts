import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runVectorChecks, type VectorGoldens } from '../src/sim/qa/vectors.ts';

const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../shared/test/golden/${name}`, import.meta.url), 'utf8'));
const goldens = (): VectorGoldens => ({
  detmath: read('detmath.v1.json'),
  rng: read('rng.v1.json'),
  ctr: read('ctr.v1.json'),
  fnv: read('fnv.v1.json'),
} as VectorGoldens);

describe('QA vector checker (the code that runs in sim.worker on the determinism page)', () => {
  it('finds 0 mismatches against the shared goldens in Node, over every group', () => {
    const r = runVectorChecks(goldens());
    expect(r.mismatches, r.first ?? '').toBe(0);
    expect(r.total).toBeGreaterThan(20_000);
    for (const g of ['detmath.dsqrt', 'detmath.dsin', 'detmath.dpow', 'rng.splitmix32', 'rng.xoshiro', 'rng.streams', 'ctr', 'fnv']) {
      expect(r.groups[g]?.total, g).toBeGreaterThan(0);
      expect(r.groups[g]?.mismatches, g).toBe(0);
    }
  });

  it('counts a corrupted vector in every file, so a failing engine would be seen', () => {
    const g = goldens();
    const sin = g.detmath.functions['dsin']!.cases[10]!;
    sin[sin.length - 1] = '3ff0000000000001';
    g.rng.xoshiro[0]!.out[3]! += 1;
    g.ctr.cases[2]!.out ^= 1;
    g.fnv.strings[1]!.fnv32 ^= 1;
    const r = runVectorChecks(g);
    expect(r.mismatches).toBe(4);
    expect(r.groups['detmath.dsin']?.mismatches).toBe(1);
    expect(r.groups['rng.xoshiro']?.mismatches).toBe(1);
    expect(r.groups['ctr']?.mismatches).toBe(1);
    expect(r.groups['fnv']?.mismatches).toBe(1);
    expect(r.first).toMatch(/^detmath\.dsin:/);
  });

  it('a function missing from the golden file is a mismatch, not a silent pass', () => {
    const g = goldens();
    delete g.detmath.functions['dexp'];
    const r = runVectorChecks(g);
    expect(r.mismatches).toBe(1);
    expect(r.first).toContain('missing from the golden file');
  });
});
