import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryDataPort } from '@dv/shared/data-port.memory';
import { setClockForTests } from '../src/clock.ts';
import { setDataPortForTests } from '../src/data/index.ts';
import type { BeginResult, EncounterDO } from '../src/npc/EncounterDO.ts';
import { setQueueSinksForTests, type JobMessage } from '../src/ops/queue.ts';
import { uuidv7 } from '../src/uuidv7.ts';

// AC-3 (busy, cadence, turn_cap, alternating history) and AC-4 (the 60 s alarm writes the transcript, the row and the summarize message).
// The fake clock sits in the real future: an alarm set for a time before the real now would be run by workerd on its own.
const T0 = Date.UTC(2031, 0, 1, 12, 0, 0);
let clock = T0;
let jobs: JobMessage[] = [];
let port: InMemoryDataPort;
const usage = { inTok: 100, outTok: 20, cacheRead: 0, cacheWrite: 0, usdMicros: 120 };

beforeEach(() => {
  clock = T0;
  jobs = [];
  port = new InMemoryDataPort({ now: () => clock });
  setClockForTests(() => clock);
  setDataPortForTests(port);
  setQueueSinksForTests({ jobs: (m) => jobs.push(m) });
});
afterEach(() => {
  setClockForTests(null);
  setDataPortForTests(undefined);
  setQueueSinksForTests({ jobs: null });
});

interface Conv {
  pid: string;
  npcId: string;
  encounterId: string;
  name: string;
  stub: DurableObjectStub<EncounterDO>;
  begin(text: string, turnCap?: number): Promise<BeginResult>;
}

async function conversation(npcId = 'npc_test'): Promise<Conv> {
  const pid = uuidv7();
  await port.profiles.ensureLocal(pid, `dkt-${pid}`);
  const encounterId = uuidv7();
  const name = `enc:${pid}:${npcId}:${encounterId}`;
  const stub = env.ENCOUNTER.get(env.ENCOUNTER.idFromName(name)) as DurableObjectStub<EncounterDO>;
  return {
    pid, npcId, encounterId, name, stub,
    begin: (text, turnCap) => stub.begin({ profileId: pid, npcId, encounterId, soulVersion: 3, turn: { text }, ...(turnCap === undefined ? {} : { turnCap }) }),
  };
}

/** One full turn: begin, complete. */
async function turn(c: Conv, i: number): Promise<BeginResult> {
  const r = await c.begin(`player ${i}`);
  if (r.ok) await c.stub.complete(r.turnIndex, { text: `npc ${i}` }, usage);
  return r;
}

describe('EncounterDO keeps the history on the server (AC-3)', () => {
  it('answers busy while a turn streams, cadence under 1.5 s, and turn_cap on the 13th turn, in turn', async () => {
    const c = await conversation();
    const first = await c.begin('hello');
    expect(first).toEqual({ ok: true, turnIndex: 0, history: [] });
    expect(await c.begin('again')).toEqual({ ok: false, reason: 'busy' });

    await c.stub.complete(0, { text: 'hi there' }, usage);
    clock += 1200;
    expect(await c.begin('too soon')).toEqual({ ok: false, reason: 'cadence' });
    clock += 300; // 1.5 s after the first begin
    const second = await c.begin('second');
    expect(second).toMatchObject({ ok: true, turnIndex: 1 });
    expect((second as { history: unknown[] }).history).toEqual([
      { role: 'user', content: { text: 'hello' } },
      { role: 'assistant', content: { text: 'hi there' } },
    ]);
    await c.stub.complete(1, { text: 'second answer' }, usage);

    // turns 3 .. 12, then the 13th attempt
    for (let i = 3; i <= 12; i++) {
      clock += 2000;
      expect(await turn(c, i), `turn ${i}`).toMatchObject({ ok: true, turnIndex: i - 1 });
    }
    clock += 2000;
    expect(await c.begin('thirteenth')).toEqual({ ok: false, reason: 'turn_cap' });
    expect(await c.stub.status()).toMatchObject({ turns: 12, streaming: false, killed: false });
  });

  it('the hard cap is 20 whatever the soul asks for', async () => {
    const c = await conversation();
    for (let i = 1; i <= 20; i++) {
      clock += 2000;
      const r = await c.begin(`t${i}`, 99);
      expect(r.ok, `turn ${i}`).toBe(true);
      if (r.ok) await c.stub.complete(r.turnIndex, 'a', usage);
    }
    clock += 2000;
    expect(await c.begin('t21', 99)).toEqual({ ok: false, reason: 'turn_cap' });
  });

  it('a soul with a smaller cap stops sooner', async () => {
    const c = await conversation();
    for (let i = 1; i <= 3; i++) {
      clock += 2000;
      const r = await c.begin(`t${i}`, 3);
      if (r.ok) await c.stub.complete(r.turnIndex, 'a', usage);
    }
    clock += 2000;
    expect(await c.begin('t4', 3)).toEqual({ ok: false, reason: 'turn_cap' });
  });

  it('an aborted turn is absent from the next begin, and the history alternates user/assistant', async () => {
    const c = await conversation();
    await turn(c, 1);
    clock += 2000;
    expect(await c.begin('this one times out')).toMatchObject({ ok: true, turnIndex: 1 });
    await c.stub.abort(1, 'timeout');
    clock += 2000;
    const next = await c.begin('retry');
    expect(next).toMatchObject({ ok: true, turnIndex: 1 });
    const history = (next as { history: { role: string; content: unknown }[] }).history;
    expect(history.map((h) => h.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(history)).not.toContain('this one times out');
    await c.stub.complete(1, 'ok', usage);
    clock += 2000;
    const third = (await c.begin('third')) as { history: { role: string }[] };
    expect(third.history.map((h) => h.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('a stray or repeated complete and abort change nothing', async () => {
    const c = await conversation();
    expect(await c.begin('one')).toMatchObject({ ok: true });
    await c.stub.complete(5, 'wrong index', usage);
    expect(await c.stub.status()).toMatchObject({ turns: 0, streaming: true });
    await c.stub.complete(0, 'right', usage);
    await c.stub.complete(0, 'again', usage);
    await c.stub.abort(0, 'client_gone');
    expect(await c.stub.status()).toMatchObject({ turns: 1, streaming: false });
  });

  it('a stream that never reports back is abandoned after 90 s, not forever', async () => {
    const c = await conversation();
    expect(await c.begin('stuck')).toMatchObject({ ok: true });
    clock += 30_000;
    expect(await c.begin('blocked')).toEqual({ ok: false, reason: 'busy' });
    clock += 61_000;
    expect(await c.begin('after the watchdog')).toMatchObject({ ok: true, turnIndex: 0 });
  });
});

describe('the 60 s alarm closes the encounter (AC-4)', () => {
  it('writes transcripts/<encounterId>.jsonl, an encounter_transcripts row 30 days out, and one summarize message', async () => {
    const c = await conversation();
    await turn(c, 1);
    clock += 2000;
    await turn(c, 2);
    const lastTurnAt = clock;

    // Fired early: nothing is closed, the alarm is moved.
    clock += 30_000;
    await runDurableObjectAlarm(c.stub);
    expect(await env.PRIVATE.head(`transcripts/${c.encounterId}.jsonl`)).toBeNull();
    expect(jobs).toHaveLength(0);

    clock = lastTurnAt + 60_000;
    expect(await runDurableObjectAlarm(c.stub)).toBe(true);

    const obj = await env.PRIVATE.get(`transcripts/${c.encounterId}.jsonl`);
    expect(obj).not.toBeNull();
    const lines = (await obj!.text()).trim().split('\n').map((l) => JSON.parse(l) as { i: number; role: string; content: unknown });
    expect(lines.map((l) => l.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(lines.map((l) => l.i)).toEqual([0, 1, 2, 3]);

    const rows = port.transcripts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ encounter_id: c.encounterId, profile_id: c.pid, npc_id: 'npc_test', r2_key: `transcripts/${c.encounterId}.jsonl`, turns: 2, usd_micros: 240, closed_at: lastTurnAt + 60_000 });
    expect(rows[0]!.expires_at).toBe(rows[0]!.closed_at + 30 * 86_400_000);

    expect(jobs).toEqual([{ type: 'summarize', encounterId: c.encounterId, profileId: c.pid, npcId: 'npc_test', soulVersion: 3, r2Key: `transcripts/${c.encounterId}.jsonl` }]);

    // A second alarm and a late turn change nothing.
    await runDurableObjectAlarm(c.stub);
    expect(jobs).toHaveLength(1);
    clock += 5000;
    expect(await c.begin('after close')).toEqual({ ok: false, reason: 'turn_cap' });
    expect(await c.stub.status()).toMatchObject({ closed: true, turns: 0 });
  });

  it('an encounter with no completed turn closes without a transcript or a message', async () => {
    const c = await conversation();
    await c.begin('never answered');
    await c.stub.abort(0, 'client_gone');
    clock += 61_000;
    await runDurableObjectAlarm(c.stub);
    expect(await env.PRIVATE.head(`transcripts/${c.encounterId}.jsonl`)).toBeNull();
    expect(jobs).toHaveLength(0);
    expect(port.transcripts()).toHaveLength(0);
  });

  it('a profile forgotten meanwhile leaves no transcript object and no message', async () => {
    const c = await conversation();
    await turn(c, 1);
    await port.maintenance.purgeProfile(c.pid);
    clock += 61_000;
    await runDurableObjectAlarm(c.stub);
    expect(await env.PRIVATE.head(`transcripts/${c.encounterId}.jsonl`)).toBeNull();
    expect(jobs).toHaveLength(0);
  });

  it('the open-set index lists the conversation while it runs and drops it when it closes', async () => {
    const c = await conversation('npc_index');
    const index = env.ENCOUNTER.get(env.ENCOUNTER.idFromName('enc:index:npc_index')) as DurableObjectStub<EncounterDO>;
    await turn(c, 1);
    expect(await index.indexList()).toEqual([c.name]);
    clock += 61_000;
    await runDurableObjectAlarm(c.stub);
    expect(await index.indexList()).toEqual([]);
  });
});
