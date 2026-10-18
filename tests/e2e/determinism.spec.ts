import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

interface Golden {
  scenario: string;
  profile: string;
  physicsBuild: string;
  ticks: number;
  checkpoints: Record<string, string>;
  final: string;
}

interface Result {
  vectors: { total: number; mismatches: number; first: string | null; groups: Record<string, { total: number; mismatches: number }> };
  scenario: string;
  physicsBuild: string;
  ticks: number;
  checkpoints: Record<string, string>;
  final: string;
  runMs: number;
  initMs: number;
}

const golden = JSON.parse(
  readFileSync(new URL('../../packages/engine/test/golden/determinism.physics-drop.json', import.meta.url), 'utf8'),
) as Golden;

test.describe('determinism @determinism', () => {
  test('golden vectors and the 10,000-tick physics-drop hashes equal the Node golden @determinism', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
    await page.goto('/qa/determinism.html');
    await page.waitForSelector('html[data-dv-determinism="done"]', { state: 'attached', timeout: 200_000 });

    const result = await page.evaluate(() => {
      const qa = (window as unknown as { __dvBridge?: { engine?: { qa: Record<string, unknown> } } }).__dvBridge?.engine?.qa;
      return (qa?.['determinism'] ?? null) as Result | null;
    });
    expect(result, 'the page published a determinism result').not.toBeNull();
    const r = result as Result;
    console.log(
      `${testInfo.project.name}: vectors ${r.vectors.mismatches}/${r.vectors.total} mismatches, final ${r.final}, init ${r.initMs.toFixed(0)} ms, run ${r.runMs.toFixed(0)} ms`,
    );

    expect(r.vectors.first).toBeNull();
    expect(r.vectors.mismatches).toBe(0);
    expect(r.vectors.total).toBeGreaterThan(20_000);
    for (const group of ['detmath.dsqrt', 'detmath.dsin', 'detmath.datan2', 'rng.xoshiro', 'ctr', 'fnv']) {
      expect(r.vectors.groups[group]?.total, group).toBeGreaterThan(0);
    }
    expect(r.physicsBuild).toBe(golden.physicsBuild);
    expect(r.ticks).toBe(golden.ticks);
    expect(Object.keys(r.checkpoints)).toHaveLength(16);
    expect(r.checkpoints).toEqual(golden.checkpoints);
    expect(r.final).toBe(golden.final);
  });
});
