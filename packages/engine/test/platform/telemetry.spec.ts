import { CLIENT_TELEMETRY_NAMES, TELEMETRY_LIMITS, type TelemetryBatch, type TelemetryEnvelope, type TelemetryName } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { LifecycleController } from '../../src/platform/lifecycle.ts';
import { fetchBootRegion } from '../../src/platform/create-platform.ts';
import { MAX_HELD_EVENTS, TelemetryClient, isDiagnostic, osMajorOf, scrub } from '../../src/platform/telemetry/client.ts';
import { ErrorReporter, MAX_PER_FINGERPRINT, fingerprint, topFrameOf } from '../../src/platform/telemetry/errors.ts';
import { FakeClock, FakeTimers } from './fakes.ts';

const ENV: TelemetryEnvelope = { tier: 'mobile', deviceClass: 'iphone', osMajor: 26, displayMode: 'standalone', backend: 'webgl2' };

function client(over: Partial<ConstructorParameters<typeof TelemetryClient>[0]> = {}) {
  const sent: { batch: TelemetryBatch; beacon: boolean; bytes: number }[] = [];
  const clock = new FakeClock();
  const timers = new FakeTimers();
  const c = new TelemetryClient({
    build: 'b1',
    sessionId: 'sess-1',
    env: () => ENV,
    now: clock.now,
    timers,
    send: (body, beacon) => void sent.push({ batch: JSON.parse(body) as TelemetryBatch, beacon, bytes: new TextEncoder().encode(body).length }),
    ...over,
  });
  return { c, sent, clock, timers };
}

describe('TelemetryClient batching', () => {
  it('sends the C16 envelope with build, seq0 and events in order', () => {
    const { c, sent } = client();
    c.emit('app.start', { nav: 'navigate', coi: true, store: 'memory', backend: 'webgl2', tier: 'mobile' });
    c.emit('tier.decision', { tier: 'mobile', source: 'auto-benchmark', benchP90Ms: 14.2 });
    c.emit('app.ready', { bootMs: 900, phaseShellMs: 120, phaseWorldMs: 0, nav: 'navigate' });
    c.flush('interval');
    expect(sent).toHaveLength(1);
    const b = sent[0]!.batch;
    expect(b.v).toBe(1);
    expect(b.build).toBe('b1');
    expect(b.seq0).toBe(0);
    expect(b.env).toEqual(ENV);
    expect(b.events.map((e) => e.name)).toEqual(['app.start', 'tier.decision', 'app.ready']);
    expect(b.events.every((e) => e.sessionId === 'sess-1')).toBe(true);
    c.emit('app.hidden');
    c.flush('interval');
    expect(sent[1]!.batch.seq0).toBe(3);
  });

  it('splits at 50 events per batch', () => {
    const { c, sent } = client();
    for (let i = 0; i < 120; i++) c.emit('perf.minute', { fpsP50: 60, fpsP5: 50, frameP95Ms: 20, drawCalls: i, tris: 1, texMBEst: 1, gpuMBEst: 1, memEstMB: 1 });
    c.flush('interval');
    expect(sent.map((s) => s.batch.events.length)).toEqual([50, 50, 20]);
    expect(sent.map((s) => s.batch.seq0)).toEqual([0, 50, 100]);
  });

  it('keeps every body under 64 KiB', () => {
    const { c, sent } = client();
    for (let i = 0; i < 49; i++) c.emit('err.js', { fp: 'f'.repeat(8), msg: 'm'.repeat(128), top: 't'.repeat(128) });
    c.flush('interval');
    for (const s of sent) expect(s.bytes).toBeLessThanOrEqual(TELEMETRY_LIMITS.maxBodyBytes);
    // 49 events of 16 props with 128-character strings are about 130 KB: the client splits by size, not only by count.
    const heavy = client();
    const props: Record<string, string> = {};
    for (let k = 0; k < 16; k++) props[`k${k}`] = 'word '.repeat(24);
    for (let i = 0; i < 49; i++) heavy.c.emit('mod.fault', props);
    heavy.c.flush('interval');
    expect(heavy.sent.length).toBeGreaterThan(1);
    for (const s of heavy.sent) expect(s.bytes).toBeLessThanOrEqual(TELEMETRY_LIMITS.maxBodyBytes);
    expect(heavy.sent.reduce((n, s) => n + s.batch.events.length, 0)).toBe(49);
  });

  it('flushes on hidden and pagehide through sendBeacon, and on the interval through fetch', () => {
    const { c, sent } = client();
    c.emit('app.hidden');
    c.flush('hidden');
    c.emit('app.hidden');
    c.flush('pagehide');
    c.emit('app.hidden');
    c.flush('interval');
    expect(sent.map((s) => s.beacon)).toEqual([true, true, false]);
  });

  it('drops names that are not client names and caps props at 16 keys and strings at 128 chars', () => {
    const { c, sent } = client();
    c.emit('genai.cost' as TelemetryName, { usdMicros: 1 });
    c.emit('nonsense' as TelemetryName);
    const many: Record<string, number> = {};
    for (let i = 0; i < 30; i++) many[`k${i}`] = i;
    c.emit('mod.fault', many);
    c.emit('err.gpu', { kind: 'init', msg: 'z'.repeat(400) });
    c.flush('interval');
    const events = sent[0]!.batch.events;
    expect(events.map((e) => e.name)).toEqual(['mod.fault', 'err.gpu']);
    expect(Object.keys(events[0]!.props)).toHaveLength(16);
    expect((events[1]!.props['msg'] as string).length).toBeLessThanOrEqual(128);
  });

  it('every name the platform emits is in the C16 client registry', () => {
    const used: TelemetryName[] = ['app.start', 'app.ready', 'app.hidden', 'app.abnormal_exit', 'app.cold_resume', 'tier.decision', 'perf.minute', 'err.js', 'err.promise', 'err.gpu'];
    for (const n of used) expect((CLIENT_TELEMETRY_NAMES as readonly string[]).includes(n)).toBe(true);
  });

  it('never puts the user agent, a profile id or the page URL in the body', () => {
    const { c, sent } = client();
    c.emit('app.start', { nav: 'navigate', coi: true, store: 'memory', backend: 'webgl2', tier: 'mobile' });
    c.emit('err.js', { fp: 'abc', msg: 'boom at https://example.test/app?token=abcdefabcdefabcdefabcdefabcdef12 for me@example.test', top: '/assets/a.js:1:2' });
    c.flush('interval');
    const text = JSON.stringify(sent[0]!.batch);
    expect(text).not.toMatch(/Mozilla|AppleWebKit|iPhone OS|userAgent/i);
    expect(text).not.toContain('token=');
    expect(text).not.toContain('me@example.test');
    expect(text).not.toContain('profileId');
  });
});

describe('consent', () => {
  it('drops diagnostics events when Diagnostics is off and analytics events when Analytics is off', () => {
    const { c, sent } = client({ consent: { diagnostics: false, analytics: true } });
    c.emit('app.start', { nav: 'navigate', coi: true, store: 'memory', backend: 'webgl2', tier: 'mobile' });
    c.emit('mission.start', { id: 'm1' });
    c.flush('interval');
    expect(sent[0]!.batch.events.map((e) => e.name)).toEqual(['mission.start']);

    const b = client({ consent: { diagnostics: true, analytics: false } });
    b.c.emit('app.start', { nav: 'navigate', coi: true, store: 'memory', backend: 'webgl2', tier: 'mobile' });
    b.c.emit('mission.start', { id: 'm1' });
    b.c.flush('interval');
    expect(b.sent[0]!.batch.events.map((e) => e.name)).toEqual(['app.start']);
  });

  it('withdrawing consent also drops what is queued', () => {
    const { c, sent } = client();
    c.emit('app.hidden');
    c.emit('mission.start', { id: 'm1' });
    c.setConsent({ diagnostics: false, analytics: true });
    c.flush('interval');
    expect(sent[0]!.batch.events.map((e) => e.name)).toEqual(['mission.start']);
    c.setConsent({ diagnostics: false, analytics: false });
    c.emit('mission.start', { id: 'm2' });
    c.flush('interval');
    expect(sent).toHaveLength(1);
  });

  it('classifies health and performance names as diagnostics', () => {
    for (const n of ['app.start', 'err.js', 'perf.minute', 'tier.decision', 'xr.session', 'net.ws']) expect(isDiagnostic(n)).toBe(true);
    for (const n of ['mission.start', 'mode.enter', 'racing.start', 'ui.page']) expect(isDiagnostic(n)).toBe(false);
  });
});

describe('interval and soon flush', () => {
  it('start() flushes every 10 s; flushSoon() waits 200 ms and batches back-to-back events', () => {
    const { c, sent, timers } = client();
    c.start();
    c.emit('app.hidden');
    timers.tick(10_000);
    expect(sent).toHaveLength(1);
    c.emit('app.hidden');
    c.emit('app.hidden');
    c.flushSoon();
    c.flushSoon();
    expect([...timers.timeouts.values()].map((t) => t.ms)).toEqual([200]);
    timers.runTimeouts();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.batch.events).toHaveLength(2);
    c.stop();
    expect(timers.intervals.size).toBe(0);
  });
});

// BD-FIX-CI-01 (A-10, R-ROLL-01): POST /api/v1/t is geo-gated; a region that boot reports 'blocked' never calls it.
describe('region gate', () => {
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it('a blocked region sends nothing: not the held boot batch, not the interval, not a beacon, not later events', async () => {
    let answer!: (r: 'ok' | 'blocked') => void;
    const { c, sent, timers } = client({ region: new Promise((r) => (answer = r)) });
    c.emit('app.start', { nav: 'navigate', coi: true, store: 'memory', backend: 'webgl2', tier: 'mobile' });
    c.start();
    c.flushSoon();
    timers.runTimeouts();
    timers.tick(10_000);
    expect(sent).toHaveLength(0);
    expect(c.region).toBe('pending');
    answer('blocked');
    await settle();
    expect(c.region).toBe('blocked');
    expect(c.pending).toBe(0);
    c.emit('app.hidden');
    c.flush('pagehide');
    c.flushSoon();
    timers.runTimeouts();
    timers.tick(10_000);
    expect(sent).toHaveLength(0);
    expect(c.pending).toBe(0);
    expect(timers.intervals.size).toBe(0);
  });

  it('an ok region sends what it held, in order, then behaves as before', async () => {
    const { c, sent } = client({ region: Promise.resolve('ok') });
    c.emit('app.start', { nav: 'navigate', coi: true, store: 'memory', backend: 'webgl2', tier: 'mobile' });
    c.emit('app.ready', { bootMs: 900, phaseShellMs: 120, phaseWorldMs: 0, nav: 'navigate' });
    c.flush('interval');
    expect(sent).toHaveLength(0);
    await settle();
    expect(c.region).toBe('ok');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.batch.events.map((e) => e.name)).toEqual(['app.start', 'app.ready']);
    c.emit('app.hidden');
    c.flush('hidden');
    expect(sent).toHaveLength(2);
  });

  it('a failed region answer counts as ok, and the held queue is bounded', async () => {
    const { c, sent } = client({ region: Promise.reject(new Error('offline')) });
    for (let i = 0; i < MAX_HELD_EVENTS + 30; i++) c.emit('app.hidden');
    expect(c.pending).toBe(MAX_HELD_EVENTS);
    await settle();
    expect(c.region).toBe('ok');
    expect(sent.reduce((n, s) => n + s.batch.events.length, 0)).toBe(MAX_HELD_EVENTS);
  });

  it('fetchBootRegion reads BootConfig.region and treats anything else as ok', async () => {
    const reply = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    const urls: string[] = [];
    const spy: typeof fetch = (async (u: string) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ region: 'blocked' }));
    }) as typeof fetch;
    expect(await fetchBootRegion(spy, 'http://localhost:1')).toBe('blocked');
    expect(urls).toEqual(['http://localhost:1/api/v1/boot']);
    expect(await fetchBootRegion(reply(200, { region: 'ok' }))).toBe('ok');
    expect(await fetchBootRegion(reply(500, { region: 'blocked' }))).toBe('ok');
    expect(await fetchBootRegion((async () => Promise.reject(new TypeError('offline'))) as typeof fetch)).toBe('ok');
  });
});

describe('scrub and osMajorOf', () => {
  it('scrubs bearer tokens, emails, query strings and long hex or base64 runs', () => {
    expect(scrub('Bearer abc.def.ghi failed')).toBe('[redacted] failed');
    expect(scrub('mail me@example.test now')).toBe('mail [redacted] now');
    expect(scrub('GET /a/b?x=1&y=2 failed')).toBe('GET /a/b failed');
    expect(scrub(`id ${'a'.repeat(32)} end`)).toBe('id [redacted] end');
    expect(scrub(`blob ${'Ab1+'.repeat(10)}== end`)).toContain('[redacted]');
    expect(scrub('ab '.repeat(1000)).length).toBe(512);
  });

  it('reads the OS major version without sending the UA', () => {
    expect(osMajorOf('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15')).toBe(26);
    expect(osMajorOf('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/150')).toBe(15);
    expect(osMajorOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe(10);
    expect(osMajorOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')).toBe(10);
    expect(osMajorOf('something else')).toBe(0);
  });
});

describe('ErrorReporter', () => {
  function reporter() {
    const events: { name: string; props: Record<string, unknown> }[] = [];
    const r = new ErrorReporter({ emit: (name, props) => void events.push({ name, props: props ?? {} }) });
    return { r, events };
  }

  it('sends at most 5 events per fingerprint and counts every error', () => {
    const { r, events } = reporter();
    for (let i = 0; i < 12; i++) r.js('TypeError: x is undefined', 'TypeError\n    at f (https://h.test/assets/main-abc.js:10:20)', 'main.js:10:20');
    expect(events.filter((e) => e.name === 'err.js')).toHaveLength(MAX_PER_FINGERPRINT);
    expect(r.counts.js).toBe(12);
    r.js('RangeError: other', undefined, 'main.js:1:1');
    expect(events.filter((e) => e.name === 'err.js')).toHaveLength(MAX_PER_FINGERPRINT + 1);
  });

  it('folds digits so counters do not split a group', () => {
    expect(fingerprint('failed to load chunk 12', 'a.js:1:1')).toBe(fingerprint('failed to load chunk 99', 'a.js:1:1'));
    expect(fingerprint('failed to load chunk 12', 'a.js:1:1')).not.toBe(fingerprint('failed to load chunk 12', 'b.js:1:1'));
  });

  it('turns rejections into err.promise with a scrubbed message and the top frame', () => {
    const { r, events } = reporter();
    const err = new Error('fetch failed for https://x.test/a?token=zzzz');
    r.promise(err);
    r.promise('plain string reason');
    expect(events.map((e) => e.name)).toEqual(['err.promise', 'err.promise']);
    expect(String(events[0]!.props['msg'])).not.toContain('token=');
    expect(r.counts.promise).toBe(2);
  });

  it('maps GPU errors to err.gpu{kind,msg} and counts lost and uncaptured', () => {
    const { r, events } = reporter();
    r.gpu('init', 'no adapter');
    r.gpu('lost', 'device lost');
    for (let i = 0; i < 9; i++) r.gpu('uncaptured', `validation error ${i}`);
    expect(events.filter((e) => e.name === 'err.gpu' && e.props['kind'] === 'uncaptured')).toHaveLength(MAX_PER_FINGERPRINT);
    expect(r.counts).toMatchObject({ gpuInit: 1, gpuLost: 1, uncaptured: 9 });
  });

  it('extracts the top frame as file:line:col without the origin or query', () => {
    expect(topFrameOf('Error: x\n    at f (https://h.test/assets/main-abc.js?v=1:10:20)')).toBe('/assets/main-abc.js:10:20');
    expect(topFrameOf('f@https://h.test/assets/a.js:3:4')).toBe('/assets/a.js:3:4');
    expect(topFrameOf(undefined, 'fallback.js:1:1')).toBe('fallback.js:1:1');
  });

  it('installs and removes window listeners', () => {
    const { r, events } = reporter();
    const listeners = new Map<string, (e: never) => void>();
    const off = r.install({
      addEventListener: (t, fn) => void listeners.set(t, fn),
      removeEventListener: (t) => void listeners.delete(t),
    });
    listeners.get('error')?.({ message: 'boom', filename: 'https://h.test/a.js', lineno: 1, colno: 2, error: undefined } as never);
    listeners.get('unhandledrejection')?.({ reason: new Error('nope') } as never);
    expect(events.map((e) => e.name)).toEqual(['err.js', 'err.promise']);
    off();
    expect(listeners.size).toBe(0);
  });
});

describe('LifecycleController', () => {
  function setup() {
    const doc = new EventTarget() as EventTarget & { visibilityState: string };
    doc.visibilityState = 'visible';
    const win = new EventTarget();
    const log: string[] = [];
    const lc = new LifecycleController({
      doc: doc as never,
      win: win as never,
      heartbeat: {
        markHidden: () => void log.push('hb:hidden'),
        markVisible: () => void log.push('hb:visible'),
        markClosed: () => void log.push('hb:closed'),
        note: (e) => void log.push(`note:${e}`),
      },
      telemetry: { emit: (n) => void log.push(`emit:${n}`), flush: (r) => void log.push(`flush:${r}`) },
      setPaused: (p) => void log.push(`paused:${String(p)}`),
      clampNextDt: () => void log.push('clamp'),
    });
    lc.attach();
    return { doc, win, log, lc };
  }

  it('hidden pauses the sim, marks the heartbeat and flushes; visible clamps dt and resumes', () => {
    const { doc, log } = setup();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(log).toEqual(['paused:true', 'note:hidden', 'hb:hidden', 'emit:app.hidden', 'flush:hidden']);
    log.length = 0;
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(log).toEqual(['clamp', 'note:visible', 'hb:visible', 'paused:false']);
  });

  it('pagehide flushes and closes the heartbeat (hidden when the page may be restored)', () => {
    const { win, log } = setup();
    win.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
    expect(log).toEqual(['paused:true', 'flush:pagehide', 'hb:closed']);
    log.length = 0;
    win.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
    expect(log).toEqual(['paused:true', 'flush:pagehide', 'hb:hidden']);
  });

  it('ignores a repeated hidden event and detaches', () => {
    const { doc, log, lc } = setup();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(log.filter((l) => l === 'hb:hidden')).toHaveLength(1);
    lc.detach();
    log.length = 0;
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(log).toEqual([]);
  });
});
