import { MessageChannel } from 'node:worker_threads';
import { Rng, type BootPayload, type FrameSignal, type SimConfig } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { SimRuntime } from '../src/sim/runtime.ts';
import {
  attachPmWorker, attachSabWorker, createPmMain, createSabMain, decodeEnvelope, encodeEnvelope, EventRing,
  InputBlock, isFromWorkerMessage, isToWorkerMessage, makeEnvelope, REC_BYTES, SabSnapshotReader, SabSnapshotWriter,
  snapshotBufferBytes, SpscRing, writeRecord, emptyRecord, type FromWorkerMessage, type MainTransport,
  type PortLike, type SnapshotRead,
} from '../src/sim/transport/index.ts';
import { physicsDropConfig } from './scenarios/physics-drop.ts';

const BOOT: BootPayload = { strings: [], prefabs: [], config: { scenario: 'physics-drop' } };
const cfg = (): SimConfig => ({ ...physicsDropConfig('canonical', 1), hashEvery: 1 });
const env = { now: () => 0, blockFor: () => {}, qa: true };
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

interface Frame {
  tick: number;
  alpha: number;
  fresh: boolean;
  cur: { tick: number; count: number; bytes: number[] };
  prev: { tick: number; count: number; bytes: number[] } | null;
  side: string;
  hash: string;
  entities: number;
}

function capture(read: SnapshotRead | null, hash: string, entities: number): Frame {
  if (!read) throw new Error('no snapshot');
  return {
    tick: read.tick,
    alpha: read.alpha,
    fresh: read.fresh,
    cur: { tick: read.cur.tick, count: read.cur.count, bytes: [...read.cur.records] },
    prev: read.prev ? { tick: read.prev.tick, count: read.prev.count, bytes: [...read.prev.records] } : null,
    side: JSON.stringify(read.cur.side),
    hash,
    entities,
  };
}

/** Input pattern applied before frame `f`: taps and holds on a few buttons, plus stick values. */
function applyInput(input: InputBlock, f: number): void {
  if (f % 7 === 3) input.press(0);
  if (f % 7 === 4) input.release(0);
  if (f % 11 === 5) {
    input.press(1);
    input.release(1); // a tap shorter than a tick
  }
  if (f % 13 === 6) input.setHeld(0b101);
  if (f % 13 === 9) input.setHeld(0);
  input.setAxes({ moveX: (f % 50) - 25, moveY: 10 });
  input.setLook(f * 37, f % 100);
}

/** A reproducible FrameSignal sequence: ordinary frames, short frames, long frames, paused frames. */
function signalFor(rng: Rng, f: number): FrameSignal {
  const r = rng.nextU32() % 10;
  const dtSec = r < 5 ? 1 / 60 : r < 7 ? 0.005 : r < 9 ? 1 / 30 : 0.4;
  return { frame: f, nowMs: f * 16.7, dtSec, paused: f % 40 === 39, timeScale: 1 };
}

describe('SAB and postMessage transports drive the same 1,200-tick run (AC-8)', () => {
  it('snapshot bytes, alpha and hashes are identical at every frame', async () => {
    const signals: FrameSignal[] = [];
    const sabFrames: Frame[] = [];
    const pmFrames: Frame[] = [];
    const TARGET = 1200;

    // --- SAB: the worker end runs in this thread; the page end is the production class.
    {
      const { main, init } = createSabMain();
      const runtime = new SimRuntime(attachSabWorker(init), env);
      await runtime.boot(cfg(), BOOT);
      const rng = new Rng(77);
      for (let f = 0; (runtime.sim?.tick ?? 0) < TARGET; f++) {
        const sig = signalFor(rng, f);
        signals.push(sig);
        applyInput(main.input, f);
        expect(main.sendFrame(sig)).toBe(true);
        runtime.pump();
        const sim = runtime.sim!;
        sabFrames.push(capture(main.readSnapshot(), sim.hash(), sim.ecs.entityCount));
      }
      expect(runtime.sim!.tick).toBeGreaterThanOrEqual(TARGET);
      runtime.dispose();
    }

    // --- postMessage: the same signals over a MessageChannel.
    {
      const ch = new MessageChannel();
      const main: MainTransport = createPmMain(ch.port1 as unknown as PortLike);
      const worker = attachPmWorker(ch.port2 as unknown as PortLike);
      const runtime = new SimRuntime(worker, env);
      await runtime.boot(cfg(), BOOT);
      let syncSeq = 0;
      for (let f = 0; f < signals.length; f++) {
        applyInput(main.input, f);
        expect(main.sendFrame(signals[f] as FrameSignal)).toBe(true);
        await worker.waitForCommand();
        runtime.pump();
        // Events and snapshots share the port and arrive in order: once this marker is back, so is the snapshot.
        const marker = `sync-${syncSeq++}`;
        worker.postEvent(makeEnvelope('log', 0, { level: 'info' as const, message: marker }));
        let seen = false;
        while (!seen) {
          main.drainEvents((m: FromWorkerMessage) => {
            if (m.t === 'log' && m.p.message === marker) seen = true;
          });
          if (!seen) await tick();
        }
        const sim = runtime.sim!;
        pmFrames.push(capture(main.readSnapshot(), sim.hash(), sim.ecs.entityCount));
      }
      runtime.dispose();
      ch.port1.close();
    }

    expect(pmFrames.length).toBe(sabFrames.length);
    let compared = 0;
    for (let f = 0; f < sabFrames.length; f++) {
      const a = sabFrames[f] as Frame;
      const b = pmFrames[f] as Frame;
      expect(b.hash, `hash at frame ${f}`).toBe(a.hash);
      expect(b.tick, `tick at frame ${f}`).toBe(a.tick);
      expect(b.alpha, `alpha at frame ${f}`).toBe(a.alpha);
      expect(b.cur.tick).toBe(a.cur.tick);
      expect(b.cur.count).toBe(a.cur.count);
      expect(b.cur.bytes, `current records at frame ${f}`).toEqual(a.cur.bytes);
      expect(b.prev?.tick ?? null).toBe(a.prev?.tick ?? null);
      expect(b.prev?.bytes ?? null, `previous records at frame ${f}`).toEqual(a.prev?.bytes ?? null);
      expect(b.side).toBe(a.side);
      compared++;
    }
    expect(compared).toBeGreaterThan(500);
    // Sanity: the run really advanced the world and published the previous tick alongside the newest.
    const last = sabFrames[sabFrames.length - 1] as Frame;
    expect(last.cur.count).toBeGreaterThanOrEqual(64);
    expect(last.prev?.tick).toBe(last.cur.tick - 1);
    expect(last.alpha).toBeGreaterThanOrEqual(0);
    expect(last.alpha).toBeLessThan(1);
  }, 120_000);
});

describe('stats reports and the pause (BD-FIX-CI9-W04)', () => {
  it('the first paused frame group posts a report at once with the tick the sim stopped at; so does the first resumed one', async () => {
    const { main, init } = createSabMain();
    const runtime = new SimRuntime(attachSabWorker(init), env);
    await runtime.boot(cfg(), BOOT);
    const reports: { tick: number; paused: boolean }[] = [];
    const drain = (): void => {
      main.drainEvents((m: FromWorkerMessage) => {
        if (m.t === 'stats') reports.push({ tick: m.p.stats.tick, paused: m.p.paused });
      });
    };
    const frame = (f: number, paused: boolean): void => {
      expect(main.sendFrame({ frame: f, nowMs: f * 50, dtSec: 0.05, paused, timeScale: 1 })).toBe(true);
      runtime.pump();
      drain();
    };
    drain();
    // two running frame groups: fewer than STATS_EVERY_FRAMES, so no regular report yet
    frame(0, false);
    frame(1, false);
    expect(reports).toEqual([]);
    const stoppedAt = runtime.sim!.tick;
    expect(stoppedAt).toBeGreaterThan(0);
    frame(2, true);
    expect(reports).toEqual([{ tick: stoppedAt, paused: true }]);
    frame(3, true);
    expect(runtime.sim!.tick).toBe(stoppedAt);
    expect(reports).toHaveLength(1);
    frame(4, false);
    expect(reports[1]).toEqual({ tick: runtime.sim!.tick, paused: false });
    expect(runtime.sim!.tick).toBeGreaterThan(stoppedAt);
    runtime.dispose();
  });

  it('every report while paused names the frame whose signal stopped the ticks; running reports name none (BD-FIX-CI10-R03)', async () => {
    const { main, init } = createSabMain();
    const runtime = new SimRuntime(attachSabWorker(init), env);
    await runtime.boot(cfg(), BOOT);
    const reports: { paused: boolean; since: number | null }[] = [];
    const drain = (): void => {
      main.drainEvents((m: FromWorkerMessage) => {
        if (m.t === 'stats') reports.push({ paused: m.p.paused, since: m.p.pausedSince });
      });
    };
    const send = (f: number, paused: boolean): void => {
      expect(main.sendFrame({ frame: f, nowMs: f * 50, dtSec: 0.05, paused, timeScale: 1 })).toBe(true);
    };
    drain();
    send(0, false);
    runtime.pump();
    // a running signal and the first two paused ones in one pump: the pause starts with signal 2
    send(1, false);
    send(2, true);
    send(3, true);
    runtime.pump();
    drain();
    expect(reports).toEqual([{ paused: true, since: 2 }]);
    // the regular reports of the pause keep naming signal 2
    for (let f = 4; f < 4 + 6; f++) {
      send(f, true);
      runtime.pump();
    }
    drain();
    expect(reports.slice(1).every((r) => r.paused && r.since === 2)).toBe(true);
    expect(reports.length).toBeGreaterThan(1);
    send(10, false);
    runtime.pump();
    drain();
    expect(reports.at(-1)).toEqual({ paused: false, since: null });
    runtime.dispose();
  });
});

describe('snapshot triple buffer and seqlock', () => {
  function pair(): { w: SabSnapshotWriter; r: SabSnapshotReader; raw: Int32Array } {
    const sab = new SharedArrayBuffer(snapshotBufferBytes());
    return { w: new SabSnapshotWriter(sab), r: new SabSnapshotReader(sab), raw: new Int32Array(sab) };
  }
  const put =
    (n: number) =>
    (view: DataView): number => {
      for (let i = 0; i < n; i++) writeRecord(view, i, { ...emptyRecord(), handle: i + 1, px: i * 1.5 });
      return n;
    };

  it('the reader always sees the newest tick and the one before it, whatever the write pattern', () => {
    const { w, r } = pair();
    expect(r.read()).toBeNull(); // nothing published yet
    for (let t = 1; t <= 9; t++) {
      w.write(t, put(t), { n: t });
      if (t % 3 !== 0) {
        const got = r.read();
        expect(got?.tick).toBe(t);
        expect(got?.fresh).toBe(true);
        expect(got?.cur.count).toBe(t);
        expect(got?.cur.side).toEqual({ n: t });
        expect(got?.prev?.tick).toBe(t === 1 ? undefined : t - 1);
      }
    }
    // Skipped reads (t = 3, 6, 9 were not read in between) never produce a stale pair: read now sees tick 9 and 8.
    const final = r.read();
    expect(final?.tick).toBe(9);
    expect(final?.prev?.tick).toBe(8);
    expect(final?.fresh).toBe(true);
    expect(r.read()?.fresh).toBe(false);
  });

  it('a read during a write reuses the previous snapshot and counts it', () => {
    const { w, r, raw } = pair();
    w.write(1, put(2), { a: 1 });
    const first = r.read();
    expect(first?.tick).toBe(1);
    const firstBytes = [...(first as SnapshotRead).cur.records];

    w.write(2, put(3), { a: 2 });
    // Pretend the writer is still inside the slot it published: odd sequence number on the latest slot.
    const order = raw[0] as number;
    const latestSlot = order & 3;
    const seqIdx = 8 + latestSlot * 8;
    const good = raw[seqIdx] as number;
    raw[seqIdx] = good | 1;
    const reuseBefore = r.reuse;
    const torn = r.read();
    expect(torn?.fresh).toBe(false);
    expect(torn?.tick).toBe(1); // still the previous snapshot
    expect([...(torn as SnapshotRead).cur.records]).toEqual(firstBytes);
    expect(r.reuse).toBe(reuseBefore + 1);

    raw[seqIdx] = good; // the write completes
    const healed = r.read();
    expect(healed?.fresh).toBe(true);
    expect(healed?.tick).toBe(2);
    expect(healed?.cur.count).toBe(3);
  });

  it('an unchanged tick is reported as not fresh (a second rAF before the next tick)', () => {
    const { w, r } = pair();
    w.write(5, put(1));
    expect(r.read()?.fresh).toBe(true);
    w.setAlpha(0.25);
    const again = r.read();
    expect(again?.fresh).toBe(false);
    expect(again?.alpha).toBe(0.25);
    expect(r.reuse).toBe(1);
  });

  it('an oversized side block is replaced by {} instead of corrupting the slot', () => {
    const { w, r } = pair();
    w.write(1, put(1), { big: 'x'.repeat(9000) });
    expect(r.read()?.cur.side).toEqual({});
  });
});

describe('event ring', () => {
  it('an overflowing ring drops events, counts them and never blocks; accepted events arrive intact and in order', () => {
    const sab = new SharedArrayBuffer(SpscRing.byteLength(512));
    SpscRing.init(sab, 512);
    const events = new EventRing(new SpscRing(sab));
    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < 100; i++) {
      const ok = events.post(makeEnvelope('log', i, { level: 'info', message: `event ${i}` }));
      if (ok) accepted++;
      else refused++;
    }
    expect(accepted).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
    expect(events.dropped).toBe(refused);
    const got: string[] = [];
    events.drain((m) => {
      if (m.t === 'log') got.push(m.p.message);
    });
    expect(got.length).toBe(accepted);
    expect(got).toEqual(Array.from({ length: accepted }, (_, i) => `event ${i}`));
    // Space is free again after the drain.
    expect(events.post(makeEnvelope('log', 1, { level: 'warn', message: 'after' }))).toBe(true);
  });

  it('the byte ring wraps around its end without corrupting messages', () => {
    const sab = new SharedArrayBuffer(SpscRing.byteLength(128));
    SpscRing.init(sab, 128);
    const ring = new SpscRing(sab);
    const rng = new Rng(5);
    let sent = 0;
    let got = 0;
    for (let round = 0; round < 400; round++) {
      const len = 1 + (rng.nextU32() % 40);
      const payload = Uint8Array.from({ length: len }, (_, i) => (round + i) & 0xff);
      if (ring.push(payload)) sent++;
      if (round % 3 === 0) {
        for (let m = ring.pop(); m !== null; m = ring.pop()) {
          const first = (m[0] as number);
          expect(m.every((b, i) => b === ((first + i) & 0xff))).toBe(true);
          got++;
        }
      }
    }
    for (let m = ring.pop(); m !== null; m = ring.pop()) got++;
    expect(got).toBe(sent);
    expect(() => ring.push(new Uint8Array(100))).toThrow(RangeError); // larger than half the ring
  });
});

describe('input block', () => {
  it('a press and release between two worker reads sets pressed (and released) on exactly one tick', () => {
    const sab = new SharedArrayBuffer(InputBlock.byteLength());
    const page = InputBlock.create(sab);
    const worker = InputBlock.create(sab);
    page.press(4);
    page.release(4); // a tap shorter than a tick
    const t1 = worker.sample(1);
    expect(t1.buttons).toBe(0);
    expect(t1.pressed).toBe(1 << 4);
    expect(t1.released).toBe(1 << 4);
    const t2 = worker.sample(2);
    expect(t2.pressed).toBe(0);
    expect(t2.released).toBe(0);
  });

  it('a held button keeps `buttons` set but is a rising edge only once; release is a falling edge once', () => {
    const sab = new SharedArrayBuffer(InputBlock.byteLength());
    const page = InputBlock.create(sab);
    const worker = InputBlock.create(sab);
    page.press(2);
    const frames = [worker.sample(1), worker.sample(2), worker.sample(3)];
    expect(frames.map((f) => f.pressed)).toEqual([4, 0, 0]);
    expect(frames.map((f) => f.buttons)).toEqual([4, 4, 4]);
    page.release(2);
    const after = [worker.sample(4), worker.sample(5)];
    expect(after.map((f) => f.released)).toEqual([4, 0]);
    expect(after.map((f) => f.buttons)).toEqual([0, 0]);
    // Pressing a bit that is already held latches no second edge.
    page.press(3);
    worker.sample(6);
    page.press(3);
    expect(worker.sample(7).pressed).toBe(0);
  });

  it('axes, camera and context round-trip through the packed words with signs intact', () => {
    const page = InputBlock.create();
    page.setAxes({ moveX: -127, moveY: 90, throttle: 100, brake: 5, steer: -3 });
    page.setContext(4, 7);
    page.setLook(65535, -16000);
    const f = page.sample(9);
    expect(f).toMatchObject({ tick: 9, moveX: -127, moveY: 90, throttle: 100, brake: 5, steer: -3, context: 4, device: 7, camYaw: 65535, camPitch: -16000 });
    page.setAxes({ moveX: 500, throttle: -4 }); // clamped, other axes kept
    const g = page.sample(10);
    expect(g.moveX).toBe(127);
    expect(g.throttle).toBe(0);
    expect(g.moveY).toBe(90);
    expect(g.steer).toBe(-3);
  });

  it('postMessage drain/apply moves edges once', () => {
    const page = InputBlock.create();
    const worker = InputBlock.create();
    page.press(1);
    worker.apply(page.drain());
    worker.apply(page.drain()); // a second frame with no new edges must not clear or repeat the first
    expect(worker.sample(1).pressed).toBe(2);
    expect(worker.sample(2).pressed).toBe(0);
    expect(worker.sample(2).buttons).toBe(2);
  });
});

describe('message guards run on both sides', () => {
  const frame = { frame: 1, nowMs: 5, dtSec: 1 / 60, paused: false, timeScale: 1 as const };

  it('accepts well-formed page messages and rejects everything else', () => {
    expect(isToWorkerMessage(makeEnvelope('frame', 0, frame))).toBe(true);
    expect(isToWorkerMessage(makeEnvelope('ctl', 1, { t: 'save.request', reason: 'hidden' }))).toBe(true);
    expect(isToWorkerMessage(makeEnvelope('dbg', 2, { t: 'debug.stall', ms: 500 }))).toBe(true);
    expect(isToWorkerMessage(makeEnvelope('dbg', 2, { t: 'debug.rebase', to: [1, 2, 3] }))).toBe(true);
    for (const bad of [
      null, 5, 'frame', {}, { v: 2, t: 'frame', seq: 0, p: frame },
      makeEnvelope('frame', 0, { ...frame, timeScale: 3 }),
      makeEnvelope('frame', 0, { ...frame, dtSec: -1 }),
      makeEnvelope('frame', 0, { ...frame, dtSec: NaN }),
      makeEnvelope('frame', 0.5, frame),
      makeEnvelope('ctl', 0, { t: 'save.request', reason: 'other' }),
      makeEnvelope('dbg', 0, { t: 'debug.stall', ms: 1e9 }),
      makeEnvelope('dbg', 0, { t: 'debug.rm-rf' }),
      makeEnvelope('nope', 0, {}),
    ]) {
      expect(isToWorkerMessage(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('accepts well-formed worker messages and rejects everything else', () => {
    const stats = { tick: 1, ticksLastFrame: 1, tickMsP50: 0, tickMsP99: 0, droppedSec: 0, overruns: 0 };
    expect(isFromWorkerMessage(makeEnvelope('ready', 0, { physicsBuild: 'simd-compat', transport: 'sab' }))).toBe(true);
    expect(isFromWorkerMessage(makeEnvelope('stats', 0, { stats, nanCount: 0, hash: null, physicsBuild: 'simd-compat', rebases: 0, entities: 1, bodies: 1, eventsDropped: 0, paused: false, pausedSince: null }))).toBe(true);
    expect(isFromWorkerMessage(makeEnvelope('ctl.result', 0, { t: 'save.result', ok: false, reason: 'not-implemented' }))).toBe(true);
    for (const bad of [
      makeEnvelope('ready', 0, { physicsBuild: 'bullet', transport: 'sab' }),
      makeEnvelope('stats', 0, { stats: { tick: 1 } }),
      makeEnvelope('ctl.result', 0, { t: 'save.result', ok: true, reason: 'x' }),
      makeEnvelope('log', 0, { level: 'fatal', message: 'x' }),
      makeEnvelope('snap', 0, { tick: 1, alpha: 0, cur: {}, prev: null }),
    ]) {
      expect(isFromWorkerMessage(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('decodeEnvelope returns null for bytes that are not JSON', () => {
    expect(decodeEnvelope(new Uint8Array([0xff, 0x00, 0x7b]))).toBeNull();
    const env = makeEnvelope('frame', 3, frame);
    expect(decodeEnvelope(encodeEnvelope(env))).toEqual(env);
  });

  it('the SAB worker ignores a hand-written bad message in the ring', () => {
    const { main, init } = createSabMain();
    const worker = attachSabWorker(init);
    const ring = new SpscRing(init.commands);
    ring.push(encodeEnvelope({ v: 1, t: 'frame', seq: 0, p: { frame: 'one' } }));
    main.sendFrame(frame);
    const got: string[] = [];
    expect(worker.drain((m) => got.push(m.t))).toBe(1);
    expect(got).toEqual(['frame']);
  });
});

describe('record codec', () => {
  it('writes and reads the 64-byte layout from the contract', () => {
    const buf = new ArrayBuffer(REC_BYTES * 2);
    const v = new DataView(buf);
    writeRecord(v, 1, {
      handle: 0xdeadbeef, renderKey: 7, px: 1234.5678901234, py: -2.5, pz: 1e7, qx: 0.5, qy: -0.5, qz: 0.5, qw: 0.5,
      animState: 12, flags: 1, animP0: 0.25, animP1: -4, variant: 3, lod: 2,
    });
    expect(v.getUint32(REC_BYTES, true)).toBe(0xdeadbeef);
    expect(v.getFloat64(REC_BYTES + 8, true)).toBe(1234.5678901234);
    expect(v.getFloat32(REC_BYTES + 44, true)).toBe(0.5);
    expect(v.getUint16(REC_BYTES + 48, true)).toBe(12);
    expect(v.getUint8(REC_BYTES + 61)).toBe(2);
    expect(v.getUint16(REC_BYTES + 62, true)).toBe(0);
  });
});
