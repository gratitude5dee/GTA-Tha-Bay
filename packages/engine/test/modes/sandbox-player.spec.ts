import type { EntityHandle, JsonValue, ModeContext, UiCommand } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { sandboxCatalog } from '../../src/sim/modes/builtin/sandbox-vehicles.ts';
import type { SandboxBodyPort, UprightResult } from '../../src/sim/modes/sandbox-body-port.ts';
import type { SandboxVehiclePort } from '../../src/sim/modes/sandbox-vehicle-port.ts';
import { noFlags, type SandboxFlags } from '../../src/sim/sandbox-flags.ts';
import { makeRig } from './fixture.ts';

const FAKE_NET: NonNullable<ModeContext['net']> = { slot: 1, peers: () => [] };
const SPOT = { x: 5, y: 1, z: -8, yaw: 0.5 };
const GOD = 'sandbox.player.godMode';
const JUMP = 'sandbox.player.superJump';
const NODENT = 'sandbox.vehicle.noDamage';

interface PlayerVm {
  godMode: boolean;
  superJump: boolean;
  carNoDamage: boolean;
  car: 'none' | 'near' | 'driving';
  online: boolean;
}

function fakeVehicles() {
  const retired: number[] = [];
  let next = 1;
  const port: SandboxVehiclePort = {
    prepare: () => undefined,
    spot: () => SPOT,
    spawn: () => next++ as unknown as EntityHandle,
    seat: () => true,
    inUse: () => false,
    alive: () => true,
    playerDriving: () => false,
    retire: (h) => void retired.push(h as number),
  };
  return { port, retired };
}

function fakeBody() {
  const calls: string[] = [];
  const state = { flags: noFlags(), target: null as EntityHandle | null, driving: false, upright: 'ok' as UprightResult, seen: [] as (readonly EntityHandle[])[] };
  const port: SandboxBodyPort = {
    target: (owned) => {
      state.seen.push([...owned]);
      return state.target !== null && owned.includes(state.target) ? state.target : null;
    },
    driving: () => state.driving,
    repair: (h) => void calls.push(`repair:${h}`),
    upright: (h) => {
      calls.push(`upright:${h}`);
      return state.upright;
    },
    restorePlayer: () => void calls.push('restore'),
    setFlags: (f: SandboxFlags) => {
      calls.push(`setFlags:${f.godMode ? 1 : 0}${f.superJump ? 1 : 0}${f.carNoDamage ? 1 : 0}`);
      state.flags = { ...f };
    },
    flags: () => ({ ...state.flags }),
  };
  return { port, calls, state };
}

async function setup(opts: { story?: boolean } = {}) {
  const veh = fakeVehicles();
  const body = fakeBody();
  const net: { v: ModeContext['net'] } = { v: null };
  const rig = makeRig({ sandboxVehicles: veh.port, sandboxBody: body.port, net: () => net.v });
  const toasts: string[] = [];
  let vm: PlayerVm | undefined;
  const drain = (): void => {
    rig.ui.flushTick();
    const out = rig.ui.takeOutbox();
    toasts.push(...(out?.toasts ?? []).map((t) => t.text));
    for (const p of out?.patches ?? []) if (p.k === 'mode.sandbox.player') vm = p.v as unknown as PlayerVm;
  };
  const settle = async (n = 2): Promise<void> => {
    for (let i = 0; i < n; i++) {
      await rig.run(1);
      drain();
    }
  };
  rig.dispatch({ t: 'mode.start', id: opts.story ? 'story' : 'sandbox' });
  await settle(4);
  toasts.length = 0;
  const set = (path: string, v: unknown): void => rig.dispatch({ t: 'sandbox.set', path, v } as UiCommand);
  const act = (name: string): void => rig.dispatch({ t: 'mode.cmd', mode: 'sandbox', name, args: {} as Record<string, JsonValue> } as UiCommand);
  const place = async (): Promise<void> => {
    const prefab = (sandboxCatalog()[0] as { prefab: string }).prefab;
    rig.dispatch({ t: 'mode.cmd', mode: 'sandbox', name: 'vehicle.spawn', args: { prefab, seat: 'none' } } as UiCommand);
    await settle(2);
  };
  return { rig, veh, body, net, toasts, drain, settle, set, act, place, vm: () => vm };
}

describe('sandbox player tools: toggles and actions (AC-5)', () => {
  it('each valid toggle calls setFlags with only its flag changed and writes nothing to the slice', async () => {
    const b = await setup();
    const slicesBefore = JSON.stringify(b.rig.slices.sandbox);
    b.set(GOD, true);
    expect(b.body.state.flags).toEqual({ godMode: true, superJump: false, carNoDamage: false });
    b.set(JUMP, true);
    expect(b.body.state.flags).toEqual({ godMode: true, superJump: true, carNoDamage: false });
    b.set(NODENT, true);
    expect(b.body.state.flags).toEqual({ godMode: true, superJump: true, carNoDamage: true });
    b.set(GOD, false);
    expect(b.body.state.flags).toEqual({ godMode: false, superJump: true, carNoDamage: true });
    await b.settle(1);
    expect(b.rig.slices.sandbox.toggles).toEqual({});
    expect(JSON.stringify(b.rig.slices.sandbox)).toBe(slicesBefore);
    expect(b.vm()).toMatchObject({ godMode: false, superJump: true, carNoDamage: true, online: false });
  });

  it('a numeric or other non-boolean value calls nothing', async () => {
    const b = await setup();
    const n = b.body.calls.length;
    for (const v of [1, 0, 'true', null, { a: 1 }]) b.set(GOD, v);
    b.set(JUMP, 3);
    b.set(NODENT, 1);
    expect(b.body.calls.length).toBe(n);
    expect(b.rig.slices.sandbox.toggles).toEqual({});
  });

  it('player.restore calls restorePlayer', async () => {
    const b = await setup();
    b.act('player.restore');
    expect(b.body.calls).toContain('restore');
  });

  it('with no target each car action raises needCar and calls nothing', async () => {
    const b = await setup();
    await b.place();
    b.body.state.target = null;
    for (const a of ['vehicle.repair', 'vehicle.upright', 'vehicle.dismiss']) {
      b.act(a);
      b.drain();
    }
    expect(b.toasts.filter((t) => t === 'sandbox.refuse.needCar')).toHaveLength(3);
    expect(b.body.calls.filter((c) => c.startsWith('repair') || c.startsWith('upright'))).toEqual([]);
    expect(b.veh.retired).toEqual([]);
  });

  it('repair and upright act on the port target; the refusals map to their keys', async () => {
    const b = await setup();
    await b.place();
    b.body.state.target = 1 as unknown as EntityHandle;
    b.act('vehicle.repair');
    b.act('vehicle.upright');
    expect(b.body.calls).toEqual(expect.arrayContaining(['repair:1', 'upright:1']));
    expect(b.toasts).toEqual([]);
    b.body.state.upright = 'moving';
    b.act('vehicle.upright');
    b.body.state.upright = 'noGround';
    b.act('vehicle.upright');
    b.drain();
    expect(b.toasts).toEqual(['sandbox.refuse.carMoving', 'sandbox.refuse.noGround']);
  });

  it('dismiss retires the target once and removes it from the owned list', async () => {
    const b = await setup();
    await b.place();
    await b.place();
    b.body.state.target = 2 as unknown as EntityHandle;
    let owned: { key: string }[] = [];
    const seeOwned = (): void => {
      b.rig.ui.flushTick();
      for (const p of b.rig.ui.takeOutbox()?.patches ?? []) if (p.k === 'mode.sandbox.vehicles') owned = (p.v as unknown as { owned: { key: string }[] }).owned;
    };
    b.act('vehicle.dismiss');
    seeOwned();
    expect(b.veh.retired).toEqual([2]);
    expect(owned.map((o) => o.key)).toEqual(['veh:sbx0']);
    // the same car is no longer owned: a second dismiss finds no target
    b.act('vehicle.dismiss');
    b.drain();
    expect(b.veh.retired).toEqual([2]);
    expect(b.toasts).toContain('sandbox.refuse.needCar');
  });

  it('the view model reflects the toggles and the car state', async () => {
    const b = await setup();
    await b.place();
    expect(b.vm()).toEqual({ godMode: false, superJump: false, carNoDamage: false, car: 'none', online: false });
    b.body.state.target = 1 as unknown as EntityHandle;
    await b.settle(1);
    expect(b.vm()?.car).toBe('near');
    b.body.state.driving = true;
    await b.settle(1);
    expect(b.vm()?.car).toBe('driving');
    b.set(NODENT, true);
    b.drain();
    expect(b.vm()).toEqual({ godMode: false, superJump: false, carNoDamage: true, car: 'driving', online: false });
  });
});

describe('sandbox player tools: lifecycle (AC-6)', () => {
  it('quitting and entering again leaves every flag off, and the slices and saves never see the paths', async () => {
    const b = await setup();
    const core = JSON.stringify(b.rig.slices.core);
    const sandbox = JSON.stringify(b.rig.slices.sandbox);
    b.set(GOD, true);
    b.set(JUMP, true);
    b.set(NODENT, true);
    await b.settle(2);
    expect(b.body.state.flags).toEqual({ godMode: true, superJump: true, carNoDamage: true });
    b.rig.dispatch({ t: 'mode.quit' } as UiCommand);
    await b.settle(4);
    expect(b.body.port.flags()).toEqual(noFlags());
    b.rig.dispatch({ t: 'mode.start', id: 'sandbox' });
    await b.settle(4);
    expect(b.body.port.flags()).toEqual(noFlags());
    expect(b.vm()).toMatchObject({ godMode: false, superJump: false, carNoDamage: false });
    expect(JSON.stringify(b.rig.slices.core)).toBe(core);
    expect(JSON.stringify(b.rig.slices.sandbox)).toBe(sandbox);
    for (const p of b.rig.posted) {
      const text = JSON.stringify(p.data);
      expect(text).not.toContain('godMode');
      expect(text).not.toContain('superJump');
      expect(text).not.toContain('noDamage');
    }
  });

  it('joining a room clears the flags at the next tick and every action is refused as online', async () => {
    const b = await setup();
    await b.place();
    b.set(GOD, true);
    b.set(JUMP, true);
    b.set(NODENT, true);
    await b.settle(1);
    b.body.state.target = 1 as unknown as EntityHandle;
    b.net.v = FAKE_NET;
    await b.settle(2);
    expect(b.body.port.flags()).toEqual(noFlags());
    expect(b.vm()).toMatchObject({ godMode: false, superJump: false, carNoDamage: false, car: 'none', online: true });
    b.toasts.length = 0;
    const n = b.body.calls.length;
    b.set(GOD, true);
    b.set(NODENT, true);
    for (const a of ['player.restore', 'vehicle.repair', 'vehicle.upright', 'vehicle.dismiss']) b.act(a);
    b.drain();
    expect(b.toasts).toEqual(Array(6).fill('sandbox.refuse.online'));
    expect(b.body.calls.length).toBe(n);
    expect(b.body.port.flags()).toEqual(noFlags());
  });

  it('under story every path and action reaches no port call', async () => {
    const b = await setup({ story: true });
    const n = b.body.calls.length;
    b.set(GOD, true);
    b.set(JUMP, true);
    b.set(NODENT, true);
    for (const a of ['player.restore', 'vehicle.repair', 'vehicle.upright', 'vehicle.dismiss']) b.act(a);
    await b.settle(2);
    expect(b.body.calls.length).toBe(n);
    expect(b.body.state.seen).toEqual([]);
    expect(b.body.port.flags()).toEqual(noFlags());
  });

  it('a build without the port keeps the toggles off and refuses the car actions', async () => {
    const rig = makeRig({ sandboxVehicles: fakeVehicles().port });
    rig.dispatch({ t: 'mode.start', id: 'sandbox' });
    await rig.run(4);
    rig.ui.flushTick();
    rig.ui.takeOutbox();
    rig.dispatch({ t: 'sandbox.set', path: GOD, v: true } as UiCommand);
    rig.dispatch({ t: 'mode.cmd', mode: 'sandbox', name: 'vehicle.repair', args: {} } as UiCommand);
    await rig.run(1);
    rig.ui.flushTick();
    const out = rig.ui.takeOutbox();
    expect(out?.toasts.map((t) => t.text)).toEqual(['sandbox.refuse.needCar']);
    expect(rig.slices.sandbox.toggles).toEqual({});
  });
});
