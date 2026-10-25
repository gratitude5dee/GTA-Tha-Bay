/**
 * M02f2 AC-4: the boot prefetch plan and gate (pure), plus the controller against a fake asset client: what it sends, in which lane,
 * when it skips, and the once-per-session promotion.
 */
import { describe, expect, it } from 'vitest';
import type { PackRef } from '@dv/engine/assets/types';
import { BootPrefetch, planBootPrefetch, prefetchGate, readSaveData, type PrefetchAssets, type PrefetchGateInput } from '../src/client/boot-prefetch.ts';
import type { BootSet } from '../src/sim/streaming/boot.ts';

const MB = 1024 * 1024;

const set = (): BootSet => ({
  p0: ['world_pack/p0-1', 'world_pack/p0-2', 'world_pack/p0-3'],
  l0: ['world_pack/l0-1', 'world_pack/l0-2', 'world_pack/l0-1'],
  l1: ['world_pack/l1-1', 'world_pack/l1-2'],
  l2: ['world_pack/l2-1'],
  far: ['world_pack/far-bay-dem', 'world_pack/far-bay-massing'],
  // the critical set repeats one p0 and one l0, and the first far pack
  critical: ['world_pack/p0-1', 'world_pack/l0-1', 'world_pack/far-bay-dem'],
});

describe('planBootPrefetch', () => {
  it('holds no critical ref and no duplicate; now keeps bootSet order; soon is l1, l2, far', () => {
    const plan = planBootPrefetch(set());
    expect(plan.now).toEqual(['world_pack/p0-2', 'world_pack/p0-3', 'world_pack/l0-2']);
    expect(plan.soon).toEqual(['world_pack/l1-1', 'world_pack/l1-2', 'world_pack/l2-1', 'world_pack/far-bay-massing']);
    const all = [...plan.now, ...plan.soon];
    expect(new Set(all).size).toBe(all.length);
    for (const c of set().critical) expect(all).not.toContain(c);
  });
  it('a ref that two rings share is planned once, in the first list that holds it', () => {
    const s = set();
    s.l1.push('world_pack/p0-2');
    const plan = planBootPrefetch(s);
    expect(plan.now).toContain('world_pack/p0-2');
    expect(plan.soon).not.toContain('world_pack/p0-2');
  });
  it('an empty set plans nothing', () => {
    expect(planBootPrefetch({ p0: [], l0: [], l1: [], l2: [], far: [], critical: [] })).toEqual({ now: [], soon: [] });
  });
});

describe('prefetchGate', () => {
  const base: PrefetchGateInput = { saveData: false, estimate: null, needBytes: 10 * MB, storeKind: 'opfs', mode: 'rw' };
  it('answers save-data, quota, memory and read-only; null without an estimate and with room', () => {
    expect(prefetchGate({ ...base, saveData: true })).toBe('save-data');
    // quota 100 MB, usage 90 MB, need 10 MB: 10 < 1.2 x 10
    expect(prefetchGate({ ...base, estimate: { usage: 90 * MB, quota: 100 * MB } })).toBe('quota');
    expect(prefetchGate({ ...base, storeKind: 'memory-fallback' })).toBe('memory');
    expect(prefetchGate({ ...base, mode: 'read-only' })).toBe('read-only');
    expect(prefetchGate(base)).toBeNull();
    expect(prefetchGate({ ...base, estimate: { usage: 10 * MB, quota: 100 * MB } })).toBeNull();
    // exactly 1.2 x the need is enough
    expect(prefetchGate({ ...base, estimate: { usage: 88 * MB, quota: 100 * MB } })).toBeNull();
  });
  it('a second tab outranks the memory fallback, which outranks the Save-Data hint', () => {
    expect(prefetchGate({ ...base, mode: 'read-only', storeKind: 'memory-fallback', saveData: true })).toBe('read-only');
    expect(prefetchGate({ ...base, storeKind: 'memory-fallback', saveData: true })).toBe('memory');
  });
});

describe('readSaveData', () => {
  it('only an explicit true counts, and a throwing getter is no hint', () => {
    expect(readSaveData({ connection: { saveData: true } })).toBe(true);
    expect(readSaveData({ connection: { saveData: false } })).toBe(false);
    expect(readSaveData({ connection: { saveData: 'yes' } })).toBe(false);
    expect(readSaveData({})).toBe(false);
    expect(readSaveData(undefined)).toBe(false);
    expect(readSaveData({ get connection(): never { throw new Error('no'); } })).toBe(false);
  });
});

interface Call {
  op: 'prefetch' | 'promote';
  targets: string[];
  priority: string;
}

function fakeAssets(o: { have?: Set<string>; storeKind?: 'opfs' | 'memory-fallback'; mode?: 'rw' | 'read-only'; moved?: number } = {}): { assets: PrefetchAssets; calls: Call[] } {
  const calls: Call[] = [];
  const bytes = 2 * MB;
  const assets = {
    storeKind: o.storeKind ?? 'opfs',
    mode: o.mode ?? 'rw',
    resolve: (ref: string): Promise<PackRef> => Promise.resolve({ url: `https://m.test/${ref}`, sha256: ref, bytes, kind: 'chunk' }),
    has: (t: string | PackRef): Promise<boolean> => Promise.resolve((o.have ?? new Set()).has(typeof t === 'string' ? t : t.sha256)),
    prefetch: (targets: unknown[], priority: string): Promise<void> => {
      calls.push({ op: 'prefetch', targets: targets as string[], priority });
      return Promise.resolve();
    },
    promote: (targets: unknown[], priority: string): Promise<number> => {
      calls.push({ op: 'promote', targets: targets as string[], priority });
      return Promise.resolve(o.moved ?? targets.length);
    },
  } as unknown as PrefetchAssets;
  return { assets, calls };
}

describe('BootPrefetch', () => {
  const mk = (a: PrefetchAssets, over: Partial<ConstructorParameters<typeof BootPrefetch>[0]> = {}): BootPrefetch => {
    let t = 1000;
    return new BootPrefetch({ assets: a, set: set(), menu: () => true, now: () => (t += 50), estimate: () => Promise.resolve(null), saveData: () => false, ...over });
  };

  it('waits until start(); in a menu it queues only the missing packs at idle and reports running', async () => {
    const { assets, calls } = fakeAssets({ have: new Set(['world_pack/p0-3']) });
    const p = mk(assets);
    expect(p.state).toBe('waiting');
    expect(p.report()).toMatchObject({ state: 'waiting', planned: 7, startedMs: null, promoted: 0, startToPlayMs: null });
    await p.start();
    expect(p.state).toBe('running');
    expect(calls).toEqual([
      { op: 'prefetch', priority: 'idle', targets: ['world_pack/p0-2', 'world_pack/l0-2', 'world_pack/l1-1', 'world_pack/l1-2', 'world_pack/l2-1', 'world_pack/far-bay-massing'] },
    ]);
    expect(p.report()).toMatchObject({ planned: 7, missingAtStart: 6, needBytes: 12 * MB });
    await p.start();
    expect(calls).toHaveLength(1);
  });

  it('skips on the Save-Data hint, on quota, in the memory fallback and in a read-only tab, and sends nothing', async () => {
    for (const [name, over, a] of [
      ['save-data', { saveData: () => true }, fakeAssets()],
      ['quota', { estimate: () => Promise.resolve({ usage: 0, quota: 1 }) }, fakeAssets()],
      ['memory', {}, fakeAssets({ storeKind: 'memory-fallback' })],
      ['read-only', {}, fakeAssets({ mode: 'read-only' })],
    ] as const) {
      const p = mk(a.assets, over);
      await p.start();
      expect(p.report().state, name).toBe('skipped');
      expect(p.report().skipped, name).toBe(name);
      expect(a.calls, name).toEqual([]);
      expect(await p.promote()).toBe(0);
      expect(a.calls, name).toEqual([]);
    }
  });

  it('past the menu the whole plan goes at soon and the state is direct', async () => {
    const { assets, calls } = fakeAssets();
    const p = mk(assets, { menu: () => false });
    await p.start();
    expect(p.report()).toMatchObject({ state: 'direct', skipped: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ op: 'prefetch', priority: 'soon' });
    expect(calls[0]?.targets).toHaveLength(7);
  });

  it('?prefetch=0 requests nothing, even past the menu', async () => {
    const a = fakeAssets();
    const off = mk(a.assets, { enabled: false });
    await off.start();
    expect(off.report().state).toBe('off');
    const b = fakeAssets();
    const offDirect = mk(b.assets, { enabled: false, menu: () => false });
    await offDirect.start();
    expect(offDirect.report().state).toBe('off');
    expect(a.calls).toEqual([]);
    expect(b.calls).toEqual([]);
  });

  it('promote() moves the queued rings to now and the rest to soon, once, and sums what moved; markPlay() times mode start to play', async () => {
    const { assets, calls } = fakeAssets({ moved: 2 });
    const p = mk(assets);
    await p.start();
    calls.length = 0;
    expect(await p.promote()).toBe(4);
    expect(calls.map((c) => [c.op, c.priority, c.targets.length])).toEqual([
      ['promote', 'now', 3],
      ['promote', 'soon', 4],
    ]);
    expect(await p.promote()).toBe(0);
    expect(calls).toHaveLength(2);
    expect(p.report().promoted).toBe(4);
    expect(p.report().promotedMs).not.toBeNull();
    p.markPlay();
    const first = p.report().startToPlayMs;
    expect(first).toBeGreaterThan(0);
    p.markPlay();
    expect(p.report().startToPlayMs).toBe(first);
  });

  it('markPlay() without a mode start records nothing (the QA bypass)', async () => {
    const p = mk(fakeAssets().assets);
    await p.start();
    p.markPlay();
    expect(p.report().startToPlayMs).toBeNull();
  });

  it('a mode started before the figures were read promotes as soon as the download is queued', async () => {
    const { assets, calls } = fakeAssets();
    const p = mk(assets);
    const starting = p.start();
    await p.promote();
    await starting;
    expect(calls.map((c) => `${c.op}:${c.priority}`)).toEqual(['prefetch:idle', 'promote:now', 'promote:soon']);
  });

  it('a failing asset worker never throws out of start() or promote()', async () => {
    const { assets } = fakeAssets();
    (assets as unknown as { prefetch: () => Promise<void> }).prefetch = () => Promise.reject(new Error('gone'));
    const p = mk(assets);
    await expect(p.start()).resolves.toBeUndefined();
    await expect(p.promote()).resolves.toBeTypeOf('number');
  });
});
