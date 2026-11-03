/**
 * BD-FIX-LANDMARK-PREPARE-01: the `held` op and what the page knows of the worker. asset.worker takes requests up in the order they
 * arrive but finishes them in any order (a job can wait on the store while later requests are answered), so a plain round trip says
 * nothing about an earlier job; `held` reports, per request id, whether the worker still holds it and for how long on its own clock.
 * Run over the in-process loopback: the service posts each message on a microtask, in order, like a worker port.
 */
import { describe, expect, it } from 'vitest';
import { AssetClient, type WorkerPort } from '../../src/assets/client.ts';
import type { FromWorker, ToWorker } from '../../src/assets/rpc.ts';
import { AssetService, memoryPorts } from '../../src/assets/service.ts';

interface Loop {
  client: AssetClient;
  clock: { ms: number };
  /** Ends the store read of the `slow` job with this tag (it answers then). */
  finish(tag: string): void;
  /** Every message the page handled, in order (`res:<id>`). */
  seen: string[];
  /** While `on`, what the worker posts waits on the page (busy with long frames) until `drain()`. */
  inbox: { on: boolean; queue: FromWorker[] };
  drain(): void;
}

function loop(): Loop {
  const clock = { ms: 1000 };
  const reads = new Map<string, () => void>();
  const seen: string[] = [];
  let toClient: ((m: FromWorker) => void) | null = null;
  const svc = new AssetService({
    post: (m) => queueMicrotask(() => toClient?.(m)),
    makePorts: () => Promise.resolve(memoryPorts()),
    fetch: () => Promise.reject(new Error('no network in this test')),
    channel: null,
    tabId: 't',
    now: () => clock.ms,
    jobs: {
      // a job that waits on a store read until the test ends it
      slow: async (_svc, args) => {
        const tag = (args as { tag: string }).tag;
        await new Promise<void>((res) => reads.set(tag, res));
        return { result: tag };
      },
      fail: () => Promise.reject(new Error('mesh failed')),
    },
  });
  const port: WorkerPort = { postMessage: (m: ToWorker) => void svc.handle(m), onmessage: null };
  const inbox = { on: false, queue: [] as FromWorker[] };
  const handle = (m: FromWorker): void => {
    if (m.t === 'res') seen.push(`res:${m.id}`);
    port.onmessage?.({ data: m });
  };
  toClient = (m) => {
    if (inbox.on) inbox.queue.push(m);
    else handle(m);
  };
  const client = new AssetClient(port, { tier: () => 'desktop' });
  return {
    client, clock, seen, inbox,
    finish: (tag) => reads.get(tag)?.(),
    drain: () => {
      inbox.on = false;
      for (const m of inbox.queue.splice(0)) handle(m);
    },
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('held: the worker reports what it still holds (BD-FIX-LANDMARK-PREPARE-01)', () => {
  it('a plain round trip comes back while an earlier job still waits on the store: replies do not keep request order', async () => {
    const w = loop();
    const a = w.client.trackedJob('slow', { tag: 'a' });
    let aDone = false;
    void a.done.then(() => void (aDone = true));
    await w.client.stats();
    expect(aDone).toBe(false);
    w.finish('a');
    await expect(a.done).resolves.toBe('a');
  });

  it('per request: held with its age on the worker clock while it waits, null once its reply is posted, null for an unknown id', async () => {
    const w = loop();
    const a = w.client.trackedJob('slow', { tag: 'a' });
    const b = w.client.trackedJob('slow', { tag: 'b' });
    const c = w.client.trackedJob('fail', {});
    await settle();
    w.clock.ms += 1500;
    w.finish('b');
    await expect(b.done).resolves.toBe('b');
    await expect(c.done).rejects.toThrow('mesh failed');
    w.clock.ms += 500;
    expect(await w.client.held([a.id, b.id, c.id, 999])).toEqual([2000, null, null, null]);
    w.finish('a');
    await expect(a.done).resolves.toBe('a');
    expect(await w.client.held([a.id])).toEqual([null]);
  });

  it('the answer is handled after every reply the worker posted before it: on a busy page, a request it no longer holds has settled by then', async () => {
    const w = loop();
    const a = w.client.trackedJob('slow', { tag: 'a' });
    await settle();
    // the page is busy: the worker ends the read and posts the reply, which waits on the page; then the question goes out
    w.inbox.on = true;
    w.finish('a');
    await settle();
    const answer = w.client.held([a.id]);
    let aSettled = false;
    void a.done.then(() => void (aSettled = true));
    let settledAtAnswer: boolean | null = null;
    void answer.then(() => void (settledAtAnswer = aSettled));
    await settle();
    expect(w.inbox.queue.map((m) => (m.t === 'res' ? m.id : -1))).toEqual([a.id, a.id + 1]);
    expect(aSettled).toBe(false);
    w.drain();
    expect(await answer).toEqual([null]);
    expect(settledAtAnswer).toBe(true);
    expect(w.seen).toEqual([`res:${a.id}`, `res:${a.id + 1}`]);
  });

  it('heard counts every message handled from the worker', async () => {
    const w = loop();
    expect(w.client.heard).toBe(0);
    await w.client.stats();
    await w.client.held([]);
    expect(w.client.heard).toBe(2);
  });

  it('a worker that is gone: a question to a worker that never answers stays open, the worker failing rejects it, a disposed client refuses at once', async () => {
    const posted: ToWorker[] = [];
    const port: WorkerPort & { onerror: ((e: unknown) => void) | null } = { postMessage: (m: ToWorker) => void posted.push(m), onmessage: null, onerror: null };
    const client = new AssetClient(port, { tier: () => 'desktop' });
    const job = client.trackedJob('slow', { tag: 'a' });
    const q = client.held([job.id]);
    let state = 'open';
    q.then(() => (state = 'answered'), () => (state = 'rejected'));
    void job.done.catch(() => undefined);
    await settle();
    // the worker took both requests and says nothing: nothing settles, nothing is heard
    expect(posted.map((m) => (m.t === 'req' ? m.op : m.t))).toEqual(['job', 'held']);
    expect(state).toBe('open');
    expect(client.heard).toBe(0);
    port.onerror?.({ message: 'boom' });
    await settle();
    expect(state).toBe('rejected');
    await expect(job.done).rejects.toThrow('asset worker failed: boom');
    client.dispose();
    await expect(client.held([job.id])).rejects.toThrow('asset client is disposed');
    const late = client.trackedJob('slow', {});
    expect(late.id).toBe(0);
    await expect(late.done).rejects.toThrow('asset client is disposed');
  });
});
