import { describe, expect, it } from 'vitest';
import { TabLock, type ChannelLike } from '../../src/assets/store/tab-lock.ts';
import { PERSIST_MARKER_KEY, requestPersist } from '../../src/assets/store/persist.ts';

/** A broadcast bus: every channel on it hears every other channel's messages, asynchronously. */
class Bus {
  readonly channels: Chan[] = [];
  channel(): Chan {
    const c = new Chan(this);
    this.channels.push(c);
    return c;
  }
}
class Chan implements ChannelLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(private readonly bus: Bus) {}
  postMessage(m: unknown): void {
    for (const c of this.bus.channels) if (c !== this) queueMicrotask(() => c.onmessage?.({ data: m }));
  }
  close(): void {
    this.onmessage = null;
  }
}

const instant = (fn: () => void): unknown => {
  // Run the probe-window callback after pending microtasks have delivered the hello and owner messages.
  setTimeout(fn, 0);
  return 0;
};

describe('TabLock', () => {
  it('the first tab is the writer; a second tab opened later is read-only and is told so', async () => {
    const bus = new Bus();
    const a = new TabLock({ channel: bus.channel(), id: 'a', startedAt: 1, setTimeout: instant });
    expect(await a.start()).toBe('rw');
    const b = new TabLock({ channel: bus.channel(), id: 'b', startedAt: 2, setTimeout: instant });
    const seen: string[] = [];
    b.onChange((m) => seen.push(m));
    expect(await b.start()).toBe('read-only');
    expect(seen).toEqual(['read-only']);
    expect(a.mode).toBe('rw');
  });

  it('two tabs that start together agree: the older one writes', async () => {
    const bus = new Bus();
    const a = new TabLock({ channel: bus.channel(), id: 'a', startedAt: 5, setTimeout: instant });
    const b = new TabLock({ channel: bus.channel(), id: 'b', startedAt: 7, setTimeout: instant });
    const [ma, mb] = await Promise.all([a.start(), b.start()]);
    expect([ma, mb]).toEqual(['rw', 'read-only']);
  });

  it('without BroadcastChannel the tab writes', async () => {
    expect(await new TabLock({ channel: null, id: 'x', startedAt: 1 }).start()).toBe('rw');
  });
});

describe('requestPersist', () => {
  const mem = (): { store: Map<string, string>; api: { getItem(k: string): string | null; setItem(k: string, v: string): void } } => {
    const store = new Map<string, string>();
    return { store, api: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) } };
  };

  it('asks once per profile and emits storage.persist{granted}', async () => {
    const { store, api } = mem();
    const events: Array<{ granted: boolean }> = [];
    let asked = 0;
    const deps = {
      storage: { persist: () => Promise.resolve(++asked > 0) },
      marker: api,
      emit: (_n: 'storage.persist', p: { granted: boolean }) => void events.push(p),
    };
    expect(await requestPersist('standalone', deps)).toBe(true);
    expect(await requestPersist('standalone', deps)).toBeNull();
    expect(asked).toBe(1);
    expect(events).toEqual([{ granted: true }]);
    expect(store.get(PERSIST_MARKER_KEY)).toBe('1');
  });

  it('records a refusal, and does nothing where persist does not exist', async () => {
    const { api } = mem();
    const events: Array<{ granted: boolean }> = [];
    const emit = (_n: 'storage.persist', p: { granted: boolean }): void => void events.push(p);
    expect(await requestPersist('story', { storage: { persist: () => Promise.resolve(false) }, marker: api, emit })).toBe(false);
    expect(events).toEqual([{ granted: false }]);
    expect(await requestPersist('story', { storage: {}, marker: null, emit })).toBeNull();
    expect(await requestPersist('story', { storage: null, marker: null, emit })).toBeNull();
  });
});
