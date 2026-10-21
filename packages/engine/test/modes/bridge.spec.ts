import type { JsonValue, VmKey } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { UiCommandSender } from '../../src/client/ui/command-sender.ts';
import { ViewModelStore } from '../../src/client/ui/view-model-source.ts';
import { isUiCommand } from '../../src/sim/transport/envelope.ts';
import { PATCH_LIMITS } from '../../src/sim/ui/coalesce.ts';
import { SimUiBridge } from '../../src/sim/ui/bridge.ts';
import { boundaryToast } from '../../src/sim/modes/index.ts';
import { makeRig } from './fixture.ts';

/** AC-7: `engine/ui.bridge`. */
describe('UiBridge coalescing and the ViewModelSource', () => {
  it('lets at most 64 patches and 4 KiB leave a tick, keeps the rest in order, and every final value arrives with rising rev', () => {
    const bridge = new SimUiBridge();
    const vm = new ViewModelStore();
    const seen: { k: string; rev: number }[] = [];
    vm.subscribe('hud.*', (_v, k) => void seen.push({ k, rev: vm.rev }));
    const v = (i: number): JsonValue => `${String(i).padStart(3, '0')}${'x'.repeat(94)}`;   // a 100-character string: about 102 bytes of JSON
    for (let i = 0; i < 100; i++) bridge.patch(`hud.k${String(i).padStart(3, '0')}` as VmKey, v(i));
    const sizes: number[] = [];
    const bytes: number[] = [];
    let ticks = 0;
    while (bridge.backlog > 0 && ticks < 20) {
      bridge.flushTick();
      const out = bridge.takeOutbox();
      sizes.push(out?.patches.length ?? 0);
      bytes.push((out?.patches ?? []).reduce((n, p) => n + p.k.length + JSON.stringify(p.v).length, 0));
      vm.apply(out?.patches ?? []);
      ticks++;
    }
    expect(Math.max(...sizes)).toBeLessThanOrEqual(PATCH_LIMITS.perTick);
    expect(Math.max(...bytes)).toBeLessThanOrEqual(PATCH_LIMITS.bytesPerTick);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(100);
    expect(ticks).toBeGreaterThan(1);
    expect(seen.map((s) => s.k)).toEqual(Array.from({ length: 100 }, (_, i) => `hud.k${String(i).padStart(3, '0')}`));   // in order
    expect(seen.map((s) => s.rev)).toEqual([...seen.map((s) => s.rev)].sort((a, b) => a - b));
    expect(new Set(seen.map((s) => s.rev)).size).toBe(100);
    for (let i = 0; i < 100; i++) expect(vm.get<string>(`hud.k${String(i).padStart(3, '0')}` as VmKey)).toBe(v(i));
  });

  it('a patch for a key that is still waiting replaces the old value in place', () => {
    const bridge = new SimUiBridge();
    for (let i = 0; i < 70; i++) bridge.patch(`hud.n${String(i).padStart(2, '0')}` as VmKey, i);
    bridge.patch('hud.n69', 'last');
    bridge.flushTick();
    expect(bridge.takeOutbox()?.patches).toHaveLength(64);
    bridge.flushTick();
    const rest = bridge.takeOutbox()?.patches ?? [];
    expect(rest.map((p) => p.k)).toEqual(['hud.n64', 'hud.n65', 'hud.n66', 'hud.n67', 'hud.n68', 'hud.n69']);
    expect(rest.at(-1)?.v).toBe('last');
  });

  it('drops a single value larger than the byte limit and counts it', () => {
    const bridge = new SimUiBridge();
    bridge.patch('hud.big', 'x'.repeat(5000));
    bridge.flushTick();
    expect(bridge.takeOutbox()).toBeNull();
    expect(bridge.oversized).toBe(1);
  });

  it('subscribe supports exact keys, prefixes and null deletes; rev only rises; stale patches are ignored', () => {
    const vm = new ViewModelStore();
    const log: (JsonValue | undefined)[] = [];
    const off = vm.subscribe('hud.wallet', (v) => void log.push(v));
    vm.apply([{ k: 'hud.wallet', rev: 5, v: { cashCents: 1 } }, { k: 'hud.wallet', rev: 4, v: { cashCents: 0 } }]);
    expect(vm.get('hud.wallet')).toEqual({ cashCents: 1 });
    expect(vm.rev).toBe(5);
    vm.apply([{ k: 'hud.wallet', rev: 6, v: null }]);
    expect(vm.get('hud.wallet')).toBeUndefined();
    expect(log).toEqual([{ cashCents: 1 }, undefined]);
    off();
    vm.apply([{ k: 'hud.wallet', rev: 7, v: 1 }]);
    expect(log).toHaveLength(2);
  });

  it('mode.start and the other commands pass the worker-boundary guard; hostile shapes do not', () => {
    expect(isUiCommand({ t: 'mode.start', id: 'sandbox' })).toBe(true);
    expect(isUiCommand({ t: 'mode.start', id: 'exp:demo' })).toBe(true);
    expect(isUiCommand({ t: 'mode.start', id: '../x' })).toBe(false);
    expect(isUiCommand({ t: 'save.request', reason: 'nope' })).toBe(false);
    expect(isUiCommand({ t: 'sandbox.set', path: 'sandbox.a', v: true })).toBe(true);
    expect(isUiCommand({ t: 'unknown' })).toBe(false);
    const sent: unknown[] = [];
    const s = new UiCommandSender(() => ({ sendUi: (c) => (sent.push(c), true) }));
    expect(s.send({ t: 'mode.quit' })).toBe(true);
    expect(s.send({ t: 'mode.cmd', mode: 'story', name: 'x', args: { big: 'y'.repeat(600) } })).toBe(false);
    expect(new UiCommandSender(() => null).send({ t: 'mode.quit' })).toBe(false);
    expect(sent).toHaveLength(1);
    expect(s.rejected).toBe(1);
  });

  it('the county line event is one toast with the key world.boundary.countyLine (DL-681)', () => {
    const bridge = new SimUiBridge();
    expect(boundaryToast(bridge, { t: 'world.boundary', tick: 3, s: 'countyLine' })).toBe(true);
    expect(boundaryToast(bridge, { t: 'world.boundary', tick: 3, s: 'cityLimit' })).toBe(false);
    expect(boundaryToast(bridge, { t: 'world.chunk', tick: 3, s: 'countyLine' })).toBe(false);
    expect(bridge.takeOutbox()?.toasts.map((t) => t.text)).toEqual(['world.boundary.countyLine']);
  });

  it('commands: garage.call toasts garage.notYet and changes nothing', () => {
    const rig = makeRig();
    rig.dispatch({ t: 'garage.call', vehicleKey: 'veh:1' });
    rig.dispatch({ t: 'garage.favorite', vehicleKey: 'veh:1' });
    const out = rig.ui.takeOutbox();
    expect(out?.toasts.map((t) => t.text)).toEqual(['garage.notYet', 'garage.notYet']);
    expect(rig.slices.core.garage).toEqual([]);
  });
});
