import { env, introspectWorkflow } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { CutsceneManifest } from '@dv/shared/contracts/c09-cutscene';
import type { JobOutcome } from '@dv/pipeline/core';
import { bindings, fixtureOrigSha, keyOf, mockCalls, prewarm, waitForState } from './cutscene-helpers.ts';

describe('GenJobWorkflow poll fallback (AC-2)', () => {
  it('a dropped webhook times out waitForEvent and polling completes the job, manifest written last', { timeout: 60_000 }, async () => {
    await using introspector = await introspectWorkflow(env.GEN_WF);
    await introspector.modifyAll(async (m) => {
      await m.forceEventTimeout({ name: 'fal-done' });
      await m.disableRetryDelays();
    });
    const key = keyOf('poll-fallback');
    expect((await prewarm([key])).status).toBe(202);

    const [instance] = await introspector.get();
    expect(instance).toBeDefined();
    await instance!.waitForStatus('complete');

    const out = (await instance!.getOutput()) as JobOutcome;
    expect(out.status).toBe('ready');
    expect(out.webhook).toBe('timeout');
    // the step log: the original first, the manifest last
    const manifestKey = `cutscenes/${key}/manifest.json`;
    expect(out.writes[0]).toBe(`cutscenes-orig/${key}/orig.mp4`);
    expect(out.writes.at(-1)).toBe(manifestKey);
    expect(out.writes.filter((w) => w === manifestKey)).toHaveLength(1);
    for (const f of ['v768.mp4', 'v540.mp4', 'poster.webp', 'last.webp', 'subs.en.vtt']) expect(out.writes).toContain(`cutscenes/${key}/${f}`);

    // polling produced the result
    expect(await instance!.waitForStepResult({ name: 'poll' })).toMatchObject({ contentType: 'video/mp4' });

    const ready = await waitForState(key, 'ready');
    expect(ready.state).toBe('ready');
    expect(await mockCalls('submit', key)).toBe(1);

    const manifest = (await (await bindings().MEDIA.get(manifestKey))!.json()) as CutsceneManifest;
    expect(manifest.schema).toBe('cutscene-asset/1');
    expect(manifest.provenance).toMatchObject({ aiGenerated: true, resigned: true, origSha256: fixtureOrigSha() });
    expect(manifest.renditions.v768?.file).toBe('v768.mp4');
    expect(manifest.subs).toEqual({ en: 'subs.en.vtt' });
  });
});
