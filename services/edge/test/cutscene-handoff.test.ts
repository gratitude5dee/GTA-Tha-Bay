import { env, introspectWorkflow } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildCutsceneManifest, finishKeyOf, finishOutKeyOf, handoffKeyOf, type CutsceneStatus, type FinishRecord, type HandoffRecord } from '@dv/shared';
import { fixtureBytes, fixtureEntry, planShots, r2Blob } from '@dv/pipeline/core';
import { buildCutsceneJob } from '../src/cutscenes/job.ts';
import { bindings, getStatus, keyOf, mockCalls, prewarm } from './cutscene-helpers.ts';

/**
 * M05c4 in workerd: the stream copy of the blob port into R2, and the publish phase of a handed-off key through route 28, the real
 * CutsceneJobDO and the real GenJobWorkflow (the pipeline scenarios of `pnpm check:pipeline` cover the same logic in Node with a fake object).
 * The staging configuration runs FAL_MODE=mock with TRANSCODE_MODE=mock; the publish phase makes no fal call in either mode.
 */
interface JobRpc {
  handoff(r: { costUsdMicros: number }): Promise<void>;
  inspect(): Promise<{ state: string; publishInstanceId: string | null; attempt: number }>;
}

const RUN = 'run-20261027-1';
const FILES = ['v768.mp4', 'v540.mp4', 'poster.webp', 'last.webp', 'subs.en.vtt'] as const;
const TYPE: Record<string, string> = { mp4: 'video/mp4', webp: 'image/webp', vtt: 'text/vtt' };

describe('r2Blob streams (workerd)', () => {
  it('putStream writes a stream of known length; copy moves a stream between buckets with its headers', async () => {
    const blob = r2Blob({ MEDIA: env.MEDIA, PRIVATE: env.PRIVATE });
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 7) & 255);
    await blob.putStream('PRIVATE', 'test-stream/a.bin', new Response(bytes).body!, bytes.length, { contentType: 'video/mp4' });
    const head = await env.PRIVATE.head('test-stream/a.bin');
    expect(head?.size).toBe(70_000);
    expect(head?.httpMetadata?.contentType).toBe('video/mp4');

    const n = await blob.copy({ bucket: 'PRIVATE', key: 'test-stream/a.bin' }, { bucket: 'MEDIA', key: 'test-stream/b.bin' }, { contentType: 'video/mp4', cacheControl: 'public, max-age=31536000, immutable' }, 70_000);
    expect(n).toBe(70_000);
    const copied = await env.MEDIA.head('test-stream/b.bin');
    expect(copied?.httpMetadata?.cacheControl).toBe('public, max-age=31536000, immutable');
    expect(await blob.copy({ bucket: 'PRIVATE', key: 'test-stream/none' }, { bucket: 'MEDIA', key: 'test-stream/c.bin' })).toBeNull();
    await expect(blob.copy({ bucket: 'PRIVATE', key: 'test-stream/a.bin' }, { bucket: 'MEDIA', key: 'test-stream/d.bin' }, undefined, 5)).rejects.toThrow(/holds 70000 bytes, expected 5/);
    expect(await env.MEDIA.head('test-stream/d.bin')).toBeNull();
  });
});

describe('route 28 on a handed-off key (workerd)', () => {
  async function seed(key: string): Promise<void> {
    const job = buildCutsceneJob(key, bindings(), 'test');
    const plan = planShots(job);
    const handoff: HandoffRecord = {
      schema: 'cutscene-handoff/1', key, jobKey: job.jobKey, job, plan, requestId: 'mock-1', providerKey: job.endpointKey, endpoint: 'fal-ai/test', pinnedUpdatedAt: '', characters: [],
      licence: { gate: 'ADR-GENAI-01', provider: job.endpointKey, status: 'pending', termsSnapshotSha256: [] }, subs: {}, costUsdMicros: 0, at: Date.now(),
    };
    await env.PRIVATE.put(handoffKeyOf(key), JSON.stringify(handoff));
    const stub = env.CUTSCENE_JOB.get(env.CUTSCENE_JOB.idFromName(`cut:${key}`)) as unknown as JobRpc;
    await stub.handoff({ costUsdMicros: 0 });
  }

  async function finish(key: string): Promise<void> {
    const job = buildCutsceneJob(key, bindings(), 'test');
    const metas = FILES.map((file) => {
      const e = fixtureEntry(file);
      return { file, bytes: e.bytes, sha256: e.sha256, contentType: TYPE[file.split('.').pop()!]!, ...(e.codecs !== undefined ? { codecs: e.codecs } : {}) };
    });
    const signed = Object.fromEntries(['v768.mp4', 'v540.mp4'].map((f) => [f, { sha256: fixtureEntry(f).sha256, bytes: fixtureEntry(f).bytes, c2pa: 'valid-untrusted' }]));
    const manifest = buildCutsceneManifest({
      key, plan: planShots(job), characters: [], licence: { gate: 'ADR-GENAI-01', provider: job.endpointKey, status: 'pending', termsSnapshotSha256: [] }, endpoint: 'fal-ai/test', pinnedUpdatedAt: '',
      requestId: 'mock-1', origSha256: fixtureEntry('orig.mp4').sha256, frames: 48, width: 128, height: 72, renditions: { v768: 'v768.mp4', v540: 'v540.mp4' }, files: metas, signed, origC2pa: 'absent', subs: { en: 'subs.en.vtt' },
    });
    const record: FinishRecord = { schema: 'cutscene-finish/1', key, runId: RUN, manifest, at: Date.now(), files: metas.map((m) => ({ file: m.file, bytes: m.bytes, sha256: m.sha256, contentType: m.contentType, cacheClass: 'immutable' as const })) };
    for (const f of FILES) await env.PRIVATE.put(finishOutKeyOf(key, RUN, f), fixtureBytes(f));
    await env.PRIVATE.put(finishKeyOf(key), JSON.stringify(record));
  }

  it('without finish.json the key stays pending and no instance starts; with it the publish phase copies the files and writes the manifest last', { timeout: 60_000 }, async () => {
    await using introspector = await introspectWorkflow(env.GEN_WF);
    const key = keyOf('handed-off');
    await seed(key);
    const stub = env.CUTSCENE_JOB.get(env.CUTSCENE_JOB.idFromName(`cut:${key}`)) as unknown as JobRpc;

    // route 27 maps handed_off to pending; route 28 starts nothing while finish.json is missing
    expect(await getStatus(key)).toMatchObject({ key, state: 'pending' });
    const first = await prewarm([key]);
    expect(((await first.json()) as { keys: CutsceneStatus[] }).keys[0]?.state).toBe('pending');
    expect(await introspector.get()).toHaveLength(0);
    expect((await stub.inspect()).state).toBe('handed_off');

    // the operator's finish lands; the next route 28 call starts exactly one publish instance, a second call during it starts none
    await finish(key);
    const calls = await Promise.all([prewarm([key]), prewarm([key])]);
    for (const res of calls) expect(((await res.json()) as { keys: CutsceneStatus[] }).keys[0]?.state).toBe('pending');
    const instances = await introspector.get();
    expect(instances).toHaveLength(1);
    await instances[0]!.waitForStatus('complete');

    const listed = (await env.MEDIA.list({ prefix: `cutscenes/${key}/` })).objects;
    expect(listed.map((o) => o.key).sort()).toEqual([...FILES, 'manifest.json'].map((f) => `cutscenes/${key}/${f}`).sort());
    const manifestObj = listed.find((o) => o.key.endsWith('manifest.json'))!;
    for (const o of listed.filter((x) => x !== manifestObj)) expect(manifestObj.uploaded.getTime(), o.key).toBeGreaterThanOrEqual(o.uploaded.getTime()); // written last
    expect((await env.MEDIA.head(`cutscenes/${key}/v768.mp4`))?.httpMetadata?.cacheControl).toBe('public, max-age=31536000, immutable');
    expect(await getStatus(key)).toMatchObject({ key, state: 'ready' });
    expect(await mockCalls('submit', key)).toBe(0); // no fal call in the publish phase
  });
});
