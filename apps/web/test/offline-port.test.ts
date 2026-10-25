import { describe, expect, it } from 'vitest';
import { createOfflinePort, type OfflineAssets } from '../src/offline-port.ts';

const plan = (fits = true) => ({ totalBytes: 100, files: 4, missingBytes: 100, missingFiles: 4, freeBytes: 1000, fits, shortfallBytes: fits ? 0 : 5 });

function rig(o: { persisted: boolean; persistResult?: boolean; fits?: boolean; hold?: boolean }) {
  const order: string[] = [];
  const emitted: Array<{ name: string; props: unknown }> = [];
  let signal: AbortSignal | undefined;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const assets: OfflineAssets = {
    storeKind: 'opfs',
    mode: 'rw',
    downloadPlan: () => {
      order.push('downloadPlan');
      return Promise.resolve(plan(o.fits ?? true));
    },
    downloadAll: async (onProgress, opts) => {
      order.push('downloadAll');
      signal = opts?.signal;
      onProgress(1, 4);
      if (o.hold) {
        await new Promise<void>((res, rej) => {
          opts?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { reason: 'aborted' })));
          void gate.then(res);
        });
      }
      onProgress(4, 4);
    },
    usage: () => Promise.resolve({ packsMB: 1, packs: 4 }),
    clear: () => Promise.resolve(),
  };
  const storage = {
    persisted: () => Promise.resolve(o.persisted),
    persist: () => {
      order.push('persist');
      return Promise.resolve(o.persistResult ?? true);
    },
  };
  const port = createOfflinePort({ assets, storage, emit: (name, props) => emitted.push({ name, props }) });
  return { port, order, emitted, release, signal: () => signal };
}

describe('createOfflinePort (M04b4)', () => {
  it('asks persist first, then plans, then downloads, and emits storage.persist once', async () => {
    const r = rig({ persisted: false, persistResult: true });
    const done = await r.port.start();
    expect(r.order).toEqual(['persist', 'downloadPlan', 'downloadAll']);
    expect(r.emitted).toEqual([{ name: 'storage.persist', props: { granted: true } }]);
    expect(done).toMatchObject({ state: 'done', done: 4, total: 4 });
  });

  it('a refused persist does not block the download', async () => {
    const r = rig({ persisted: false, persistResult: false });
    const done = await r.port.start();
    expect(r.order).toEqual(['persist', 'downloadPlan', 'downloadAll']);
    expect(r.emitted).toEqual([{ name: 'storage.persist', props: { granted: false } }]);
    expect(done.state).toBe('done');
  });

  it('with persisted() true, persist is not called', async () => {
    const r = rig({ persisted: true });
    await r.port.start();
    expect(r.order).toEqual(['downloadPlan', 'downloadAll']);
    expect(r.emitted).toEqual([]);
  });

  it('a plan that does not fit ends the job failed with reason quota and never downloads', async () => {
    const r = rig({ persisted: true, fits: false });
    const done = await r.port.start();
    expect(done).toMatchObject({ state: 'failed', reason: 'quota' });
    expect(r.order).not.toContain('downloadAll');
    expect(r.port.job()).toMatchObject({ state: 'failed', reason: 'quota' });
  });

  it('cancel aborts the signal given to downloadAll and the job ends cancelled; a second start returns the running job', async () => {
    const r = rig({ persisted: true, hold: true });
    const seen: string[] = [];
    r.port.onJob((j) => seen.push(j.state));
    const first = r.port.start();
    const second = r.port.start();
    expect(second).toBe(first);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(r.signal()?.aborted).toBe(false);
    expect(r.port.job()).toMatchObject({ state: 'running', done: 1, total: 4 });
    r.port.cancel();
    const done = await first;
    expect(r.signal()?.aborted).toBe(true);
    expect(done).toMatchObject({ state: 'cancelled', done: 1 });
    expect(seen.at(-1)).toBe('cancelled');
    r.release();
  });

  it('downloaded() reports bytes and files from usage', async () => {
    const r = rig({ persisted: true });
    expect(await r.port.downloaded()).toEqual({ bytes: 1024 * 1024, files: 4 });
  });
});
