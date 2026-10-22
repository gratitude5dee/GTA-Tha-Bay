import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryDataPort } from '@dv/shared/data-port.memory';
import { buildStream } from '../src/npc/upstream-fixture.ts';
import { write as writeMemory } from '../src/npc/memory.ts';
import { fakeAi, stubVector, withAi } from './ai-helpers.ts';
import { find, request, talkSetup, type Talk } from './talk-helpers.ts';

// M06a4 AC-1: memory writes are scrubbed, never quote the player, and a near-duplicate only refreshes last_accessed_at.
let t: Talk;
afterEach(() => t.dispose());

const PLAYER_TEXT = 'i will bring the red car back to the lot before midnight on friday I swear it';

interface Write {
  kind: string;
  text: string;
  importance: number;
}
const turnWith = (writes: Write[]): string =>
  buildStream({
    model: 'claude-haiku-5-5',
    answer: { line: 'Noted. I will remember that.', emotion: 'neutral', gesture: 'nod', action: 'none', action_arg: null, affinity_delta: 0, memory_writes: writes, end_conversation: false },
    inputTokens: 180,
    cacheReadTokens: 1500,
    outputTokens: 60,
  });

const memoryRows = async (): Promise<Record<string, unknown>[]> => (await t.h.port.maintenance.exportRows(t.pid))['npc_memory'] ?? [];

describe('memory writes after a turn', () => {
  it('stores 1 row: the e-mail removed, the quote of the player dropped, the third write cut by the limit of two', async () => {
    const ai = fakeAi();
    const out = turnWith([
      { kind: 'player_fact', text: 'Reach the player at kai@example.com about the lot.', importance: 3 },
      { kind: 'event', text: 'The player said: i will bring the red car back to the lot before midnight on friday', importance: 5 },
      { kind: 'preference', text: 'The player likes the red car.', importance: 4 },
    ]);
    t = await talkSetup({ fixture: () => out, env: withAi(ai) });
    const { frames } = await t.say(request({ turn: { text: PLAYER_TEXT, intent: 'smalltalk' } }));
    expect(find(frames, 'effects')!.data).toMatchObject({ memoryWrite: { count: 2 } });
    const rows = await memoryRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ npc_id: 'npc_test', kind: 'player_fact', text: 'Reach the player at [removed] about the lot.', importance: 3, source: 'dialogue', game_time: 7200 });
    for (const r of rows) expect(String(r['text'])).not.toContain('@');
    // one embedding call, for the one write that survived the rules
    expect(ai.calls.filter((c) => c.model === '@cf/baai/bge-m3' && Array.isArray(c.inputs['text']) && (c.inputs['text'] as string[]).length === 1)).not.toHaveLength(0);
  });

  it('a near-duplicate write (cosine >= 0.92) only refreshes last_accessed_at, and a promise is stored at importance 6 or more', async () => {
    const ai = fakeAi();
    const first = turnWith([{ kind: 'promise', text: 'The player promised to bring the car back by Friday.', importance: 2 }]);
    const second = turnWith([{ kind: 'promise', text: 'The player promised to return the car by Friday.', importance: 2 }]);
    let n = 0;
    t = await talkSetup({ fixture: () => (n++ === 0 ? first : second), env: withAi(ai) });
    const a = await t.say(request());
    const encounterId = (find(a.frames, 'meta')!.data as { encounterId: string }).encounterId;
    let rows = await memoryRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'promise', importance: 6, last_accessed_at: null });
    const id = rows[0]!['id'];

    t.h.clock.t += 5000;
    await t.say(request({ encounterId }));
    rows = await memoryRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!['id']).toBe(id);
    expect(rows[0]!['last_accessed_at']).toBe(t.h.clock.t);
  });

  it('stores nothing when embeddings fail or the profile is not an 18p play token', async () => {
    const ai = fakeAi();
    ai.fail.embed = true;
    const out = turnWith([{ kind: 'event', text: 'The player asked about the lot.', importance: 4 }]);
    t = await talkSetup({ fixture: () => out, env: withAi(ai) });
    const { frames } = await t.say(request());
    expect(find(frames, 'done')).toBeDefined(); // the turn is untouched
    expect(await memoryRows()).toHaveLength(0);

    // the guard: nothing is written or read for an age claim that is not 18p
    const port = new InMemoryDataPort({ now: () => 1 });
    await port.profiles.ensureLocal('p1', 'dkt1');
    ai.fail.embed = false;
    const res = await writeMemory(withAi(ai) as never, port, { profileId: 'p1', npcId: 'npc_test', age: '13-17', writes: [{ kind: 'event', text: 'The player asked about the lot.', importance: 4 }], playerText: undefined, clockT: 10 });
    expect(res).toEqual({ written: 0, refreshed: 0, dropped: 1 });
    expect((await port.maintenance.exportRows('p1'))['npc_memory']).toHaveLength(0);
  });

  it('the stub vectors of the near-duplicate pair are as close as the suite assumes', () => {
    const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * (b[i] as number), 0);
    const a = stubVector('The player promised to bring the car back by Friday.');
    const b = stubVector('The player promised to return the car by Friday.');
    const cos = dot(a, b) / Math.sqrt(dot(a, a) * dot(b, b));
    expect(cos).toBeGreaterThanOrEqual(0.92);
  });
});
