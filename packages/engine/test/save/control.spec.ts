import type { BootPayload, FrameSignal } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { SimHostImpl } from '../../src/sim/sim-host.ts';
import { SaveControl, type SaveSnapshotEntry } from '../../src/sim/worker/save-control.ts';
import { InProcessWorker } from '../inprocess-worker.ts';
import { physicsDropConfig } from '../scenarios/physics-drop.ts';
import { clock, mkProfile, newStore, openSvc, sandboxData } from './helpers.ts';

const BOOT: BootPayload = { strings: [], prefabs: [], config: { scenario: 'physics-drop' } };
const sig = (frame: number, nowMs: number): FrameSignal => ({ frame, nowMs, dtSec: 1 / 60, paused: false, timeScale: 1 });

describe('engine/save.control (SimControlMessage and the write port)', () => {
  it('save.request writes what the collector returns and answers with the slot count', async () => {
    const svc = await openSvc(await newStore('memory'), { capability: 'sandbox', now: clock().now });
    await mkProfile(svc);
    const entries: SaveSnapshotEntry[] = [{ slot: 'sandbox', data: sandboxData(1) }, { slot: 'mod:x', data: { v: 1 } }];
    const ctl = new SaveControl({ service: async () => svc, collect: () => entries });
    expect(await ctl.handle({ t: 'save.request', reason: 'hidden' })).toEqual({ t: 'save.result', ok: true, slots: 2 });
    expect(await svc.describeSlot(svc.activeProfile!, 'sandbox')).toMatchObject({ gen: 1 });
  });

  it('answers not-eligible when nothing is due and the first failing C05 code when a write fails', async () => {
    const svc = await openSvc(await newStore('memory'), { capability: 'sandbox', now: clock().now });
    await mkProfile(svc);
    const none = new SaveControl({ service: async () => svc, collect: () => null });
    expect(await none.handle({ t: 'save.request', reason: 'hidden' })).toEqual({ t: 'save.result', ok: false, reason: 'not-eligible' });
    const bad = new SaveControl({ service: async () => svc, collect: () => [{ slot: 'core', data: { a: 1 } }] });
    expect(await bad.handle({ t: 'save.request', reason: 'hidden' })).toEqual({ t: 'save.result', ok: false, reason: 'NOT_ALLOWED' });
  });

  it('the write port keeps the latest data per slot and writes at flush', async () => {
    const svc = await openSvc(await newStore('memory'), { capability: 'sandbox', now: clock().now });
    const p = await mkProfile(svc);
    const ctl = new SaveControl({ service: async () => svc, collect: () => null });
    ctl.post('sandbox', sandboxData(1), 'interval');
    ctl.post('sandbox', sandboxData(2), 'interval');
    ctl.post('mod:x', { v: 1 }, 'interval');
    ctl.post('core', { nope: true }, 'interval'); // not allowed for this session: recorded as a failure
    expect(ctl.pending).toBe(3);
    expect(await ctl.flush()).toBe(2);
    expect(ctl.pending).toBe(0);
    expect(ctl.failures).toEqual([{ slot: 'core', error: 'NOT_ALLOWED' }]);
    expect(((await svc.load(p.id)).sandbox as unknown as { toggles: { n: number } }).toggles.n).toBe(2);
    expect(await ctl.flush()).toBe(0);
  });

  it('a posted write keeps the capability it was posted under when the capability changes before the flush (BD-FIX-CI7-F04)', async () => {
    const svc = await openSvc(await newStore('memory'), { capability: 'sandbox', now: clock().now });
    const p = await mkProfile(svc);
    const ctl = new SaveControl({ service: async () => svc, collect: () => null });
    // The idle menu's core save: the capability is raised for the post and lowered by the next tick, which can run before the flush.
    ctl.setCapability('story');
    ctl.post('core', { avatar: { name: 'Coast Test' } }, 'manual');
    ctl.setCapability('sandbox');
    ctl.post('sandbox', sandboxData(3), 'interval');
    expect(await ctl.flush()).toBe(2);
    expect(ctl.failures).toEqual([]);
    expect((await svc.load(p.id)).core).toMatchObject({ avatar: { name: 'Coast Test' } });
    // A write posted under a capability that does not allow its slot is still refused.
    ctl.post('core', { avatar: null }, 'manual');
    expect(await ctl.flush()).toBe(0);
    expect(ctl.failures).toEqual([{ slot: 'core', error: 'NOT_ALLOWED' }]);
  });

  it('after a flush the service is back on the capability in force, not the last write\'s (BD-FIX-CI8-G04)', async () => {
    const svc = await openSvc(await newStore('memory'), { capability: 'sandbox', now: clock().now });
    const p = await mkProfile(svc);
    const caps: string[] = [];
    const writer = {
      write: (slot: Parameters<typeof svc.write>[0], data: unknown, reason: Parameters<typeof svc.write>[2]) => svc.write(slot, data, reason),
      setCapability: (cap: Parameters<typeof svc.setCapability>[0]) => {
        caps.push(cap);
        svc.setCapability(cap);
      },
    };
    const ctl = new SaveControl({ service: async () => writer, collect: () => null });
    ctl.setCapability('story');
    ctl.post('core', { avatar: { name: 'Coast Test' } }, 'manual');
    ctl.setCapability('sandbox');
    expect(await ctl.flush()).toBe(1);
    expect(caps).toEqual(['sandbox', 'story', 'sandbox']);
    // the raised capability did not outlive the flush: a direct write of the core slot is refused again
    expect(await svc.write('core', { avatar: null }, 'manual')).toMatchObject({ ok: false, error: 'NOT_ALLOWED' });
    expect((await svc.load(p.id)).core).toMatchObject({ avatar: { name: 'Coast Test' } });
  });

  it('SimRuntime hands save.request to the installed SaveControl between ticks and posts ctl.result', async () => {
    const workers: InProcessWorker[] = [];
    const host = new SimHostImpl({ spawn: () => { const w = new InProcessWorker(); workers.push(w); return w; }, sab: true, qa: false });
    const started = host.start(physicsDropConfig('canonical'), BOOT);
    await workers[0]?.ready();
    await started;
    const rt = workers[0]!.runtime!;
    const svc = await openSvc(await newStore('memory'), { capability: 'sandbox', now: clock().now });
    await mkProfile(svc);
    rt.saveControl = new SaveControl({ service: async () => svc, collect: () => [{ slot: 'sandbox', data: sandboxData(7) }] });

    host.transport?.sendControl({ t: 'save.request', reason: 'hidden' });
    workers[0]?.pump();
    await new Promise((r) => setTimeout(r, 20)); // the write is async
    host.frame(sig(0, 10));
    expect(host.events.some((e) => e.t === 'ctl.result' && e.p.ok === true && e.p.slots === 1)).toBe(true);
    expect((await svc.describeSlot(svc.activeProfile!, 'sandbox'))?.gen).toBe(1);

    // A port write queued by a system is flushed by the next pump, outside any tick.
    rt.saveControl.post('sandbox', sandboxData(8), 'interval');
    host.frame(sig(1, 30));
    workers[0]?.pump();
    await new Promise((r) => setTimeout(r, 20));
    expect((await svc.describeSlot(svc.activeProfile!, 'sandbox'))?.gen).toBe(2);
    await host.dispose();
  }, 60_000);
});
