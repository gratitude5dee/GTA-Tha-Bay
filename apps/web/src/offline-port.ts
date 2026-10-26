import type { OfflineJob, OfflinePlan, OfflinePort } from '@dv/ui';

const MIB = 1024 * 1024;

/** The part of `AssetClient` the port uses, so a test can pass a fake. */
export interface OfflineAssets {
  readonly storeKind: 'opfs' | 'memory-fallback';
  readonly mode: 'rw' | 'read-only';
  downloadPlan(): Promise<Omit<OfflinePlan, 'store' | 'writable'>>;
  downloadAll(onProgress: (done: number, total: number) => void, o?: { signal?: AbortSignal }): Promise<void>;
  usage(): Promise<{ packsMB: number; packs: number }>;
  clear(): Promise<void>;
}

export interface OfflineDeps {
  assets: OfflineAssets;
  storage: { persisted?: () => Promise<boolean>; persist?: () => Promise<boolean> } | null | undefined;
  emit(name: 'storage.persist', props: { granted: boolean }): void;
}

/**
 * The city download behind Settings > Install and storage (M04b4). The job lives here, not on the page, so leaving Settings neither
 * stops nor loses it. Not a contract.
 */
export function createOfflinePort(d: OfflineDeps): OfflinePort {
  let job: OfflineJob | null = null;
  let running: Promise<OfflineJob> | null = null;
  let abort: AbortController | null = null;
  const subs = new Set<(j: OfflineJob) => void>();
  const publish = (next: OfflineJob): void => {
    job = next;
    for (const cb of [...subs]) cb({ ...next });
  };

  const plan = async (): Promise<OfflinePlan | null> => {
    try {
      const p = await d.assets.downloadPlan();
      return { ...p, store: d.assets.storeKind, writable: d.assets.mode === 'rw' };
    } catch {
      // The catalog is not ready (or the worker is gone): the page says the size is not known yet.
      return null;
    }
  };

  /** An explicit tap is an explicit request: unlike the once-per-profile marker of `requestPersist`, this asks every time. */
  const askPersist = async (): Promise<void> => {
    const s = d.storage;
    if (!s || typeof s.persist !== 'function') return;
    try {
      if (typeof s.persisted === 'function' && (await s.persisted()) === true) return;
    } catch {
      // Ask anyway.
    }
    let granted = false;
    try {
      granted = await s.persist();
    } catch {
      granted = false;
    }
    d.emit('storage.persist', { granted });
  };

  const run = async (ac: AbortController): Promise<OfflineJob> => {
    const end = (state: 'done' | 'cancelled' | 'failed', reason?: string): OfflineJob => {
      const last = job ?? { done: 0, total: 0, state: 'running' as const };
      const out: OfflineJob = { done: last.done, total: last.total, state, ...(reason ? { reason } : {}) };
      publish(out);
      return out;
    };
    await askPersist();
    if (ac.signal.aborted) return end('cancelled');
    const p = await plan();
    if (!p) return end('failed', 'catalog');
    if (!p.fits) return end('failed', 'quota');
    publish({ done: p.files - p.missingFiles, total: p.files, state: 'running' });
    try {
      await d.assets.downloadAll(
        (done, total) => {
          if (job?.state === 'running') publish({ done, total, state: 'running' });
        },
        { signal: ac.signal },
      );
      return end('done');
    } catch (e) {
      const reason = (e as { reason?: string } | null)?.reason;
      if (ac.signal.aborted || reason === 'aborted') return end('cancelled');
      return end('failed', reason ?? 'error');
    }
  };

  return {
    plan,
    async downloaded() {
      const u = await d.assets.usage();
      return { bytes: Math.round(u.packsMB * MIB), files: u.packs };
    },
    start() {
      if (running) return running;
      const ac = new AbortController();
      abort = ac;
      publish({ done: 0, total: 0, state: 'running' });
      running = run(ac)
        .catch((): OfflineJob => {
          const out: OfflineJob = { done: job?.done ?? 0, total: job?.total ?? 0, state: 'failed', reason: 'error' };
          publish(out);
          return out;
        })
        .finally(() => {
          running = null;
          abort = null;
        });
      return running;
    },
    cancel() {
      abort?.abort();
    },
    job: () => (job ? { ...job } : null),
    onJob(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    async clear() {
      await d.assets.clear();
    },
  };
}
