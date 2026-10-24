import { readFileSync } from 'node:fs';
import type { ModeContext, SandboxSlice } from '@dv/shared';
import { describe, expect, it, vi } from 'vitest';
import { DISPLAY_NAME, SHORT_NAME } from '../../../../config/brand.ts';
import { NEVER_WANTED, SANDBOX_REFUSE_ONLINE, SET_HEAT, applyToggle, defaultSandbox, sandboxOnline, sandboxSim } from '../../src/sim/modes/builtin/sandbox.ts';
import { builtinDescriptors } from '../../src/sim/modes/index.ts';
import { makeRig } from './fixture.ts';

const FAKE_NET: NonNullable<ModeContext['net']> = { slot: 1, peers: () => [] };

/** M04e0: the sandbox tools refuse to run while a running mode's context has a room session (`ctx.net`). */
describe('sandbox rooms guard', () => {
  it('refuses the five sandbox commands online and changes nothing (AC-2)', async () => {
    const net: { v: ModeContext['net'] } = { v: null };
    const teleport = vi.fn(() => true);
    const world = vi.fn(() => ({}) as never);
    const rig = makeRig({ net: () => net.v, teleport, world });
    rig.slices.sandbox.savedPositions.push({ name: 'home', x: 1, y: 2, z: 3 } as never);
    rig.dispatch({ t: 'mode.start', id: 'sandbox' });
    await rig.run(4);
    expect(rig.host.stack.entries.some((e) => e.id === 'sandbox' && e.state === 'Running')).toBe(true);
    rig.ui.takeOutbox();
    const before = structuredClone(rig.slices.sandbox);
    const eventsBefore = rig.events.length;
    net.v = FAKE_NET;
    const cmds = [
      { t: 'sandbox.set', path: SET_HEAT, v: 3 },
      { t: 'sandbox.set', path: NEVER_WANTED, v: true },
      { t: 'sandbox.teleport', name: 'home' },
      { t: 'mode.cmd', mode: 'sandbox', name: 'any', args: {} },
      { t: 'mode.cmd', mode: 'phone', name: 'map.travel', args: { x: 0, z: 0 } },
    ] as const;
    for (const c of cmds) {
      rig.dispatch(c as never);
      rig.ui.flushTick();
      const out = rig.ui.takeOutbox();
      expect(out?.toasts.map((t) => t.text)).toEqual([SANDBOX_REFUSE_ONLINE]);
      expect(out?.patches ?? []).toEqual([]);
    }
    expect(rig.slices.sandbox).toEqual(before);
    expect(rig.events.length).toBe(eventsBefore);
    expect(rig.events.some((e) => e.t === 'mode.cmd')).toBe(false);
    expect(teleport).not.toHaveBeenCalled();
    expect(world).not.toHaveBeenCalled();
  });

  it('applyToggle and enter do nothing to the pursuit director online (AC-3)', () => {
    const pursuit = { setHeat: vi.fn(), capHeat: vi.fn(), clear: vi.fn() };
    const patch = vi.fn();
    const ctx = { net: FAKE_NET, pursuit, ui: { patch } } as unknown as ModeContext;
    expect(sandboxOnline(ctx)).toBe(true);
    const s: SandboxSlice = { ...defaultSandbox(), toggles: { [NEVER_WANTED]: true } };
    const toggles = structuredClone(s.toggles);
    expect(applyToggle(ctx, s, SET_HEAT, 3)).toBe(false);
    expect(applyToggle(ctx, s, NEVER_WANTED, false)).toBe(false);
    expect(s.toggles).toEqual(toggles);
    sandboxSim({ sandbox: () => s }).enter(ctx, null as never, null);
    expect(pursuit.setHeat).not.toHaveBeenCalled();
    expect(pursuit.capHeat).not.toHaveBeenCalled();
    expect(pursuit.clear).not.toHaveBeenCalled();
    // The toggles, then (M04e1) the world controls with `online: true`, so the phone greys them out.
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[0]?.[0]).toBe('mode.sandbox.toggles');
    expect(patch).toHaveBeenCalledWith('mode.sandbox.toggles', toggles);
    expect(patch.mock.calls[1]?.[0]).toBe('mode.sandbox.world');
    expect((patch.mock.calls[1]?.[1] as { online: boolean }).online).toBe(true);
  });

  it.each(['shipped', 'optional'] as const)('follows ctx.net live whatever the descriptor says (%s) (AC-4)', async (variant) => {
    const net: { v: ModeContext['net'] } = { v: null };
    const base = builtinDescriptors({ story: () => makeRig().slices.story, sandbox: () => defaultSandbox(), playerPose: () => null }).find((d) => d.id === 'sandbox');
    expect(base).toBeDefined();
    const descriptors = variant === 'shipped' || !base ? [] : [{ ...base, requires: { ...base.requires, network: 'optional' as const } }];
    const rig = makeRig({ net: () => net.v, descriptors });
    rig.dispatch({ t: 'mode.start', id: 'sandbox' });
    await rig.run(4);
    rig.ui.takeOutbox();
    rig.dispatch({ t: 'sandbox.set', path: SET_HEAT, v: 2 });
    rig.ui.flushTick();
    const first = rig.ui.takeOutbox();
    expect(rig.slices.sandbox.toggles[SET_HEAT]).toBe(2);
    expect(first?.toasts ?? []).toEqual([]);
    const entry = rig.host.stack.entries.find((e) => e.id === 'sandbox');
    expect(entry?.ctx.net).toBeNull();
    net.v = FAKE_NET;
    expect(entry?.ctx.net).toBe(FAKE_NET);
    rig.dispatch({ t: 'sandbox.set', path: SET_HEAT, v: 4 });
    rig.ui.flushTick();
    const second = rig.ui.takeOutbox();
    expect(second?.toasts.map((t) => t.text)).toEqual([SANDBOX_REFUSE_ONLINE]);
    expect(rig.slices.sandbox.toggles[SET_HEAT]).toBe(2);
  });

  it('keeps single player unchanged: no net port, ctx.net is null, sandbox.set works', async () => {
    const rig = makeRig();
    rig.dispatch({ t: 'mode.start', id: 'sandbox' });
    await rig.run(4);
    expect(rig.host.stack.entries.find((e) => e.id === 'sandbox')?.ctx.net).toBeNull();
    rig.dispatch({ t: 'sandbox.set', path: SET_HEAT, v: 1 });
    expect(rig.slices.sandbox.toggles[SET_HEAT]).toBe(1);
  });

  it('has an original English refusal text (AC-6)', () => {
    const en = JSON.parse(readFileSync(new URL('../../../../content/ui/i18n/en.json', import.meta.url), 'utf8')) as Record<string, string>;
    const text = en[SANDBOX_REFUSE_ONLINE];
    expect(typeof text).toBe('string');
    expect((text ?? '').length).toBeGreaterThan(0);
    expect(text).not.toContain(DISPLAY_NAME);
    expect(text).not.toContain(SHORT_NAME);
  });
});
