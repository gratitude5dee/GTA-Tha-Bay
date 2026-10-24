import type { EntityHandle, JsonValue, ModeContext, UiCommand } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import type { SandboxVehiclePort } from '../../src/sim/modes/sandbox-vehicle-port.ts';
import { makeRig, type Rig } from './fixture.ts';

const FAKE_NET: NonNullable<ModeContext['net']> = { slot: 1, peers: () => [] };
const SPOT = { x: 5, y: 1, z: -8, yaw: 0.5 };

interface Vm {
  catalog: { prefab: string; cls: string; nameKey: string }[];
  owned: { key: string; nameKey: string }[];
  cap: number;
  pending: string | null;
  online: boolean;
}

/** A recording port: handles are counters, `alive`/`inUse` are sets the test edits. */
function fakePort() {
  const calls: string[] = [];
  const spawned: { prefab: string; key: string; at: typeof SPOT; h: number }[] = [];
  const state = { spot: SPOT as typeof SPOT | null, driving: false, inUse: new Set<number>(), dead: new Set<number>(), retired: [] as number[] };
  let next = 1;
  const port: SandboxVehiclePort = {
    prepare: (p) => void calls.push(`prepare:${p}`),
    spot: () => {
      calls.push('spot');
      return state.spot;
    },
    spawn: (prefab, at, key) => {
      const h = next++;
      calls.push(`spawn:${key}`);
      spawned.push({ prefab, key, at, h });
      return h as EntityHandle;
    },
    seat: (h) => {
      calls.push(`seat:${h}`);
      return true;
    },
    inUse: (h) => state.inUse.has(h),
    alive: (h) => !state.dead.has(h),
    playerDriving: () => state.driving,
    retire: (h) => void state.retired.push(h),
  };
  return { port, calls, spawned, state };
}

type Fake = ReturnType<typeof fakePort>;

async function sandboxRig(opts: { assetsReady?: (refs: string[]) => boolean; net?: { v: ModeContext['net'] }; fake?: Fake; story?: boolean } = {}) {
  const fake = opts.fake ?? fakePort();
  const net = opts.net ?? { v: null };
  const rig = makeRig({ sandboxVehicles: fake.port, net: () => net.v, ...(opts.assetsReady ? { assetsReady: opts.assetsReady } : {}) });
  const toasts: { id: string; text: string }[] = [];
  let vm: Vm | undefined;
  const drain = (): void => {
    rig.ui.flushTick();
    const out = rig.ui.takeOutbox();
    toasts.push(...(out?.toasts ?? []));
    for (const p of out?.patches ?? []) if (p.k === 'mode.sandbox.vehicles') vm = p.v as unknown as Vm;
  };
  rig.dispatch({ t: 'mode.start', id: opts.story ? 'story' : 'sandbox' });
  await rig.run(4);
  drain();
  toasts.length = 0;
  return { rig, fake, net, toasts, drain, vm: () => vm };
}

type B = Awaited<ReturnType<typeof sandboxRig>>;

const spawn = (rig: Rig, prefab: unknown, seat: unknown): void =>
  rig.dispatch({ t: 'mode.cmd', mode: 'sandbox', name: 'vehicle.spawn', args: { prefab, seat } as Record<string, JsonValue> } as UiCommand);
const clear = (rig: Rig): void => rig.dispatch({ t: 'mode.cmd', mode: 'sandbox', name: 'vehicle.clear' } as UiCommand);
const settle = async (b: B, n = 2): Promise<void> => {
  await b.rig.run(n);
  b.drain();
};
/** Runs `n` ticks and drains the outbox after each, so no toast or patch is lost to the outbox limits. */
const steps = async (b: B, n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await settle(b, 1);
};
const texts = (b: B): string[] => b.toasts.map((t) => t.text);
const KESTREL = 'vehicle.kestrel-quill';

describe('sandbox vehicle.spawn (M04e3 AC-4)', () => {
  it('prepares, spawns once under veh:sbx0 at the spot, and seats the driver on the next tick', async () => {
    const b = await sandboxRig();
    spawn(b.rig, KESTREL, 'driver');
    await b.rig.run(1);
    expect(b.fake.calls.filter((c) => c.startsWith('spawn'))).toEqual(['spawn:veh:sbx0']);
    expect(b.fake.calls.indexOf(`prepare:${KESTREL}`)).toBeLessThan(b.fake.calls.indexOf('spawn:veh:sbx0'));
    expect(b.fake.spawned[0]).toMatchObject({ prefab: KESTREL, at: SPOT });
    await b.rig.run(1);
    b.drain();
    expect(b.fake.calls.filter((c) => c.startsWith('seat'))).toEqual(['seat:1']);
    expect(b.vm()?.owned.map((o) => o.key)).toEqual(['veh:sbx0']);
    expect(b.vm()?.cap).toBe(8);
    expect(b.vm()?.catalog).toHaveLength(12);
  });

  it('never seats for seat none', async () => {
    const b = await sandboxRig();
    spawn(b.rig, KESTREL, 'none');
    await settle(b, 4);
    expect(b.fake.spawned).toHaveLength(1);
    expect(b.fake.calls.some((c) => c.startsWith('seat'))).toBe(false);
  });

  it('ignores a police car and malformed arguments without a call or a toast', async () => {
    const b = await sandboxRig();
    spawn(b.rig, 'police.cruiser', 'none');
    spawn(b.rig, 'robotaxi.default', 'none');
    spawn(b.rig, KESTREL, 'passenger');
    spawn(b.rig, 7, 'none');
    b.rig.dispatch({ t: 'mode.cmd', mode: 'sandbox', name: 'vehicle.spawn' } as UiCommand);
    await settle(b);
    expect(b.fake.calls).toEqual([]);
    expect(b.toasts).toEqual([]);
  });

  it('refuses with noSpot when there is no clear road, and spawns nothing', async () => {
    const b = await sandboxRig();
    b.fake.state.spot = null;
    spawn(b.rig, KESTREL, 'none');
    await settle(b);
    expect(texts(b)).toEqual(['sandbox.refuse.noSpot']);
    expect(b.fake.spawned).toHaveLength(0);
  });

  it('refuses a driver seat while the player is already in a car', async () => {
    const b = await sandboxRig();
    b.fake.state.driving = true;
    spawn(b.rig, KESTREL, 'driver');
    await settle(b);
    expect(texts(b)).toEqual(['sandbox.refuse.onFoot']);
    expect(b.fake.spawned).toHaveLength(0);
    spawn(b.rig, KESTREL, 'none');
    await settle(b);
    expect(b.fake.spawned).toHaveLength(1);
  });

  it('waits for the model: one preparing toast, a spawn on the first tick after it is ready', async () => {
    const t = { n: 0, ready: false };
    const b = await sandboxRig({ assetsReady: (refs) => refs.length === 0 || t.ready });
    const start = b.rig.tick.n;
    spawn(b.rig, KESTREL, 'none');
    for (let i = 0; i < 40; i++) {
      if (b.rig.tick.n - start >= 30) t.ready = true;
      await settle(b, 1);
      if (!t.ready) expect(b.fake.spawned).toHaveLength(0);
    }
    expect(texts(b)).toEqual(['sandbox.status.preparing']);
    expect(b.fake.spawned).toHaveLength(1);
    expect(b.vm()?.pending).toBeNull();
  });

  it('gives up after 600 ticks with notReady and spawns nothing', async () => {
    const b = await sandboxRig({ assetsReady: (refs) => refs.length === 0 });
    spawn(b.rig, KESTREL, 'none');
    await steps(b, 30);
    expect(b.vm()?.pending).toBe(KESTREL);
    await steps(b, 620);
    expect(texts(b)).toEqual(['sandbox.status.preparing', 'sandbox.refuse.notReady']);
    expect(b.fake.spawned).toHaveLength(0);
    expect(b.vm()?.pending).toBeNull();
  });

  it('a missing port raises noSpot', async () => {
    const rig = makeRig({});
    rig.dispatch({ t: 'mode.start', id: 'sandbox' });
    await rig.run(4);
    rig.ui.takeOutbox();
    spawn(rig, KESTREL, 'none');
    await rig.run(2);
    expect(rig.ui.takeOutbox()?.toasts.map((t) => t.text)).toEqual(['sandbox.refuse.noSpot']);
  });
});

describe('sandbox car cap (M04e3 AC-5)', () => {
  it('uses veh:sbx0 to veh:sbx8 in order and tows the oldest car that is not in use', async () => {
    const b = await sandboxRig();
    for (let i = 0; i < 8; i++) {
      spawn(b.rig, KESTREL, i === 0 ? 'driver' : 'none');
      await b.rig.run(2);
    }
    b.drain();
    expect(b.vm()?.owned).toHaveLength(8);
    b.fake.state.inUse.add(1); // veh:sbx0 is the car the player drives
    b.toasts.length = 0;
    spawn(b.rig, KESTREL, 'none');
    await settle(b);
    expect(b.fake.spawned.map((s) => s.key)).toEqual(Array.from({ length: 9 }, (_, i) => `veh:sbx${i}`));
    expect(b.fake.state.retired).toEqual([2]);
    expect(texts(b)).toEqual(['sandbox.status.towed']);
    const keys = b.vm()?.owned.map((o) => o.key);
    expect(keys).toHaveLength(8);
    expect(keys).not.toContain('veh:sbx1');
    expect(keys).toContain('veh:sbx0');
  });

  it('drops a car that is gone before counting the cap, and vehicle.clear retires them all', async () => {
    const b = await sandboxRig();
    for (let i = 0; i < 8; i++) {
      spawn(b.rig, KESTREL, 'none');
      await b.rig.run(2);
    }
    b.fake.state.dead.add(3);
    b.toasts.length = 0;
    spawn(b.rig, KESTREL, 'none');
    await settle(b);
    expect(texts(b)).toEqual([]);
    expect(b.fake.state.retired).toEqual([]);
    expect(b.vm()?.owned).toHaveLength(8);
    clear(b.rig);
    await settle(b);
    expect(b.fake.state.retired.slice().sort((a, c) => a - c)).toEqual([1, 2, 4, 5, 6, 7, 8, 9]);
    expect(b.vm()?.owned).toEqual([]);
  });
});

describe('sandbox cars leave with the session (M04e3 AC-6)', () => {
  it('mode.quit retires every car and no slice changes', async () => {
    const b = await sandboxRig();
    const core = JSON.stringify(b.rig.slices.core);
    const sbx = JSON.stringify(b.rig.slices.sandbox);
    for (let i = 0; i < 3; i++) {
      spawn(b.rig, KESTREL, 'none');
      await b.rig.run(2);
    }
    clear(b.rig);
    await b.rig.run(2);
    spawn(b.rig, KESTREL, 'none');
    spawn(b.rig, 'vehicle.sedan', 'none');
    await b.rig.run(2);
    expect(b.fake.spawned.map((s) => s.key)).toEqual(['veh:sbx0', 'veh:sbx1', 'veh:sbx2', 'veh:sbx3', 'veh:sbx4']);
    b.fake.state.retired.length = 0;
    b.rig.dispatch({ t: 'mode.quit' } as UiCommand);
    await b.rig.run(4);
    expect(b.fake.state.retired.slice().sort((a, c) => a - c)).toEqual([4, 5]);
    expect(JSON.stringify(b.rig.slices.core)).toBe(core);
    expect(JSON.stringify(b.rig.slices.sandbox)).toBe(sbx);
  });

  it('a room session retires every car at the next tick and a later spawn is refused online', async () => {
    const b = await sandboxRig();
    for (let i = 0; i < 2; i++) {
      spawn(b.rig, KESTREL, 'none');
      await b.rig.run(2);
    }
    b.net.v = FAKE_NET;
    await b.rig.run(2);
    b.drain();
    expect(b.fake.state.retired.slice().sort((a, c) => a - c)).toEqual([1, 2]);
    expect(b.vm()?.owned).toEqual([]);
    b.toasts.length = 0;
    const before = b.fake.calls.length;
    spawn(b.rig, KESTREL, 'none');
    await settle(b);
    expect(texts(b)).toEqual(['sandbox.refuse.online']);
    expect(b.fake.calls.length).toBe(before);
  });

  it('under story, vehicle.spawn reaches no port call', async () => {
    const b = await sandboxRig({ story: true });
    spawn(b.rig, KESTREL, 'none');
    await settle(b);
    expect(b.fake.calls).toEqual([]);
  });
});
