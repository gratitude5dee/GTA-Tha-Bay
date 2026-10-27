/**
 * M05c4 AC-6 (scenario `prewarm-act1-publish`, part of `pnpm check:pipeline`): the publish phase of a handed-off key.
 *
 * Route 28 on a handed-off key with `finish.json` starts a Workflow instance in phase `publish`. It re-runs the resign gate (kill state,
 * consent, licence), copies the files listed in `finish.json` from `out/<runId>/` into MEDIA as streams, writes `manifest.json` last,
 * and makes 0 FalPort calls. A refusal writes nothing to MEDIA and leaves `refused.json`: a kill blocks the key, a de-cleared provider
 * leaves it handed off. Runs the real CutsceneJobDO class and `runCutsceneJob` in Node over Miniflare's R2.
 */
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { FINISH_MAX_BYTES, buildCutsceneManifest, finishKeyOf, finishOutKeyOf, handoffKeyOf, type FinishRecord, type HandoffRecord } from '@dv/shared';
import { fixtureBytes, fixtureEntry, planShots } from '../src/core.ts';
import { Harness, registryWith } from './helpers/offedge-harness.ts';

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ MEDIA: R2Bucket; PRIVATE: R2Bucket }>>>;
beforeAll(async () => {
  process.env['WRANGLER_LOG'] ??= 'error';
  const configPath = path.resolve(import.meta.dirname, '../../edge/wrangler.jsonc');
  proxy = await getPlatformProxy({ configPath, environment: 'staging', persist: false, remoteBindings: false });
});
afterAll(async () => {
  await proxy.dispose();
});

const keyOf = (label: string): string => [...label].reduce((h, c) => (h + c.charCodeAt(0).toString(16)).slice(-64), '').padStart(64, 'b').slice(-64);
const RUN = 'run-20261027-1';
const FILES = ['v768.mp4', 'v540.mp4', 'poster.webp', 'last.webp', 'subs.en.vtt'] as const;
const TYPE: Record<string, string> = { mp4: 'video/mp4', webp: 'image/webp', vtt: 'text/vtt' };

/** What the Worker and the operator leave behind: the DO in `handed_off`, handoff.json, orig.mp4, finish.json and the files under out/<runId>/. */
async function seed(h: Harness, key: string, o: { characters?: { id: string; soulVersion: number; tier: 'fictionalized' }[]; finishPad?: number; dropFile?: string } = {}): Promise<void> {
  const { PRIVATE } = proxy.env;
  const characters = o.characters ?? [];
  const job = h.jobFor(key, { characters });
  const plan = planShots(job);
  const handoff: HandoffRecord = {
    schema: 'cutscene-handoff/1', key, jobKey: job.jobKey, job, plan, requestId: `mock-${key.slice(0, 8)}`, providerKey: job.endpointKey, endpoint: 'fal-ai/test',
    pinnedUpdatedAt: '', characters, licence: { gate: 'ADR-GENAI-01', provider: job.endpointKey, status: 'cleared', termsSnapshotSha256: [] },
    subs: { en: 'WEBVTT\n' }, costUsdMicros: 1_000_000, at: Date.now(),
  };
  await PRIVATE.put(handoffKeyOf(key), JSON.stringify(handoff));
  await PRIVATE.put(`cutscenes-orig/${key}/orig.mp4`, fixtureBytes('orig.mp4'));
  const metas = FILES.map((file) => {
    const e = fixtureEntry(file);
    return { file, bytes: e.bytes, sha256: e.sha256, contentType: TYPE[file.split('.').pop()!]!, ...(e.codecs !== undefined ? { codecs: e.codecs } : {}) };
  });
  const signed = Object.fromEntries(['v768.mp4', 'v540.mp4'].map((f) => [f, { sha256: fixtureEntry(f).sha256, bytes: fixtureEntry(f).bytes, c2pa: 'valid-untrusted' }]));
  const manifest = buildCutsceneManifest({
    key, plan, characters, licence: handoff.licence, endpoint: handoff.endpoint, pinnedUpdatedAt: '', requestId: handoff.requestId,
    origSha256: fixtureEntry('orig.mp4').sha256, frames: 48, width: 128, height: 72, renditions: { v768: 'v768.mp4', v540: 'v540.mp4' }, files: metas, signed,
    origC2pa: 'absent', subs: { en: 'subs.en.vtt' },
  });
  const finish: FinishRecord = {
    schema: 'cutscene-finish/1', key, runId: RUN, manifest, at: Date.now(),
    files: metas.map((m) => ({ file: m.file, bytes: m.bytes, sha256: m.sha256, contentType: m.contentType, cacheClass: 'immutable' as const })),
  };
  for (const f of FILES) if (f !== o.dropFile) await PRIVATE.put(finishOutKeyOf(key, RUN, f), fixtureBytes(f));
  const body = JSON.stringify(o.finishPad !== undefined ? { ...finish, pad: 'x'.repeat(o.finishPad) } : finish);
  await PRIVATE.put(finishKeyOf(key), body);
  await h.objectOf(key).handoff({ costUsdMicros: 1_000_000 });
}

const mediaKeys = async (key: string): Promise<string[]> => (await proxy.env.MEDIA.list({ prefix: `cutscenes/${key}/` })).objects.map((o) => o.key);

describe('prewarm-act1-publish: route 28 on a handed-off key with finish.json (AC-6)', () => {
  it('copies the files, writes the manifest last, answers ready, and calls fal never; a killed cast gets nothing and blocks; a de-cleared provider gets nothing and stays handed off', async () => {
    const { MEDIA, PRIVATE } = proxy.env;
    const h = new Harness({ MEDIA, PRIVATE, falMode: 'live', transcodeMode: 'offedge', registry: registryWith('cleared'), killed: new Set(['npc:killed-test']) });
    const good = keyOf('publish-good');
    const killed = keyOf('publish-killed');
    await seed(h, good);
    await seed(h, killed, { characters: [{ id: 'npc:killed-test', soulVersion: 1, tier: 'fictionalized' }] });

    // before the call nothing is public; route 27 says pending
    expect(await mediaKeys(good)).toEqual([]);
    expect(await h.objectOf(good).status(good)).toEqual({ key: good, state: 'pending' });

    const calls = await h.routePrewarm([good, killed]);
    expect(calls.map((c) => c.state)).toEqual(['pending', 'pending']);
    // a second call while the publish runs starts no second instance
    await h.routePrewarm([good]);
    await h.idle();
    expect(h.errors).toEqual([]);
    expect(h.counters.publishInstances).toBe(2); // one per key
    expect(h.counters.falCalls).toBe(0);
    expect(h.counters.reserves).toBe(0);
    expect(h.counters.settles).toBe(0); // the spend was settled at the hand-off

    // the clean key: every file copied with its content type and cache class, the manifest last
    const okOut = h.outcomes.get(good)!;
    expect(okOut.status).toBe('ready');
    expect(okOut.writes).toEqual([...FILES.map((f) => `cutscenes/${good}/${f}`), `cutscenes/${good}/manifest.json`]);
    expect((await mediaKeys(good)).sort()).toEqual([...FILES, 'manifest.json'].map((f) => `cutscenes/${good}/${f}`).sort());
    const v768 = await MEDIA.head(`cutscenes/${good}/v768.mp4`);
    expect(v768?.httpMetadata?.contentType).toBe('video/mp4');
    expect(v768?.httpMetadata?.cacheControl).toBe('public, max-age=31536000, immutable');
    expect(v768?.size).toBe(fixtureEntry('v768.mp4').bytes);
    const manifest = (await (await MEDIA.get(`cutscenes/${good}/manifest.json`))!.json()) as { provenance: { aiGenerated: boolean; resigned: boolean; origSha256: string }; renditions: Record<string, unknown> };
    expect(manifest.provenance).toMatchObject({ aiGenerated: true, resigned: true, origSha256: fixtureEntry('orig.mp4').sha256 });
    expect(Object.keys(manifest.renditions).sort()).toEqual(['v540', 'v768']);
    expect(await h.objectOf(good).status(good)).toMatchObject({ key: good, state: 'ready' });
    expect(h.counters.blobOps).toBeLessThan(40 * 2); // both keys together; the per-instance bound is asserted below

    // the killed key: no MEDIA write, refused.json with the gate code, route 27 blocked
    expect(h.outcomes.get(killed)).toMatchObject({ status: 'refused', code: 'KILLED' });
    expect(await mediaKeys(killed)).toEqual([]);
    const refused = (await (await PRIVATE.get(`cutscenes-orig/${killed}/refused.json`))!.json()) as { code: string; runId: string };
    expect(refused).toMatchObject({ code: 'KILLED', runId: RUN });
    expect(await h.objectOf(killed).status(killed)).toEqual({ key: killed, state: 'blocked' });

    // a third key under a registry whose provider is no longer cleared: nothing reaches MEDIA, and the key stays handed off
    const pending = new Harness({ MEDIA, PRIVATE, falMode: 'live', transcodeMode: 'offedge', registry: registryWith('pending') });
    const third = keyOf('publish-pending');
    await seed(pending, third);
    await pending.routePrewarm([third]);
    await pending.idle();
    expect(pending.outcomes.get(third)).toMatchObject({ status: 'refused', code: 'ENDPOINT_NOT_CLEARED' });
    expect(await mediaKeys(third)).toEqual([]);
    expect(((await (await PRIVATE.get(`cutscenes-orig/${third}/refused.json`))!.json()) as { code: string }).code).toBe('ENDPOINT_NOT_CLEARED');
    expect((await pending.objectOf(third).inspect()).state).toBe('handed_off');
    expect(await pending.objectOf(third).status(third)).toEqual({ key: third, state: 'pending' });
    expect(pending.counters.falCalls).toBe(0);
    // ... and once the provider is cleared again, the next route 28 call publishes it
    const again = new Harness({ MEDIA, PRIVATE, falMode: 'live', transcodeMode: 'offedge', registry: registryWith('cleared') });
    await seed(again, third);
    await again.routePrewarm([third]);
    await again.idle();
    expect(again.outcomes.get(third)?.status).toBe('ready');
  });

  it('stays under 40 subrequests for one clip', async () => {
    const { MEDIA, PRIVATE } = proxy.env;
    const h = new Harness({ MEDIA, PRIVATE, falMode: 'live', transcodeMode: 'offedge', registry: registryWith('cleared') });
    const key = keyOf('publish-ops');
    await seed(h, key);
    const before = h.counters.blobOps;
    await h.routePrewarm([key]);
    await h.idle();
    expect(h.outcomes.get(key)?.status).toBe('ready');
    expect(h.counters.blobOps - before).toBeLessThan(40);
  });

  it('refuses without a MEDIA write when finish.json is oversized, or when a listed file is missing; a handed-off key without finish.json starts nothing', async () => {
    const { MEDIA, PRIVATE } = proxy.env;
    const h = new Harness({ MEDIA, PRIVATE, falMode: 'live', transcodeMode: 'offedge', registry: registryWith('cleared') });
    const big = keyOf('publish-oversize');
    const missing = keyOf('publish-missing');
    const waiting = keyOf('publish-waiting');
    await seed(h, big, { finishPad: FINISH_MAX_BYTES });
    await seed(h, missing, { dropFile: 'last.webp' });
    await h.objectOf(waiting).handoff({ costUsdMicros: 1 });
    await h.routePrewarm([big, missing, waiting]);
    await h.idle();
    expect(h.outcomes.get(big)).toMatchObject({ status: 'refused' });
    expect(h.outcomes.get(big)?.detail).toMatch(/over the 65536 limit/);
    expect(h.outcomes.get(missing)).toMatchObject({ status: 'refused' });
    expect(h.outcomes.get(missing)?.detail).toMatch(/last\.webp is missing/);
    expect(await mediaKeys(big)).toEqual([]);
    expect(await mediaKeys(missing)).toEqual([]);
    expect(h.outcomes.has(waiting)).toBe(false); // no finish.json: no instance
    expect(h.counters.publishInstances).toBe(2);
    expect((await h.objectOf(waiting).inspect()).state).toBe('handed_off');
    expect(h.counters.falCalls).toBe(0);
  });
});
