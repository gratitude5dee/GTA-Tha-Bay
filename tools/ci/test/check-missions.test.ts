/**
 * M05a2 AC-1 and AC-3: `check:missions` through its harness. The sample passes on every seed twice with equal hashes and leaves
 * its result files; a band that ends before the bot's finish gives `out_of_band`, a mission with a compiler error gives
 * `compile_error`, a run that cannot finish names the objective it is stuck on, and two runs that differ give `hash_mismatch`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeDvtl } from '../../../packages/engine/src/sim/script/dvtl.ts';
import { compileMission } from '../../../packages/modes/story/src/compiler/index.ts';
import { setMissionDeps } from '../../../packages/modes/story/src/qa.ts';
import { baseEnv } from '../../../packages/modes/story/test/fixtures/base.ts';
import type E_REF_ZONE from '../../../packages/modes/story/test/fixtures/bad/E_REF_ZONE.ts';
import { compileInMemory, readBundle, type InMemoryBuild } from '../missions/bundle.ts';
import { runCheck } from '../missions/check.ts';
import { preview } from '../missions/preview.ts';
import { repoRoot } from '../run.ts';

const out = mkdtempSync(path.join(os.tmpdir(), 'dv-check-missions-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

const quiet = { log: () => undefined, env: {} as Record<string, string | undefined> };

/** The compiled sample with its expected band replaced. */
function withBand(band: [number, number], seeds: [number, number, number] = [1, 2, 3]): () => Promise<InMemoryBuild> {
  return async () => {
    const b = readBundle(repoRoot, 'm.dev.sample');
    b.ir = { ...b.ir, autoplay: { expectedSec: band, seeds } };
    return { missions: ['m.dev.sample'], errors: [], problems: [], bundles: new Map([['m.dev.sample', b]]) };
  };
}

describe('check:missions on m.dev.sample (AC-1)', () => {
  it('passes 3 seeds twice inside the band with equal hashes, and writes the result and timeline of each seed', async () => {
    const r = await runCheck({ root: repoRoot, mission: 'm.dev.sample', outDir: out, ...quiet });
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(6);
    for (const seed of [1, 2, 3]) {
      const two = r.rows.filter((x) => x.seed === seed);
      expect(two).toHaveLength(2);
      expect(two[0]?.endHash).toBe(two[1]?.endHash);
      expect(two[0]?.outcome).toBe('pass');
      expect(two[0]?.elapsedSec).toBeGreaterThanOrEqual(120);
      expect(two[0]?.elapsedSec).toBeLessThanOrEqual(900);
      const json = JSON.parse(readFileSync(path.join(out, `m.dev.sample.${seed}.json`), 'utf8')) as { mission: string; seed: number; outcome: string; endHash: string };
      expect(json).toMatchObject({ mission: 'm.dev.sample', seed, outcome: 'pass', endHash: two[0]?.endHash });
      const dvtl = decodeDvtl(new Uint8Array(readFileSync(path.join(out, `m.dev.sample.${seed}.dvtl`))));
      expect(dvtl.meta).toMatchObject({ mission: 'm.dev.sample', seed });
      expect(dvtl.events.filter((e) => e.t === 'mis.stage').length).toBeGreaterThan(10);
    }
    expect(existsSync(path.join(out, 'm.dev.sample.4.json'))).toBe(false);
  }, 120_000);

  it('the compile step of the harness is the real one: m.dev.sample compiles in memory with its directors and lines', async () => {
    const b = await compileInMemory(repoRoot, 'm.dev.sample');
    expect(b.errors).toEqual([]);
    expect(b.missions).toEqual(['m.dev.sample']);
    const bundle = b.bundles.get('m.dev.sample');
    expect(bundle?.directors.map((d) => d.id).sort()).toEqual(['m.dev.sample.intro', 'm.dev.sample.meet']);
    expect(Object.keys(bundle?.lines ?? {})).toContain('line.m.dev.sample.hello');
  });
});

describe('check:missions failures (AC-3)', () => {
  it('a band that ends 10 s before the bot finishes fails with out_of_band, the mission id and the seed', async () => {
    const finish = (await runCheck({ root: repoRoot, mission: 'm.dev.sample', seeds: [1], outDir: null, compile: withBand([100, 900], [1, 2, 3]), packs: undefined, ...quiet })).rows[0]?.elapsedSec ?? 0;
    expect(finish).toBeGreaterThan(120);
    const r = await runCheck({ root: repoRoot, mission: 'm.dev.sample', seeds: [1], outDir: null, compile: withBand([100, Math.floor(finish - 10)]), ...quiet });
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ mission: 'm.dev.sample', seed: 1, reason: 'out_of_band' });
    expect(r.failures[0]?.detail).toContain('outside');
  }, 120_000);

  it('a mission with a compiler error fails with compile_error and the code and pointer, and runs nothing', async () => {
    const f = ((await import('../../../packages/modes/story/test/fixtures/bad/E_REF_ZONE.ts')) as { default: typeof E_REF_ZONE }).default;
    const res = compileMission(f.build(), baseEnv());
    expect(res.errors.length).toBeGreaterThan(0);
    const compile = (): Promise<InMemoryBuild> =>
      Promise.resolve({ missions: [], errors: res.errors.map((e) => ({ mission: 'm.t.base', code: e.code, pointer: e.pointer, message: e.message })), problems: [], bundles: new Map() });
    const r = await runCheck({ root: repoRoot, outDir: null, compile, ...quiet });
    expect(r.ok).toBe(false);
    expect(r.rows).toEqual([]);
    expect(r.failures[0]).toMatchObject({ mission: 'm.t.base', seed: null, reason: 'compile_error' });
    expect(r.failures[0]?.detail).toContain('E_REF_ZONE');
    expect(r.failures[0]?.detail).toContain('/stages/0/objectives/0/zone');
  });

  it('a run that cannot finish in its time is not_passed and names the objective it is stuck on', async () => {
    const r = await runCheck({ root: repoRoot, mission: 'm.dev.sample', seeds: [1], outDir: null, compile: withBand([1, 25]), ...quiet });
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatchObject({ mission: 'm.dev.sample', seed: 1, reason: 'not_passed' });
    expect(r.failures[0]?.detail).toContain('timeout');
    expect(r.failures[0]?.detail).toMatch(/active objective \w+/);
  }, 120_000);

  it('two runs of a seed that end differently are a hash_mismatch', async () => {
    let n = 0;
    setMissionDeps({ missionSeed: (s, id) => s + id.length + n++ });
    try {
      const r = await runCheck({ root: repoRoot, mission: 'm.dev.sample', seeds: [1], outDir: null, compile: withBand([120, 900]), ...quiet });
      expect(r.failures.map((f) => f.reason)).toContain('hash_mismatch');
    } finally {
      setMissionDeps(null);
    }
  }, 120_000);

  it('a mission built against a world that is not there fails with world_missing and the build command', async () => {
    const compile = async (): Promise<InMemoryBuild> => {
      const b = readBundle(repoRoot, 'm.dev.sample');
      b.ir = { ...b.ir, worldBake: 'f'.repeat(64) };
      return { missions: ['m.dev.sample'], errors: [], problems: [], bundles: new Map([['m.dev.sample', b]]) };
    };
    const r = await runCheck({ root: repoRoot, mission: 'm.dev.sample', seeds: [1], outDir: null, compile, ...quiet });
    expect(r.failures[0]).toMatchObject({ reason: 'world_missing' });
    expect(r.failures[0]?.detail).toBe(`world bake ${'f'.repeat(64)} not found: run pnpm map:build -- --area sf`);
  }, 60_000);
});

describe('the bundled recording of the QA scrub page', () => {
  it('tests/fixtures/missions/m.dev.sample.1.dvtl equals a fresh recording (regenerate: pnpm missions:preview -- --mission m.dev.sample --seed 1 --out tests/fixtures/missions)', async () => {
    const r = await preview({ root: repoRoot, mission: 'm.dev.sample', seed: 1, outDir: out, log: () => undefined });
    expect(r.outcome).toBe('pass');
    const fresh = readFileSync(r.file);
    const kept = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'missions', 'm.dev.sample.1.dvtl'));
    expect(kept.equals(fresh)).toBe(true);
  }, 120_000);
});
