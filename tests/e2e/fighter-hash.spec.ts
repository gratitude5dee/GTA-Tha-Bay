import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { FightCore, NULL_SINK, decodeInputs, decodeReplay, hashBuffer } from '../../packages/shared/src/fight/index.ts';
import { loadPack } from '../../packages/modes/fighter/src/pack-files.ts';

/**
 * M08a2 AC-2, @fighter-hash: each golden `.dvfight` of the mode replays in this browser's JS engine, inside the sim worker
 * (`window.__dvBridge.fighter.replay`, QA builds, `?fighter=1`). Every 60-tick checkpoint must match the recording, the match ends
 * with the recorded winner and rounds, and the final buffer hash equals the one the Node core computes for the same inputs.
 *
 * To see it by hand: open `/?fighter=1` on a QA build and run `await __dvBridge.fighter.replay(text)` with the text of a file in
 * `packages/modes/fighter/golden/`; the result has `ok: true` and `badAt: null`.
 */
const root = new URL('../../', import.meta.url);
const dir = new URL('packages/modes/fighter/golden/', root);
const files = readdirSync(dir).filter((f) => f.endsWith('.dvfight')).sort();

function nodeFinalHash(text: string): [number, number] {
  const r = decodeReplay(text);
  const pack = loadPack(new URL('.', root).pathname);
  const sim = new FightCore();
  const buf = sim.init(pack, r.rules, r.seed, r.lineup);
  const in0 = decodeInputs(r.inputs[0]), in1 = decodeInputs(r.inputs[1]);
  const n = Math.min(in0.length, in1.length);
  for (let t = 0; t < n; t++) sim.step(buf, in0[t] as number, in1[t] as number, NULL_SINK);
  return hashBuffer(buf);
}

test.describe('fighter determinism @fighter-hash', () => {
  test('the goldens replay to their checkpoints in the sim worker @fighter-hash', async ({ page, browserName }, testInfo) => {
    test.setTimeout(240_000);
    expect(files.length).toBeGreaterThanOrEqual(2);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?fighter=1&world=walk-drop');
    await page.waitForFunction(() => Boolean((window as unknown as { __dvBridge?: { fighter?: unknown } }).__dvBridge?.fighter), undefined, { timeout: 150_000 });
    for (const f of files) {
      const text = readFileSync(new URL(f, dir), 'utf8');
      const want = decodeReplay(text);
      const got = await page.evaluate(async (t) => {
        const b = (window as unknown as { __dvBridge: { fighter: { replay(t: string, ms?: number): Promise<unknown>; hash(): Promise<[number, number] | null> } } }).__dvBridge.fighter;
        const vm = (await b.replay(t, 120_000)) as { ok: boolean; done: boolean; badAt: number | null; winner: number; rounds: [number, number]; checkpoints: number; ticks: number } | null;
        return { vm, hash: await b.hash() };
      }, text);
      console.log(`${testInfo.project.name} (${browserName}) ${f}: ${JSON.stringify(got.vm)} hash ${JSON.stringify(got.hash)}`);
      expect(got.vm, f).not.toBeNull();
      expect(got.vm?.done, `${f} done`).toBe(true);
      expect(got.vm?.ok, `${f} every checkpoint matches`).toBe(true);
      expect(got.vm?.badAt, `${f} first bad checkpoint`).toBeNull();
      expect(got.vm?.winner, `${f} winner`).toBe(want.final.winner);
      expect(got.vm?.rounds, `${f} rounds`).toEqual(want.final.rounds);
      expect(got.vm?.checkpoints, `${f} checkpoints compared`).toBe(want.checkpoints.hashes.length);
      expect(got.hash, `${f} final buffer hash equals the Node core's`).toEqual(nodeFinalHash(text));
    }
    expect(errors).toEqual([]);
  });
});
