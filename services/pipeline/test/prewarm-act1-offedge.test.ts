/**
 * M05c4 AC-1 and AC-2 (scenario `prewarm-act1-offedge`, part of `pnpm check:pipeline`): the hand-off phase on Workers Free.
 *
 * Runs the real CutsceneJobDO class and `runCutsceneJob` in Node over Miniflare's R2 and `MockFalPort`, with TRANSCODE_MODE=offedge:
 * each job ends after `copy-orig` with `orig.mp4` and `handoff.json` in PRIVATE and no manifest in MEDIA; route 27 answers `pending`;
 * no Worker step hashes more than 65,536 bytes (the mock output is 200,000 bytes); a second route 28 call starts no job and makes 0 FalPort
 * calls; the 2 h watchdog, the 1 h re-arm and a quarantine round trip leave the key handed off; and a live fal run paired with the mock
 * transcoder refuses before any budget is reserved.
 */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import type * as SharedModule from '@dv/shared';
import { Harness } from './helpers/offedge-harness.ts';

const hashed = vi.hoisted(() => ({ sizes: [] as number[] }));
vi.mock('@dv/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedModule>();
  return {
    ...actual,
    sha256Hex: (input: string | Uint8Array): string => {
      hashed.sizes.push(typeof input === 'string' ? new TextEncoder().encode(input).length : input.length);
      return actual.sha256Hex(input);
    },
  };
});

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ MEDIA: R2Bucket; PRIVATE: R2Bucket }>>>;
beforeAll(async () => {
  process.env['WRANGLER_LOG'] ??= 'error';
  const configPath = path.resolve(import.meta.dirname, '../../edge/wrangler.jsonc');
  proxy = await getPlatformProxy({ configPath, environment: 'staging', persist: false, remoteBindings: false });
});
afterAll(async () => {
  await proxy.dispose();
});

const keyOf = (label: string): string => [...label].reduce((h, c) => (h + c.charCodeAt(0).toString(16)).slice(-64), '').padStart(64, 'a').slice(-64);
const big = (): Uint8Array => new Uint8Array(200_000).map((_, i) => (i * 31) & 255);

describe('prewarm-act1-offedge: the hand-off phase (AC-1)', () => {
  it('ends each job after copy-orig; route 27 says pending; nothing large is hashed; a second route 28 starts nothing; the state survives the watchdog, the re-arm and a quarantine', async () => {
    const { MEDIA, PRIVATE } = proxy.env;
    const h = new Harness({ MEDIA, PRIVATE, falMode: 'mock', transcodeMode: 'offedge', streamBytes: big });
    const keys = [keyOf('offedge-one'), keyOf('offedge-two')];

    hashed.sizes.length = 0;
    const first = await h.routePrewarm(keys);
    expect(first.map((s) => s.state)).toEqual(['pending', 'pending']);
    await h.idle();
    expect(h.errors).toEqual([]);

    for (const key of keys) {
      const out = h.outcomes.get(key)!;
      expect(out.status).toBe('handed_off');
      // orig.mp4 and handoff.json are in PRIVATE, no manifest and no rendition in MEDIA
      expect((await PRIVATE.head(`cutscenes-orig/${key}/orig.mp4`))?.size).toBe(200_000);
      const handoff = (await (await PRIVATE.get(`cutscenes-orig/${key}/handoff.json`))!.json()) as { schema: string; key: string; requestId: string; plan: unknown[]; costUsdMicros: number; job: { jobKey: string } };
      expect(handoff).toMatchObject({ schema: 'cutscene-handoff/1', key });
      expect(handoff.requestId).toMatch(/^mock-/);
      expect(handoff.plan).toHaveLength(1);
      expect((await MEDIA.list({ prefix: `cutscenes/${key}/` })).objects).toEqual([]);
      // the Worker wrote the original and the hand-off, in that order, and nothing else
      expect(out.writes).toEqual([`cutscenes-orig/${key}/orig.mp4`, `cutscenes-orig/${key}/handoff.json`]);
      // route 27 maps the stored handed_off state to pending
      expect(await h.objectOf(key).status(key)).toEqual({ key, state: 'pending' });
      expect((await h.objectOf(key).inspect()).state).toBe('handed_off');
      expect(h.alarmOf(key)).toBeNull(); // no timer: nothing can time a handed-off key out
    }
    // no Worker step hashes a buffer larger than 65,536 bytes (the original is 200,000)
    expect(hashed.sizes.length).toBeGreaterThan(0); // the spy sees the small hashes (job keys, prompts)
    expect(Math.max(...hashed.sizes)).toBeLessThanOrEqual(65_536);
    expect(h.counters.settles).toBe(2);
    expect(h.recorder.count('submit')).toBe(2);

    // a second route 28 call for the same keys starts no job and makes 0 FalPort calls
    const callsBefore = h.counters.falCalls;
    const instancesBefore = h.counters.instancesStarted;
    const second = await h.routePrewarm(keys);
    await h.idle();
    expect(second.map((s) => s.state)).toEqual(['pending', 'pending']);
    expect(h.counters.instancesStarted).toBe(instancesBefore);
    expect(h.counters.falCalls).toBe(callsBefore);
    expect(h.recorder.count('submit')).toBe(2);

    // the 2 h watchdog and the 1 h re-arm leave the key handed off
    const key = keys[0]!;
    const realNow = Date.now;
    try {
      for (const hours of [1.5, 3, 5]) {
        Date.now = () => realNow() + hours * 3_600_000;
        await h.objectOf(key).alarm();
        expect(await h.objectOf(key).status(key)).toEqual({ key, state: 'pending' });
        expect((await h.objectOf(key).inspect()).state).toBe('handed_off');
        const again = await h.routePrewarm([key]);
        expect(again[0]!.state).toBe('pending');
      }
      // a failed publish does not return the key to absent either, and a refused publish with a non-kill code keeps it handed off
      await h.objectOf(key).fail('publish: something', 'POLICY_REFUSED');
      expect((await h.objectOf(key).inspect()).state).toBe('handed_off');
      await h.objectOf(key).reset(); // only the operator's reset ends the state without a manifest
      expect((await h.objectOf(key).inspect()).state).toBe('absent');
      await h.objectOf(key).handoff({ costUsdMicros: 1 });
    } finally {
      Date.now = realNow;
    }
    await h.idle();
    expect(h.counters.instancesStarted).toBe(instancesBefore);
    expect(h.counters.falCalls).toBe(callsBefore);

    // a quarantine followed by an unquarantine leaves the key handed off, not absent
    const other = keys[1]!;
    await h.objectOf(other).quarantine('kill:character');
    expect(await h.objectOf(other).status(other)).toEqual({ key: other, state: 'blocked' });
    await h.objectOf(other).unquarantine();
    expect((await h.objectOf(other).inspect()).state).toBe('handed_off');
    expect(await h.objectOf(other).status(other)).toEqual({ key: other, state: 'pending' });
    expect((await h.routePrewarm([other]))[0]!.state).toBe('pending');
    await h.idle();
    expect(h.counters.instancesStarted).toBe(instancesBefore);
  });

  it('never pays twice: a job that finds handoff.json (state reset, or a lost state) hands off again without a fal call', async () => {
    const { MEDIA, PRIVATE } = proxy.env;
    const h = new Harness({ MEDIA, PRIVATE, falMode: 'mock', transcodeMode: 'offedge' });
    const key = keyOf('offedge-again');
    await h.routePrewarm([key]);
    await h.idle();
    expect(h.recorder.count('submit')).toBe(1);
    await h.objectOf(key).reset(); // the state is gone, handoff.json is not
    await h.routePrewarm([key]);
    await h.idle();
    expect(h.recorder.count('submit')).toBe(1);
    expect((await h.objectOf(key).inspect()).state).toBe('handed_off');
  });
});

describe('prewarm-act1-offedge: the pairing rule (AC-2)', () => {
  it('FAL_MODE=live with TRANSCODE_MODE=mock refuses to start: no claim, no budget, no FalPort call', async () => {
    const { MEDIA, PRIVATE } = proxy.env;
    const h = new Harness({ MEDIA, PRIVATE, falMode: 'live', transcodeMode: 'mock' });
    const key = keyOf('pairing');
    const out = await h.routePrewarm([key]);
    await h.idle();
    expect(out[0]!.state).toBe('failed');
    expect(h.counters.instancesStarted).toBe(0);
    expect(h.counters.reserves).toBe(0);
    expect(h.counters.falCalls).toBe(0);
    expect((await h.objectOf(key).inspect()).state).toBe('absent'); // nothing was claimed

    // the run function refuses too (defence in depth: a Workflow started by other means)
    const direct = await h.runDirect(key, { mock: false, transcodeMode: 'mock' });
    expect(direct.outcome).toMatchObject({ status: 'refused', code: 'POLICY_REFUSED' });
    expect(direct.outcome.detail).toMatch(/TRANSCODE_MODE=mock cannot be paired with FAL_MODE=live/);
    expect(direct.failures).toHaveLength(1);
    expect(h.counters.reserves).toBe(0);
    expect(h.counters.falCalls).toBe(0);
  });

  it('TRANSCODE_MODE=container is not a mode on Workers Free', async () => {
    const { MEDIA, PRIVATE } = proxy.env;
    const h = new Harness({ MEDIA, PRIVATE, falMode: 'mock', transcodeMode: 'container' });
    const out = await h.routePrewarm([keyOf('container')]);
    expect(out[0]!.state).toBe('failed');
    expect(h.counters.instancesStarted).toBe(0);
  });
});
