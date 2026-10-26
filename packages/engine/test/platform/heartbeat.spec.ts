import { C13_VERSION, classifyDevice, type TelemetryBatch } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { createPlatform } from '../../src/platform/create-platform.ts';
import { createMemoryStore } from '../../src/platform/platform-store.ts';
import { NO_QA_FLAGS } from '../../src/platform/qa-flags.ts';
import { HB_EXITS_KEY, HB_KEY, Heartbeat, RafWatchdog, STALL_MS, type HeartbeatRecord } from '../../src/platform/telemetry/heartbeat.ts';
import { TIERS } from '../../src/platform/tier-config.ts';
import { FakeClock, type FakeRenderer, FakeStorage, FakeTimers, envFrom, fakeBenchmark, fakeFactory, uaFixture } from './fakes.ts';

const HOUR = 3_600_000;
const MB = 1024 * 1024;
const iphoneSignals = uaFixture('iphone-safari');
const iphone = classifyDevice(iphoneSignals);

function record(over: Partial<HeartbeatRecord>): HeartbeatRecord {
  return {
    v: 1,
    sid: 'prev-session',
    t: 1_800_000_000_000 - 30_000,
    state: 'running',
    scene: 'world',
    mode: 'story',
    chunkKey: 'c:12:7',
    tier: 'mobile',
    backend: 'webgl2',
    memEstMB: 100,
    gpuEstMB: 60,
    build: 'b1',
    ring: [],
    ...over,
  };
}

function bare(storage: FakeStorage, clock: FakeClock) {
  const events: { name: string; props?: Record<string, unknown> }[] = [];
  const hb = new Heartbeat({
    storage,
    sid: 'cur',
    build: 'b1',
    now: clock.now,
    timers: new FakeTimers(),
    emitter: { emit: (name, props) => void events.push({ name, ...(props ? { props } : {}) }) },
    capsOf: (id) => ({ maxAccountedHeapMB: TIERS[id].budget.memory.maxAccountedHeapMB, maxGpuResourceMB: TIERS[id].budget.memory.maxGpuResourceMB }),
  });
  return { hb, events };
}

describe('Heartbeat boot analysis', () => {
  it('a first boot has no previous record', () => {
    const { hb, events } = bare(new FakeStorage(), new FakeClock());
    expect(hb.analyzePrevious().kind).toBe('first');
    expect(events).toEqual([]);
  });

  it('a running record becomes app.abnormal_exit with the persisted context', () => {
    const storage = new FakeStorage();
    storage.setItem(HB_KEY, JSON.stringify(record({ memEstMB: 321.7, gpuEstMB: 88.2 })));
    const { hb, events } = bare(storage, new FakeClock());
    const a = hb.analyzePrevious();
    expect(a.kind).toBe('abnormal_exit');
    expect(events).toEqual([
      {
        name: 'app.abnormal_exit',
        props: { prevSid: 'prev-session', lastBeatAgoMs: 30_000, scene: 'world', mode: 'story', chunkKey: 'c:12:7', memEstMB: 322, gpuEstMB: 88 },
      },
    ]);
  });

  it('a hidden record becomes app.cold_resume, a closed one nothing', () => {
    const storage = new FakeStorage();
    storage.setItem(HB_KEY, JSON.stringify(record({ state: 'hidden' })));
    const a = bare(storage, new FakeClock());
    expect(a.hb.analyzePrevious().kind).toBe('cold_resume');
    expect(a.events.map((e) => e.name)).toEqual(['app.cold_resume']);
    storage.setItem(HB_KEY, JSON.stringify(record({ state: 'closed' })));
    const b = bare(storage, new FakeClock());
    expect(b.hb.analyzePrevious().kind).toBe('clean');
    expect(b.events).toEqual([]);
  });

  it('corrupt or foreign records read as no record', () => {
    for (const raw of ['not json', '{"v":2}', '{"v":1,"sid":"x","t":1,"state":"weird"}', '[]']) {
      const storage = new FakeStorage();
      storage.setItem(HB_KEY, raw);
      expect(bare(storage, new FakeClock()).hb.analyzePrevious().kind).toBe('first');
    }
  });

  it('two exits above 0.8 x (heap + GPU caps) within 24 h on one tier ask for a demotion', () => {
    const storage = new FakeStorage();
    const clock = new FakeClock();
    // mobile: 0.8 x (600 + 600) = 960 MB.
    const heavy = record({ memEstMB: 1000 });
    storage.setItem(HB_KEY, JSON.stringify(heavy));
    const one = bare(storage, clock);
    expect(one.hb.analyzePrevious().demoteFrom).toBeNull();
    clock.advance(2 * HOUR);
    storage.setItem(HB_KEY, JSON.stringify(heavy));
    const two = bare(storage, clock);
    expect(two.hb.analyzePrevious().demoteFrom).toBe('mobile');
  });

  it('exits below the memory threshold, on different tiers, or more than 24 h apart never demote', () => {
    const run = (rec: Partial<HeartbeatRecord>[], gaps: number[]): ReturnType<Heartbeat['analyzePrevious']> => {
      const storage = new FakeStorage();
      const clock = new FakeClock();
      let last: ReturnType<Heartbeat['analyzePrevious']> | null = null;
      rec.forEach((r, i) => {
        storage.setItem(HB_KEY, JSON.stringify(record(r)));
        last = bare(storage, clock).hb.analyzePrevious();
        clock.advance(gaps[i] ?? HOUR);
      });
      return last as unknown as ReturnType<Heartbeat['analyzePrevious']>;
    };
    expect(run([{ memEstMB: 500 }, { memEstMB: 500 }], [HOUR]).demoteFrom).toBeNull();
    expect(run([{ memEstMB: 1000 }, { memEstMB: 1000, tier: 'mobile-low' }], [HOUR]).demoteFrom).toBeNull();
    expect(run([{ memEstMB: 1000 }, { memEstMB: 1000 }], [25 * HOUR]).demoteFrom).toBeNull();
  });

  it('writes a running record, beats every 5 s, and marks hidden and closed', () => {
    const storage = new FakeStorage();
    const clock = new FakeClock();
    const timers = new FakeTimers();
    const hb = new Heartbeat({
      storage,
      sid: 'cur',
      build: 'b1',
      now: clock.now,
      timers,
      capsOf: () => ({ maxAccountedHeapMB: 1, maxGpuResourceMB: 1 }),
      memory: () => ({ memEstMB: 77, gpuEstMB: 33 }),
    });
    hb.start({ tier: 'mobile', backend: 'webgl2' });
    const read = (): HeartbeatRecord => JSON.parse(storage.getItem(HB_KEY) ?? '{}') as HeartbeatRecord;
    expect(read().state).toBe('running');
    expect(timers.intervals.size).toBe(1);
    clock.advance(5000);
    timers.tick(5000);
    expect(read().memEstMB).toBe(77);
    expect(read().t).toBe(clock.t);
    hb.patch({ scene: 'title', chunkKey: 'c:1:1' });
    expect(read().scene).toBe('title');
    hb.markHidden();
    expect(read().state).toBe('hidden');
    // No beat while hidden.
    clock.advance(5000);
    timers.tick(5000);
    expect(read().state).toBe('hidden');
    expect(read().t).not.toBe(clock.t);
    hb.markVisible();
    expect(read().state).toBe('running');
    hb.markClosed();
    expect(read().state).toBe('closed');
  });

  it('keeps the ring at 20 events and the record under 4 KB', () => {
    const storage = new FakeStorage();
    const hb = bare(storage, new FakeClock()).hb;
    hb.start({ tier: 'mobile', backend: 'webgl2' });
    for (let i = 0; i < 60; i++) hb.note(`event-${i}-${'x'.repeat(60)}`);
    hb.markHidden();
    const rec = JSON.parse(storage.getItem(HB_KEY) ?? '{}') as HeartbeatRecord;
    expect(rec.ring.length).toBeLessThanOrEqual(20);
    expect((storage.getItem(HB_KEY) ?? '').length).toBeLessThanOrEqual(4096);
  });

  it('survives storage that throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    };
    const hb = new Heartbeat({ storage: throwing, sid: 's', build: 'b', now: () => 1, timers: new FakeTimers(), capsOf: () => ({ maxAccountedHeapMB: 1, maxGpuResourceMB: 1 }) });
    expect(hb.analyzePrevious().kind).toBe('first');
    expect(() => hb.start({ tier: 'mobile', backend: 'webgl2' })).not.toThrow();
  });
});

describe('RafWatchdog', () => {
  it('writes raf.stall once after 5 s without a frame while visible', () => {
    const clock = new FakeClock(0);
    const timers = new FakeTimers();
    let stalls = 0;
    const w = new RafWatchdog(clock.now, timers, () => (stalls += 1));
    w.start();
    clock.advance(STALL_MS - 1);
    timers.tick(1000);
    expect(stalls).toBe(0);
    clock.advance(2);
    timers.tick(1000);
    expect(stalls).toBe(1);
    timers.tick(1000);
    expect(stalls).toBe(1);
    w.frame();
    clock.advance(STALL_MS + 1);
    timers.tick(1000);
    expect(stalls).toBe(2);
    w.visible = false;
    w.frame();
    clock.advance(STALL_MS * 3);
    timers.tick(1000);
    expect(stalls).toBe(2);
  });
});

/** A full platform boot over fakes, sharing storage and the tier store between boots. */
async function boot(o: {
  storage: FakeStorage;
  store: ReturnType<typeof createMemoryStore>;
  clock: FakeClock;
  consent?: { diagnostics: boolean; analytics: boolean };
  build?: string;
}) {
  const sent: TelemetryBatch[] = [];
  const factory = fakeFactory();
  const platform = await createPlatform({
    canvas: { clientWidth: 400, clientHeight: 800, width: 400, height: 800 } as unknown as HTMLCanvasElement,
    flags: NO_QA_FLAGS,
    build: o.build ?? 'b1',
    env: envFrom(iphoneSignals),
    store: o.store,
    storage: o.storage,
    createRenderer: factory.create,
    now: o.clock.now,
    perfNow: () => 1234,
    timers: new FakeTimers(),
    send: (body) => void sent.push(JSON.parse(body) as TelemetryBatch),
    sessionId: `sid-${Math.round(o.clock.t / 1000)}-${sent.length}`,
    nav: 'navigate',
    benchmark: (_h, t) => fakeBenchmark({})(t),
    attachListeners: false,
    ...(o.consent ? { consent: o.consent } : {}),
  });
  const names = (): string[] => sent.flatMap((b) => b.events.map((e) => e.name));
  return { platform, sent, names, renderer: factory.state.renderers[0] as FakeRenderer };
}

describe('abnormal-exit boots end to end (AC-9)', () => {
  it('emits app.abnormal_exit, then app.cold_resume, then demotes mobile to mobile-low', async () => {
    const storage = new FakeStorage();
    const store = createMemoryStore();
    const clock = new FakeClock();

    // A stored decision for this device and build: tier mobile.
    await store.putTierDecision({
      v: 1,
      tier: 'mobile',
      source: 'auto-benchmark',
      decidedAt: clock.t,
      build: 'b1',
      uaHash: iphone.uaHash,
      adapterHash: iphone.adapterHash,
      c13: C13_VERSION,
    });

    // Boot 1 follows a running record (a light one).
    storage.setItem(HB_KEY, JSON.stringify(record({ memEstMB: 100 })));
    const b1 = await boot({ storage, store, clock });
    b1.platform.telemetry.flush('interval');
    expect(b1.names()).toContain('app.abnormal_exit');
    expect(b1.platform.quality.tier.id).toBe('mobile');
    expect(b1.platform.decision.source).toBe('auto-benchmark');

    // The page is hidden, then killed by the system: boot 2 sees a hidden record.
    b1.platform.heartbeat.markHidden();
    clock.advance(HOUR);
    const b2 = await boot({ storage, store, clock });
    b2.platform.telemetry.flush('interval');
    expect(b2.names()).toContain('app.cold_resume');
    expect(b2.names()).not.toContain('app.abnormal_exit');
    expect(b2.platform.quality.tier.id).toBe('mobile');

    // Boot 2 dies running with 1100 MB accounted (threshold 960): boot 3 sees the first qualifying exit.
    b2.renderer.info.memory.total = 1100 * MB;
    b2.platform.heartbeat.beat();
    clock.advance(HOUR);
    const b3 = await boot({ storage, store, clock });
    b3.platform.telemetry.flush('interval');
    expect(b3.names()).toContain('app.abnormal_exit');
    expect(b3.platform.quality.tier.id).toBe('mobile');

    // Boot 3 dies the same way within 24 h: boot 4 demotes.
    b3.renderer.info.memory.total = 1100 * MB;
    b3.platform.heartbeat.beat();
    clock.advance(HOUR);
    const b4 = await boot({ storage, store, clock });
    b4.platform.telemetry.flush('interval');
    expect(b4.names()).toContain('app.abnormal_exit');
    expect(b4.platform.quality.tier.id).toBe('mobile-low');
    expect(b4.platform.decision.source).toBe('abnormal-exit-demotion');
    const stored = await store.getTierDecision();
    expect(stored?.tier).toBe('mobile-low');
    expect(stored?.source).toBe('abnormal-exit-demotion');
    // The boot batch carries tier.decision with that source.
    const decision = b4.sent.flatMap((b) => b.events).find((e) => e.name === 'tier.decision');
    expect(decision?.props).toMatchObject({ tier: 'mobile-low', source: 'abnormal-exit-demotion' });
    expect(b4.sent[0]?.env.tier).toBe('mobile-low');

    // A fifth boot reuses the demoted decision.
    b4.renderer.info.memory.total = 10 * MB;
    b4.platform.heartbeat.markClosed();
    const b5 = await boot({ storage, store, clock });
    expect(b5.platform.quality.tier.id).toBe('mobile-low');
  });

  it('with Diagnostics off the record is written but nothing is sent', async () => {
    const storage = new FakeStorage();
    const store = createMemoryStore();
    const clock = new FakeClock();
    storage.setItem(HB_KEY, JSON.stringify(record({ memEstMB: 1000, sid: 'died-before' })));
    const b = await boot({ storage, store, clock, consent: { diagnostics: false, analytics: true } });
    b.platform.telemetry.flush('interval');
    expect(b.sent).toEqual([]);
    expect(b.platform.telemetry.pending).toBe(0);
    // The local record is rewritten for this session and the exit is logged for the demotion rule.
    const rec = JSON.parse(storage.getItem(HB_KEY) ?? '{}') as HeartbeatRecord;
    expect(rec.sid).toBe(b.platform.sessionId);
    expect(rec.state).toBe('running');
    expect(JSON.parse(storage.getItem(HB_EXITS_KEY) ?? '[]')).toHaveLength(1);
  });
});
