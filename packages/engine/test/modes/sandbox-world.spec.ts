import type { JsonValue, ModeContext, UiCommand } from '@dv/shared';
import { describe, expect, it, vi } from 'vitest';
import { CLOCK_CONFIG } from '../../src/sim/world/clock.ts';
import { SANDBOX_REFUSE_ONLINE } from '../../src/sim/modes/builtin/sandbox.ts';
import { makeRig, type Rig } from './fixture.ts';

const FAKE_NET: NonNullable<ModeContext['net']> = { slot: 1, peers: () => [] };

interface WorldVm {
  weather: string | null;
  hour: number;
  paused: boolean;
  sync: boolean;
  timeScale: number;
  blackout: boolean;
  density: { traffic: number; ped: number; parked: number };
  shortcuts: string[];
  online: boolean;
}

function spies() {
  const clock = { setHour: vi.fn(), pause: vi.fn() };
  const traffic = { setBlackout: vi.fn(), setDensity: vi.fn(), release: vi.fn(), closeEdges: vi.fn(), blackout: false };
  const port = { holdWeather: vi.fn(), setTimeScale: vi.fn() };
  const net: { v: ModeContext['net'] } = { v: null };
  const all = (): Record<string, { mock: { calls: unknown[][] } }> => ({
    setHour: clock.setHour, pause: clock.pause, setBlackout: traffic.setBlackout, setDensity: traffic.setDensity, release: traffic.release,
    holdWeather: port.holdWeather, setTimeScale: port.setTimeScale,
  });
  const total = (): number => Object.values(all()).reduce((n, f) => n + f.mock.calls.length, 0);
  const reset = (): void => Object.values(all()).forEach((f) => (f as unknown as ReturnType<typeof vi.fn>).mockClear());
  return { clock, traffic, port, net, total, reset };
}

type Sp = ReturnType<typeof spies>;

function build(sp: Sp): { rig: Rig; vm: () => WorldVm | undefined } {
  const rig = makeRig({ clock: sp.clock, world: () => ({ traffic: sp.traffic }) as never, sandboxWorld: () => sp.port, net: () => sp.net.v });
  let last: WorldVm | undefined;
  const vm = (): WorldVm | undefined => {
    rig.ui.flushTick();
    for (const p of rig.ui.takeOutbox()?.patches ?? []) if (p.k === 'mode.sandbox.world') last = p.v as unknown as WorldVm;
    return last;
  };
  return { rig, vm };
}

const set = (rig: Rig, path: string, v: boolean | number): void => rig.dispatch({ t: 'sandbox.set', path, v } as UiCommand);
const act = (rig: Rig, name: string, args?: Record<string, JsonValue>): void =>
  rig.dispatch({ t: 'mode.cmd', mode: 'sandbox', name, ...(args ? { args } : {}) } as UiCommand);

async function sandboxRig(): Promise<{ sp: Sp; rig: Rig; vm: () => WorldVm | undefined }> {
  const sp = spies();
  const { rig, vm } = build(sp);
  rig.dispatch({ t: 'mode.start', id: 'sandbox' });
  await rig.run(4);
  expect(rig.host.stack.entries.some((e) => e.id === 'sandbox' && e.state === 'Running')).toBe(true);
  vm();
  sp.reset();
  return { sp, rig, vm };
}

describe('sandbox world settings (AC-5)', () => {
  it('weather preset 3 holds rain as a string; -1 releases and keeps the string', async () => {
    const { sp, rig, vm } = await sandboxRig();
    set(rig, 'sandbox.weather.preset', 3);
    expect(rig.slices.sandbox.weather).toBe('rain');
    expect(rig.slices.sandbox.toggles['sandbox.weather.hold']).toBe(true);
    expect(rig.slices.sandbox.toggles['sandbox.weather.preset']).toBeUndefined();
    expect(sp.port.holdWeather.mock.calls).toEqual([['rain']]);
    expect(sp.total()).toBe(1);
    expect(vm()?.weather).toBe('rain');
    set(rig, 'sandbox.weather.preset', -1);
    expect(rig.slices.sandbox.weather).toBe('rain');
    expect(rig.slices.sandbox.toggles['sandbox.weather.hold']).toBe(false);
    expect(sp.port.holdWeather.mock.calls).toEqual([['rain'], [null]]);
    expect(vm()?.weather).toBeNull();
  });

  it('time.hour sets the hour and turns sync off; paused and sync follow their table rows', async () => {
    const { sp, rig, vm } = await sandboxRig();
    set(rig, 'sandbox.time.hour', 7.5);
    expect(rig.slices.sandbox.clock.hour).toBe(7.5);
    expect(sp.clock.setHour.mock.calls).toEqual([[7.5]]);
    expect(sp.total()).toBe(1);
    expect(rig.slices.sandbox.toggles['sandbox.time.hour']).toBeUndefined();
    sp.reset();
    set(rig, 'sandbox.time.paused', true);
    expect(rig.slices.sandbox.clock.paused).toBe(true);
    expect(sp.clock.pause.mock.calls).toEqual([[true]]);
    expect(sp.total()).toBe(1);
    expect(vm()?.paused).toBe(true);
    sp.reset();
    set(rig, 'sandbox.time.sync', true);
    expect(rig.slices.sandbox.clock.syncSystemTime).toBe(true);
    expect(sp.clock.pause.mock.calls).toEqual([[true]]);
    sp.reset();
    // paused while synced changes the stored value only
    set(rig, 'sandbox.time.paused', false);
    expect(rig.slices.sandbox.clock.paused).toBe(false);
    expect(sp.total()).toBe(0);
    set(rig, 'sandbox.time.paused', true);
    sp.reset();
    set(rig, 'sandbox.time.sync', false);
    expect(sp.clock.pause.mock.calls).toEqual([[true]]);
    sp.reset();
    set(rig, 'sandbox.time.sync', true);
    set(rig, 'sandbox.time.hour', 20);
    expect(rig.slices.sandbox.clock.syncSystemTime).toBe(false);
    expect(vm()?.sync).toBe(false);
  });

  it('world speed, blackout and density land in toggles and make their one call', async () => {
    const { sp, rig, vm } = await sandboxRig();
    set(rig, 'sandbox.world.timeScale', 2);
    expect(rig.slices.sandbox.toggles['sandbox.world.timeScale']).toBe(2);
    expect(sp.port.setTimeScale.mock.calls).toEqual([[2]]);
    expect(vm()?.timeScale).toBe(2);
    set(rig, 'sandbox.world.blackout', true);
    expect(rig.slices.sandbox.toggles['sandbox.world.blackout']).toBe(true);
    expect(sp.traffic.setBlackout.mock.calls).toEqual([[true, 'sandbox']]);
    expect(vm()?.blackout).toBe(true);
    for (const kind of ['traffic', 'ped', 'parked'] as const) {
      set(rig, `sandbox.world.density.${kind}`, 0.35);
      expect(rig.slices.sandbox.toggles[`sandbox.world.density.${kind}`]).toBe(0.35);
      expect(sp.traffic.setDensity.mock.calls.at(-1)).toEqual([kind, 0.35, 'sandbox']);
      expect(vm()?.density[kind]).toBe(0.35);
    }
    expect(sp.traffic.setDensity.mock.calls.length).toBe(3);
  });

  it('an invalid value writes nothing and calls nothing', async () => {
    const { sp, rig, vm } = await sandboxRig();
    const before = structuredClone(rig.slices.sandbox);
    const bad: [string, boolean | number][] = [
      ['sandbox.weather.preset', 6], ['sandbox.weather.preset', -2], ['sandbox.weather.preset', 1.5], ['sandbox.weather.preset', true],
      ['sandbox.time.hour', 24], ['sandbox.time.hour', -1], ['sandbox.time.hour', 7.25], ['sandbox.time.hour', true],
      ['sandbox.time.paused', 1], ['sandbox.time.sync', 0],
      ['sandbox.world.timeScale', 3], ['sandbox.world.timeScale', true],
      ['sandbox.world.blackout', 1],
      ['sandbox.world.density.traffic', 0.5], ['sandbox.world.density.ped', 2], ['sandbox.world.density.parked', true],
      ['sandbox.world.density.bogus', 1], ['sandbox.weather.hold', true], ['sandbox.time.other', 1],
    ];
    const seen = vm();
    for (const [p, v] of bad) set(rig, p, v);
    expect(rig.slices.sandbox).toEqual(before);
    expect(sp.total()).toBe(0);
    expect(vm()).toEqual(seen);
  });

  it('mode.quit releases everything; a second mode.start re-applies the stored state', async () => {
    const { sp, rig } = await sandboxRig();
    set(rig, 'sandbox.weather.preset', 3);
    set(rig, 'sandbox.time.hour', 9);
    set(rig, 'sandbox.time.paused', true);
    set(rig, 'sandbox.world.timeScale', 2);
    set(rig, 'sandbox.world.blackout', true);
    set(rig, 'sandbox.world.density.traffic', 0);
    sp.reset();
    rig.dispatch({ t: 'mode.quit' });
    await rig.run(2);
    expect(sp.port.holdWeather.mock.calls).toEqual([[null]]);
    expect(sp.port.setTimeScale.mock.calls).toEqual([[1]]);
    expect(sp.traffic.release.mock.calls).toEqual([['sandbox']]);
    expect(sp.clock.pause.mock.calls).toEqual([[false]]);
    sp.reset();
    rig.dispatch({ t: 'mode.start', id: 'sandbox' });
    await rig.run(4);
    expect(sp.port.holdWeather.mock.calls).toEqual([['rain']]);
    expect(sp.port.setTimeScale.mock.calls).toEqual([[2]]);
    expect(sp.traffic.setBlackout.mock.calls).toEqual([[true, 'sandbox']]);
    expect(sp.traffic.setDensity.mock.calls).toEqual([['traffic', 0, 'sandbox']]);
    expect(sp.clock.setHour.mock.calls).toEqual([[9]]);
    expect(sp.clock.pause.mock.calls).toEqual([[true]]);
  });

  it('a clock that is not paused is not touched on exit, and the hour is not re-applied on enter', async () => {
    const { sp, rig } = await sandboxRig();
    set(rig, 'sandbox.time.hour', 9);
    sp.reset();
    rig.dispatch({ t: 'mode.quit' });
    await rig.run(2);
    expect(sp.clock.pause.mock.calls).toEqual([]);
    sp.reset();
    rig.dispatch({ t: 'mode.start', id: 'sandbox' });
    await rig.run(4);
    expect(sp.clock.setHour).not.toHaveBeenCalled();
  });

  it('without a port the values are stored and nothing throws', async () => {
    const rig = makeRig();
    rig.dispatch({ t: 'mode.start', id: 'sandbox' });
    await rig.run(4);
    set(rig, 'sandbox.weather.preset', 2);
    set(rig, 'sandbox.world.timeScale', 0.5);
    set(rig, 'sandbox.world.blackout', true);
    expect(rig.slices.sandbox.weather).toBe('overcast');
    expect(rig.slices.sandbox.toggles['sandbox.world.timeScale']).toBe(0.5);
    rig.dispatch({ t: 'mode.quit' });
    await rig.run(2);
    expect(rig.host.stack.entries.length).toBe(0);
  });
});

describe('going online mid-session (AC-6)', () => {
  it('releases every effect once, keeps the slice, and re-applies on the way back', async () => {
    const { sp, rig, vm } = await sandboxRig();
    set(rig, 'sandbox.weather.preset', 3);
    set(rig, 'sandbox.world.timeScale', 2);
    set(rig, 'sandbox.world.blackout', true);
    set(rig, 'sandbox.world.density.traffic', 0);
    set(rig, 'sandbox.time.paused', true);
    expect(vm()?.online).toBe(false);
    sp.reset();
    const before = structuredClone(rig.slices.sandbox);
    sp.net.v = FAKE_NET;
    await rig.run(1);
    expect(sp.port.holdWeather.mock.calls).toEqual([[null]]);
    expect(sp.port.setTimeScale.mock.calls).toEqual([[1]]);
    expect(sp.traffic.release.mock.calls).toEqual([['sandbox']]);
    expect(sp.clock.pause.mock.calls).toEqual([[false]]);
    expect(vm()?.online).toBe(true);
    expect(rig.slices.sandbox).toEqual(before);
    await rig.run(3);
    expect(sp.total()).toBe(4);
    sp.reset();
    sp.net.v = null;
    await rig.run(1);
    expect(sp.port.holdWeather.mock.calls).toEqual([['rain']]);
    expect(sp.port.setTimeScale.mock.calls).toEqual([[2]]);
    expect(sp.traffic.setBlackout.mock.calls).toEqual([[true, 'sandbox']]);
    expect(sp.traffic.setDensity.mock.calls).toEqual([['traffic', 0, 'sandbox']]);
    expect(sp.clock.pause.mock.calls).toEqual([[true]]);
    expect(vm()?.online).toBe(false);
    expect(rig.slices.sandbox).toEqual(before);
  });
});

describe('sandbox actions (AC-7)', () => {
  it('time.shortcut golden-hour sets 18.5 and holds golden', async () => {
    const { sp, rig, vm } = await sandboxRig();
    act(rig, 'time.shortcut', { id: 'golden-hour' });
    expect(sp.clock.setHour.mock.calls).toEqual([[18.5]]);
    expect(sp.port.holdWeather.mock.calls).toEqual([['golden']]);
    expect(rig.slices.sandbox.weather).toBe('golden');
    expect(vm()).toMatchObject({ weather: 'golden', hour: 18.5 });
    expect(vm()?.shortcuts).toEqual((CLOCK_CONFIG.sandboxShortcuts ?? []).map((s) => s.id));
  });

  it('time.sync is ignored with sync off and applies the hour with sync on, leaving the slice alone', async () => {
    const { sp, rig } = await sandboxRig();
    act(rig, 'time.sync', { hour: 7.5 });
    expect(sp.total()).toBe(0);
    set(rig, 'sandbox.time.sync', true);
    sp.reset();
    const before = structuredClone(rig.slices.sandbox);
    act(rig, 'time.sync', { hour: 7.5 });
    expect(sp.clock.setHour.mock.calls).toEqual([[7.5]]);
    expect(rig.slices.sandbox).toEqual(before);
    expect(rig.host.autosave).toBeDefined();
  });

  it('world.reset releases everything', async () => {
    const { sp, rig, vm } = await sandboxRig();
    set(rig, 'sandbox.weather.preset', 3);
    set(rig, 'sandbox.world.timeScale', 2);
    set(rig, 'sandbox.world.blackout', true);
    set(rig, 'sandbox.world.density.ped', 0);
    set(rig, 'sandbox.time.sync', true);
    sp.reset();
    act(rig, 'world.reset');
    expect(sp.port.holdWeather.mock.calls).toEqual([[null]]);
    expect(sp.port.setTimeScale.mock.calls).toEqual([[1]]);
    expect(sp.traffic.release.mock.calls).toEqual([['sandbox']]);
    expect(sp.clock.pause.mock.calls).toEqual([[false]]);
    expect(rig.slices.sandbox.clock).toMatchObject({ paused: false, syncSystemTime: false });
    expect(vm()).toMatchObject({ weather: null, timeScale: 1, blackout: false, paused: false, sync: false, density: { traffic: 1, ped: 1, parked: 1 } });
  });

  it('an unknown name and malformed arguments change nothing and throw nothing', async () => {
    const { sp, rig } = await sandboxRig();
    const before = structuredClone(rig.slices.sandbox);
    expect(() => {
      act(rig, 'nope');
      act(rig, 'time.shortcut');
      act(rig, 'time.shortcut', { id: 7 });
      act(rig, 'time.shortcut', { id: 'does-not-exist' });
      act(rig, 'time.sync', { hour: 'x' });
      rig.dispatch({ t: 'mode.cmd', mode: 'sandbox', name: 'time.shortcut', args: { id: ['golden-hour'] } } as never);
    }).not.toThrow();
    expect(rig.slices.sandbox).toEqual(before);
    expect(sp.total()).toBe(0);
  });

  it('with a room session every action is refused with sandbox.refuse.online', async () => {
    const { sp, rig } = await sandboxRig();
    sp.net.v = FAKE_NET;
    for (const [name, args] of [['time.shortcut', { id: 'golden-hour' }], ['time.sync', { hour: 3 }], ['world.reset', undefined]] as const) {
      act(rig, name, args as never);
      rig.ui.flushTick();
      expect(rig.ui.takeOutbox()?.toasts.map((t) => t.text)).toEqual([SANDBOX_REFUSE_ONLINE]);
    }
    expect(sp.total()).toBe(0);
  });
});

describe('another mode running (AC-8)', () => {
  it('every path and every action leaves the sandbox slice and the spies alone', async () => {
    const sp = spies();
    const { rig } = build(sp);
    rig.dispatch({ t: 'mode.start', id: 'story' });
    await rig.run(4);
    expect(rig.host.stack.entries.some((e) => e.id === 'story' && e.state === 'Running')).toBe(true);
    const before = structuredClone(rig.slices.sandbox);
    sp.reset();
    const paths: [string, boolean | number][] = [
      ['sandbox.weather.preset', 3], ['sandbox.time.hour', 7.5], ['sandbox.time.paused', true], ['sandbox.time.sync', true],
      ['sandbox.world.timeScale', 2], ['sandbox.world.blackout', true], ['sandbox.world.density.traffic', 0],
    ];
    for (const [p, v] of paths) set(rig, p, v);
    act(rig, 'time.shortcut', { id: 'golden-hour' });
    act(rig, 'time.sync', { hour: 7.5 });
    act(rig, 'world.reset');
    await rig.run(2);
    expect(rig.slices.sandbox).toEqual(before);
    expect(sp.total()).toBe(0);
  });
});
