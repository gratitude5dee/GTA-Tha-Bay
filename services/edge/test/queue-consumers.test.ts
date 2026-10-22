import { createExecutionContext, createMessageBatch, env, getQueueResult } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SpendEvent } from '@dv/shared';
import type { Env } from '../src/env.ts';
import { uuidv7 } from '../src/uuidv7.ts';
import { harness, type Harness } from './npc-helpers.ts';

// The consumers of tha-bay-jobs and tha-bay-spend (M06a1). Previews run none; these tests deliver batches by hand.
let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.dispose());

const spendEvent = (usd: number, requestId: string): SpendEvent => ({ ts: h.clock.t, vendor: 'anthropic', model: 'claude-haiku-5-5', kind: 'dialogue', usdMicros: usd, settled: true, requestId, env: 'test' });

describe('queue consumers', () => {
  it('the spend queue delivers settled turn costs into BudgetGovernorDO.ingest, once each', async () => {
    const gov = env.GOVERNOR.get(env.GOVERNOR.idFromName(`gov:${env.ENVIRONMENT}`)) as unknown as { spentMicros(v: string): Promise<number> };
    const before = await gov.spentMicros('anthropic');
    const id = uuidv7();
    const batch = createMessageBatch('tha-bay-spend-staging', [
      { id: 'm1', timestamp: new Date(), attempts: 1, body: spendEvent(300, `req-${id}-1`) },
      { id: 'm2', timestamp: new Date(), attempts: 1, body: spendEvent(450, `req-${id}-2`) },
    ]);
    const ctx = createExecutionContext();
    await h.app.queue(batch, env as unknown as Env);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks.length + (result.ackAll ? 2 : 0)).toBeGreaterThan(0);
    expect(await gov.spentMicros('anthropic')).toBe(before + 750);
    // the same batch again changes nothing (ingest is idempotent by request id)
    await h.app.queue(createMessageBatch('tha-bay-spend-staging', [{ id: 'm1', timestamp: new Date(), attempts: 2, body: spendEvent(300, `req-${id}-1`) }]), env as unknown as Env);
    expect(await gov.spentMicros('anthropic')).toBe(before + 750);
  });

  it('the jobs queue runs forget and export, acknowledges summarize (its consumer is M06a4), and retries a job that throws', async () => {
    const pid = uuidv7();
    await h.port.profiles.ensureLocal(pid, `dkt-${pid}`);
    await h.port.npcMemory.write(pid, 'npc_a', [{ kind: 'event', text: 't', importance: 1, gameTime: 1, source: 'dialogue', embedding: new Float32Array(1024) }]);
    const first = createMessageBatch('tha-bay-jobs-staging', [
      { id: 'j1', timestamp: new Date(), attempts: 1, body: { type: 'export', profileId: pid, exportId: '1790000000000' } },
      { id: 'j2', timestamp: new Date(), attempts: 1, body: { type: 'summarize', encounterId: 'e', profileId: pid, npcId: 'npc_a', soulVersion: 1, r2Key: 'transcripts/e.jsonl' } },
    ]);
    await h.app.queue(first, env as unknown as Env);
    const r1 = await getQueueResult(first, createExecutionContext());
    expect(r1.explicitAcks.sort()).toEqual(['j1', 'j2']);
    expect(r1.retryMessages).toEqual([]);
    expect(await env.PRIVATE.head(`exports/${pid}/1790000000000.zip`)).not.toBeNull();
    expect(h.logs.some((l) => l.includes('job.summarize'))).toBe(true);

    const second = createMessageBatch('tha-bay-jobs-staging', [{ id: 'j3', timestamp: new Date(), attempts: 1, body: { type: 'forget', profileId: pid } }]);
    await h.app.queue(second, env as unknown as Env);
    const r2a = await getQueueResult(second, createExecutionContext());
    expect(r2a.explicitAcks).toEqual(['j3']);
    expect(h.port.rowsFor(pid)).toEqual({});
    expect(await env.PRIVATE.head(`exports/${pid}/1790000000000.zip`)).toBeNull(); // the forget job removed the export too

    // A handler that throws is retried, not lost: the database is gone for this app.
    const { createApp } = await import('../src/index.ts');
    const broken = createApp({ data: () => ({ maintenance: { transcriptKeys: () => Promise.reject(new Error('down')) } }) as never, now: () => h.clock.t });
    const again = createMessageBatch('tha-bay-jobs-staging', [{ id: 'k1', timestamp: new Date(), attempts: 1, body: { type: 'forget', profileId: pid } }]);
    await broken.queue(again, env as unknown as Env);
    const r2 = await getQueueResult(again, createExecutionContext());
    expect(r2.retryMessages.map((m) => m.msgId)).toEqual(['k1']);
  });

  it('an unknown queue is acknowledged and logged, never left to retry forever', async () => {
    const batch = createMessageBatch('some-other-queue', [{ id: 'x', timestamp: new Date(), attempts: 1, body: {} }]);
    await h.app.queue(batch, env as unknown as Env);
    const result = await getQueueResult(batch, createExecutionContext());
    expect(result.ackAll).toBe(true);
  });
});
