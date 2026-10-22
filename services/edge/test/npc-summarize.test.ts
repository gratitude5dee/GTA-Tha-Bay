import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import type { InMemoryDataPort } from '@dv/shared/data-port.memory';
import type { Env } from '../src/env.ts';
import { handleJob } from '../src/ops/jobs.ts';
import { runSummarize } from '../src/npc/summarize.ts';
import { buildStream, setFixtureSourceForTests } from '../src/npc/upstream-fixture.ts';
import { setTimingForTests, setUpstreamForTests } from '../src/npc/upstream.ts';
import { setQueueSinksForTests, type JobMessage } from '../src/ops/queue.ts';
import { fakeAi, withAi } from './ai-helpers.ts';
import { harness, type Harness } from './npc-helpers.ts';
import { find, FIXTURES, ManualClock, request, talkSetup, type Talk } from './talk-helpers.ts';
import summaryCompress from './fixtures/anthropic/summary-compress.sse?raw';
import summaryExtreme from './fixtures/anthropic/summary-extreme.sse?raw';
import summaryHappy from './fixtures/anthropic/summary-happy.sse?raw';
import summaryReflection from './fixtures/anthropic/summary-reflection.sse?raw';
import summaryWordy from './fixtures/anthropic/summary-wordy.sse?raw';

// M06a4 AC-3: a closed encounter is folded into the relationship summary: <= 1,200 characters, encounters + 1, deltas clamped to +-10,
// and the 10th encounter of a pair adds one reflection memory at importance 8.
type Summarize = Extract<JobMessage, { type: 'summarize' }>;

let h: Harness;
let t: Talk | null = null;
afterEach(() => {
  setFixtureSourceForTests(null);
  setUpstreamForTests(null);
  setTimingForTests(null);
  setQueueSinksForTests({ jobs: null, spend: null });
  if (t !== null) t.dispose();
  else h?.dispose();
  t = null;
});

let seq = 0;
const PID = '0198aaaa-0000-7000-8000-00000000a001';

/** The transcript EncounterDO would have written: a rendered scene per player turn and the model's JSON per answer. */
function transcript(turns: { player: string; line: string }[], clockT = 7200): string {
  return (
    turns
      .flatMap((x, i) => [
        { i: i * 2, role: 'user', content: `<scene t="${clockT}" hour="02:00"/>\n<memory summary=""></memory>\n<player intent="smalltalk">${x.player}</player>\n`, at: 1 },
        { i: i * 2 + 1, role: 'assistant', content: JSON.stringify({ line: x.line, emotion: 'neutral' }), at: 2 },
      ])
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n'
  );
}

async function setup(chooser: (intent: string) => string): Promise<{ msg: Summarize; spend: unknown[] }> {
  h = harness({ env: { AI: fakeAi().ai } });
  const clock = new ManualClock();
  setTimingForTests(clock);
  setUpstreamForTests(null);
  setFixtureSourceForTests((req) => chooser(req.intent));
  await h.port.profiles.ensureLocal(PID, 'dkt-1');
  const spend: unknown[] = [];
  setQueueSinksForTests({ spend: (e) => spend.push(e) });
  const eid = `enc-${++seq}-${Date.now()}`;
  await env.PRIVATE.put(`transcripts/${eid}.jsonl`, transcript([{ player: 'hello there', line: 'Good day. Is the lot clear?' }, { player: 'it is clear', line: 'Noted.' }]));
  return { msg: { type: 'summarize', encounterId: eid, profileId: PID, npcId: 'npc_test', soulVersion: 1, r2Key: `transcripts/${eid}.jsonl` }, spend };
}

const run = (msg: Summarize): ReturnType<typeof runSummarize> => runSummarize({ ...(env as unknown as Env), AI: fakeAiCached().ai }, { data: () => h.port, log: (l) => h.logs.push(l) }, msg);
let cached: ReturnType<typeof fakeAi> | null = null;
const fakeAiCached = (): ReturnType<typeof fakeAi> => (cached ??= fakeAi());

const relationship = async (): Promise<NonNullable<Awaited<ReturnType<InMemoryDataPort['npcMemory']['relationship']>>>> => (await h.port.npcMemory.relationship(PID, 'npc_test'))!;
const memories = async (): Promise<Record<string, unknown>[]> => (await h.port.maintenance.exportRows(PID))['npc_memory'] ?? [];

describe('the summarize consumer', () => {
  it('folds a closed encounter into the relationship: summary, encounters + 1, deltas, memories', async () => {
    cached = null;
    const { msg, spend } = await setup(() => summaryHappy);
    expect(await run(msg)).toBe('done');
    const rel = await relationship();
    expect(rel).toMatchObject({ affinity: 4, trust: 3, encounters: 1, soul_version: 1 });
    expect(rel.summary).toBe('The player came by the lot twice and kept a promise about the car.');
    expect(rel.summary.length).toBeLessThanOrEqual(1200);
    expect(rel.flags).toEqual({ met_at_lot: true });
    const rows = await memories();
    expect(rows.map((r) => [r['kind'], r['source'], r['game_time']])).toEqual([['promise', 'summary', 7200], ['preference', 'summary', 7200]]);
    expect(rows[0]!['importance']).toBe(6); // a promise is at least 6
    // the model spend was reported: 900 input tokens at $0.10 and 150 output tokens at $0.50 per million = 90 + 75 micros
    expect(spend).toHaveLength(1);
    expect(spend[0]).toMatchObject({ vendor: 'anthropic', model: 'claude-haiku-5-5', kind: 'summary', usdMicros: 165, requestId: msg.encounterId });
  });

  it('does it once: a redelivered message changes nothing', async () => {
    cached = null;
    const { msg } = await setup(() => summaryHappy);
    expect(await run(msg)).toBe('done');
    expect(await run(msg)).toBe('skipped');
    expect((await relationship()).encounters).toBe(1);
    expect(await memories()).toHaveLength(2);
  });

  it('clamps the deltas to +-10 and drops a reflection memory from an encounter that is not the 10th', async () => {
    cached = null;
    const { msg } = await setup(() => summaryExtreme);
    await run(msg);
    const rel = await relationship();
    expect(rel.affinity).toBe(10);
    expect(rel.trust).toBe(-10);
    const rows = await memories();
    expect(rows.map((r) => r['kind'])).toEqual(['event']);
  });

  it('adds exactly one reflection at importance 8 on the 10th encounter of the pair', async () => {
    cached = null;
    const { msg } = await setup(() => summaryReflection);
    for (let i = 0; i < 9; i++) {
      await h.port.npcMemory.applySummary(PID, 'npc_test', { summaryUpdate: `Talk ${i + 1}.`, memories: [], affinityDelta: 0, trustDelta: 0, flagsPatch: {}, soulVersion: 1, reflection: false });
    }
    expect((await relationship()).encounters).toBe(9);
    await run(msg);
    expect((await relationship()).encounters).toBe(10);
    const rows = await memories();
    const reflections = rows.filter((r) => r['kind'] === 'reflection');
    expect(reflections).toHaveLength(1);
    expect(reflections[0]).toMatchObject({ importance: 8, source: 'summary' });
    expect(rows).toHaveLength(2);
  });

  it('keeps the summary within 1,200 characters by re-summarizing, and by truncation when that fails', async () => {
    cached = null;
    const { msg } = await setup((intent) => (intent === 'summary-compress' ? summaryCompress : summaryWordy));
    // 1,100 characters of notes: the 540-character update would pass the limit
    await h.port.npcMemory.applySummary(PID, 'npc_test', { summaryUpdate: 'x'.repeat(600) + ' ' + 'y'.repeat(499), memories: [], affinityDelta: 0, trustDelta: 0, flagsPatch: {}, soulVersion: 1, reflection: false });
    expect((await relationship()).summary.length).toBe(1100);
    await run(msg);
    const rel = await relationship();
    expect(rel.summary).toBe('A regular at the lot who keeps promises and likes the red car.');
    expect(rel.encounters).toBe(2);

    // the second call fails: the port keeps the newest 1,200 characters
    cached = null;
    const again = await setup((intent) => (intent === 'summary-compress' ? ': status 529\n' : summaryWordy));
    await h.port.npcMemory.applySummary(PID, 'npc_test', { summaryUpdate: 'x'.repeat(600) + ' ' + 'y'.repeat(499), memories: [], affinityDelta: 0, trustDelta: 0, flagsPatch: {}, soulVersion: 1, reflection: false });
    await run(again.msg);
    const rel2 = await relationship();
    expect(rel2.summary.length).toBe(1200);
    expect(rel2.summary.endsWith('The player stayed to talk about the lot and the weather.')).toBe(true);
  });

  it('skips a transcript that is gone and a deployment without a database, and retries on an invalid model answer', async () => {
    cached = null;
    const { msg } = await setup(() => buildStream({ model: 'claude-haiku-5-5', answer: '{"summaryUpdate":1}' }));
    await expect(run(msg)).rejects.toThrow(); // thrown so Queues redelivers the message
    expect((await h.port.npcMemory.relationship(PID, 'npc_test'))).toBeNull();
    expect(await run({ ...msg, r2Key: 'transcripts/missing.jsonl' })).toBe('skipped');
    expect(await runSummarize(env as unknown as Env, { data: () => null, log: () => undefined }, msg)).toBe('skipped');
  });
});

describe('a talk that closes', () => {
  it('queues a summarize message that the consumer turns into a relationship', async () => {
    t = await talkSetup({ fixture: (req) => (req.intent === 'summary' ? summaryHappy : FIXTURES['happy']), env: withAi(fakeAi()) });
    const { frames } = await t.say(request({ turn: { text: 'hello there', intent: 'greet' } }));
    const encounterId = (find(frames, 'meta')!.data as { encounterId: string }).encounterId;
    const stub = env.ENCOUNTER.get(env.ENCOUNTER.idFromName(`enc:${t.pid}:npc_test:${encounterId}`)) as unknown as { close(): Promise<void> };
    await stub.close();
    const job = t.h.jobs.find((j) => j.type === 'summarize') as Summarize;
    expect(job).toMatchObject({ npcId: 'npc_test', profileId: t.pid, encounterId, soulVersion: 1 });
    await handleJob({ ...(env as unknown as Env), AI: fakeAi().ai }, { data: () => t!.h.port, log: () => undefined } as never, job);
    const rel = await t.h.port.npcMemory.relationship(t.pid, 'npc_test');
    expect(rel).toMatchObject({ encounters: 1, affinity: 4, trust: 3 });
  });
});
