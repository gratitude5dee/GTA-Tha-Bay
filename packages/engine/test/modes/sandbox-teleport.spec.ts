import type { JsonValue, ModeContext, SandboxSlice, TeleportResult, UiCommand } from '@dv/shared';
import { describe, expect, it, vi } from 'vitest';
import { TELEPORT_MSG } from '../../../world/src/sim/api/teleport.ts';
import { PATCH_LIMITS } from '../../src/sim/ui/coalesce.ts';
import { validateSchema, type JsonSchema } from '../../src/sim/save/validate.ts';
import sandboxSchema from '../../src/sim/save/schema/sandbox.v1.schema.json';
import { makeRig, type Rig } from './fixture.ts';

const FAKE_NET: NonNullable<ModeContext['net']> = { slot: 1, peers: () => [] };
const POSE = { x: 11.4, y: 3, z: -22.6, yaw: 0.5 };
const OK: TeleportResult = { ok: true, x: 0, y: 0, z: 0, yaw: 0 };
const LANDMARKS = ['lm.coit-tower', 'lm.city-hall'].map((id) => ({ id, nameKey: `place.${id.slice(3)}`, x: 1, z: 2 }));

interface Vm {
  positions: { name: string; x: number; z: number }[];
  previous: boolean;
}

function build(opts: { pose?: () => typeof POSE | null; result?: () => TeleportResult } = {}) {
  const request = vi.fn((_k: string, _to: unknown) => Promise.resolve((opts.result ?? (() => OK))()));
  const candidates = vi.fn((_k: string) => LANDMARKS);
  const map = { setWaypoint: vi.fn(), setRoute: vi.fn(), clearWaypoint: vi.fn() };
  const teleport = vi.fn(() => true);
  const net: { v: ModeContext['net'] } = { v: null };
  const pose = { v: opts.pose ?? ((): typeof POSE | null => POSE) };
  const rig = makeRig({ world: () => ({ teleport: { request, candidates }, map }) as never, playerPose: () => pose.v(), net: () => net.v, teleport });
  const toasts: { id: string; kind: string; text: string; params?: Record<string, string | number> }[] = [];
  let vm: Vm | undefined;
  const drain = (): void => {
    rig.ui.flushTick();
    const out = rig.ui.takeOutbox();
    toasts.push(...(out?.toasts ?? []));
    for (const p of out?.patches ?? []) if (p.k === 'mode.sandbox.teleport') vm = p.v as unknown as Vm;
  };
  return { rig, request, candidates, map, teleport, net, pose, toasts, drain, vm: () => vm };
}

type B = ReturnType<typeof build>;

const act = (rig: Rig, name: string, args?: Record<string, JsonValue>): void =>
  rig.dispatch({ t: 'mode.cmd', mode: 'sandbox', name, ...(args ? { args } : {}) } as UiCommand);
const settle = async (b: B): Promise<void> => {
  await b.rig.run(2);
  b.drain();
};
const texts = (b: B): string[] => b.toasts.map((t) => t.text);

async function sandboxRig(opts: Parameters<typeof build>[0] = {}): Promise<B> {
  const b = build(opts);
  b.rig.dispatch({ t: 'mode.start', id: 'sandbox' });
  await b.rig.run(4);
  expect(b.rig.host.stack.entries.some((e) => e.id === 'sandbox' && e.state === 'Running')).toBe(true);
  b.drain();
  b.toasts.length = 0;
  return b;
}

describe('sandbox teleport.landmark (AC-2)', () => {
  it('requests the landmark once, toasts the wait and remembers the previous pose on success', async () => {
    const b = await sandboxRig();
    expect(b.vm()?.previous).toBe(false);
    act(b.rig, 'teleport.landmark', { id: 'lm.coit-tower' });
    await settle(b);
    expect(b.request.mock.calls).toEqual([['sandbox', { landmark: 'lm.coit-tower' }]]);
    expect(texts(b)).toEqual(['sandbox.teleport.wait']);
    expect(b.vm()?.previous).toBe(true);
  });

  it('toasts the messageKey of a failed result once and changes nothing else', async () => {
    const result: TeleportResult = { ok: false, reason: 'not-loaded', messageKey: TELEPORT_MSG.notLoaded };
    const b = await sandboxRig({ result: () => result });
    const before = structuredClone(b.rig.slices.sandbox);
    act(b.rig, 'teleport.landmark', { id: 'lm.coit-tower' });
    await settle(b);
    const warnings = b.toasts.filter((t) => t.kind === 'warning');
    expect(warnings.map((t) => t.text)).toEqual([TELEPORT_MSG.notLoaded]);
    expect(b.vm()?.previous).toBe(false);
    expect(b.rig.slices.sandbox).toEqual(before);
  });

  it('refuses an unknown id without a request', async () => {
    const b = await sandboxRig();
    for (const id of ['lm.nowhere', 'city-hall', 'LM.x', 7 as never]) act(b.rig, 'teleport.landmark', { id });
    act(b.rig, 'teleport.landmark');
    await settle(b);
    expect(b.request).not.toHaveBeenCalled();
    expect(texts(b)).toEqual(Array(5).fill('world.teleport.unknownTarget'));
  });

  it('is refused online and never requests', async () => {
    const b = await sandboxRig();
    b.net.v = FAKE_NET;
    for (const [name, args] of [['teleport.landmark', { id: 'lm.coit-tower' }], ['teleport.waypoint', {}], ['teleport.back', {}], ['position.save', {}], ['position.delete', { name: 'pos-1' }]] as const) {
      act(b.rig, name, args);
    }
    b.rig.dispatch({ t: 'sandbox.teleport', name: 'pos-1' });
    await settle(b);
    expect(texts(b)).toEqual(Array(6).fill('sandbox.refuse.online'));
    expect(b.request).not.toHaveBeenCalled();
    expect(b.rig.slices.sandbox.savedPositions).toEqual([]);
  });
});

describe('sandbox.teleport and map.travel reroute (AC-3)', () => {
  it('sends the saved spot through request and never calls CommandDeps.teleport', async () => {
    const b = await sandboxRig();
    b.rig.slices.sandbox.savedPositions.push({ name: 'pos-1', x: 5, y: 9, z: -6, yaw: 1.5 });
    b.rig.dispatch({ t: 'sandbox.teleport', name: 'pos-1' });
    await settle(b);
    expect(b.request.mock.calls).toEqual([['sandbox', { x: 5, z: -6, yaw: 1.5 }]]);
    expect(b.teleport).not.toHaveBeenCalled();
    expect(b.vm()?.previous).toBe(true);
  });

  it('toasts the messageKey of a heat refusal and a missing name', async () => {
    const result: TeleportResult = { ok: false, reason: 'heat', messageKey: 'world.teleport.heat' };
    const b = await sandboxRig({ result: () => result });
    b.rig.slices.sandbox.savedPositions.push({ name: 'pos-1', x: 5, y: 9, z: -6, yaw: 1.5 });
    b.rig.dispatch({ t: 'sandbox.teleport', name: 'pos-1' });
    await settle(b);
    expect(b.toasts.filter((t) => t.kind === 'warning').map((t) => t.text)).toEqual(['world.teleport.heat']);
    b.toasts.length = 0;
    b.request.mockClear();
    b.rig.dispatch({ t: 'sandbox.teleport', name: 'pos-9' });
    await settle(b);
    expect(texts(b)).toEqual(['sandbox.position.missing']);
    expect(b.request).not.toHaveBeenCalled();
  });

  it('map.travel reaches request and sets previous on success', async () => {
    const b = await sandboxRig();
    b.rig.dispatch({ t: 'mode.cmd', mode: 'phone' as never, name: 'map.travel', args: { x: 10, z: -20 } } as UiCommand);
    await settle(b);
    expect(b.request.mock.calls).toEqual([['sandbox', { x: 10, z: -20 }]]);
    expect(b.vm()?.previous).toBe(true);
  });
});

describe('sandbox spots (AC-4)', () => {
  it('numbers the spots 1 to 32, reuses a freed number, saves once per change and passes the schema', async () => {
    const b = await sandboxRig();
    for (let i = 0; i < 33; i++) act(b.rig, 'position.save');
    await settle(b);
    const names = b.rig.slices.sandbox.savedPositions.map((p) => p.name);
    expect(names).toEqual(Array.from({ length: 32 }, (_, i) => `pos-${i + 1}`));
    expect(b.rig.slices.sandbox.savedPositions.every((p) => p.x === POSE.x && p.y === POSE.y && p.z === POSE.z && p.yaw === POSE.yaw)).toBe(true);
    const full = b.toasts.filter((t) => t.text === 'sandbox.position.full');
    expect(full.length).toBe(1);
    expect(full[0]?.params).toEqual({ max: 32 });
    const manual = (): number => b.rig.posted.filter((p) => p.reason === 'manual').length;
    expect(manual()).toBe(32);
    act(b.rig, 'position.delete', { name: 'pos-5' });
    act(b.rig, 'position.delete', { name: 'pos-404' });
    act(b.rig, 'position.save');
    await settle(b);
    expect(manual()).toBe(34);
    const after = b.rig.slices.sandbox.savedPositions.map((p) => p.name);
    expect(after.length).toBe(32);
    expect(after[31]).toBe('pos-5');
    expect(texts(b)).toContain('sandbox.position.forgot');
    const last = [...b.rig.posted].reverse().find((p) => p.slot === 'sandbox');
    expect(validateSchema(sandboxSchema as unknown as JsonSchema, last?.data)).toBeNull();
    const saved = (last?.data as SandboxSlice).savedPositions;
    expect(saved.length).toBe(32);
    // a new rig started from the saved record publishes the same 32 positions
    const b2 = build();
    b2.rig.slices.sandbox = structuredClone(last?.data) as SandboxSlice;
    b2.rig.dispatch({ t: 'mode.start', id: 'sandbox' });
    await b2.rig.run(4);
    b2.drain();
    expect(b2.vm()?.positions.map((p) => p.name)).toEqual(saved.map((p) => p.name));
    expect(b2.vm()?.positions[0]).toEqual({ name: saved[0]?.name, x: 11, z: -23 });
  });

  it('toasts noPlayer and writes nothing when there is no player', async () => {
    const b = await sandboxRig({ pose: () => null });
    act(b.rig, 'position.save');
    await settle(b);
    expect(texts(b)).toEqual(['sandbox.position.noPlayer']);
    expect(b.rig.slices.sandbox.savedPositions).toEqual([]);
    expect(b.rig.posted.some((p) => p.reason === 'manual')).toBe(false);
  });

  it('keeps the worst-case view model inside one tick of patch bytes', async () => {
    const b = build();
    b.rig.slices.sandbox.savedPositions = Array.from({ length: 32 }, (_, i) => ({ name: `${i}`.padStart(2, '0') + 'n'.repeat(78), x: -12345.6, y: 0, z: -12345.6, yaw: 0 }));
    b.rig.dispatch({ t: 'mode.start', id: 'sandbox' });
    await b.rig.run(4);
    b.drain();
    const v = b.vm();
    expect(v?.positions.length).toBe(32);
    const bytes = new TextEncoder().encode('mode.sandbox.teleport' + JSON.stringify(v)).length;
    expect(bytes).toBeLessThanOrEqual(PATCH_LIMITS.bytesPerTick);
    expect(b.rig.ui.oversized).toBe(0);
  });
});

describe('sandbox waypoint and back (AC-5)', () => {
  it('follows the map pin', async () => {
    const b = await sandboxRig();
    act(b.rig, 'teleport.waypoint');
    await settle(b);
    expect(texts(b)).toEqual(['sandbox.teleport.noWaypoint']);
    expect(b.request).not.toHaveBeenCalled();
    b.rig.dispatch({ t: 'mode.cmd', mode: 'phone' as never, name: 'map.waypoint.clear' } as UiCommand);
    b.rig.dispatch({ t: 'phone.waypoint', x: 120, z: -340 } as UiCommand);
    act(b.rig, 'teleport.waypoint');
    await settle(b);
    expect(b.request.mock.calls).toEqual([['sandbox', { x: 120, z: -340 }]]);
    expect(b.map.setWaypoint).toHaveBeenCalledWith(120, -340);
    b.rig.dispatch({ t: 'mode.cmd', mode: 'phone' as never, name: 'map.waypoint.clear' } as UiCommand);
    b.toasts.length = 0;
    b.request.mockClear();
    act(b.rig, 'teleport.waypoint');
    await settle(b);
    expect(texts(b)).toEqual(['sandbox.teleport.noWaypoint']);
    expect(b.request).not.toHaveBeenCalled();
  });

  it('goes back to the pose read before the last successful jump, and not across a restart', async () => {
    const b = await sandboxRig();
    act(b.rig, 'teleport.back');
    await settle(b);
    expect(texts(b)).toEqual(['sandbox.teleport.noPrevious']);
    expect(b.request).not.toHaveBeenCalled();
    act(b.rig, 'teleport.landmark', { id: 'lm.city-hall' });
    await settle(b);
    b.request.mockClear();
    // the player now stands elsewhere; back returns to the pose read before the jump
    b.pose.v = () => ({ x: 900, y: 0, z: 900, yaw: 2 });
    act(b.rig, 'teleport.back');
    await settle(b);
    expect(b.request.mock.calls).toEqual([['sandbox', { x: POSE.x, z: POSE.z, yaw: POSE.yaw }]]);
    // a successful jump back makes the spot it left the new previous pose
    b.request.mockClear();
    act(b.rig, 'teleport.back');
    await settle(b);
    expect(b.request.mock.calls).toEqual([['sandbox', { x: 900, z: 900, yaw: 2 }]]);
    b.rig.dispatch({ t: 'mode.quit' });
    await b.rig.run(4);
    b.rig.dispatch({ t: 'mode.start', id: 'sandbox' });
    await b.rig.run(4);
    b.drain();
    expect(b.vm()?.previous).toBe(false);
  });
});

describe('other modes are untouched (AC-6)', () => {
  it('ignores every new action while story runs', async () => {
    const b = build();
    b.rig.dispatch({ t: 'mode.start', id: 'story' });
    await b.rig.run(4);
    expect(b.rig.host.stack.entries.some((e) => e.id === 'story' && e.state === 'Running')).toBe(true);
    b.rig.slices.sandbox.savedPositions.push({ name: 'pos-1', x: 1, y: 2, z: 3, yaw: 0 });
    const sandbox = structuredClone(b.rig.slices.sandbox);
    const story = structuredClone(b.rig.slices.story);
    const posted = b.rig.posted.length;
    for (const [name, args] of [['teleport.landmark', { id: 'lm.coit-tower' }], ['teleport.waypoint', {}], ['teleport.back', {}], ['position.save', {}], ['position.delete', { name: 'pos-1' }]] as const) {
      act(b.rig, name, args);
    }
    b.rig.dispatch({ t: 'sandbox.teleport', name: 'pos-1' });
    b.rig.dispatch({ t: 'sandbox.set', path: 'sandbox.display.hideHud', v: true });
    b.rig.dispatch({ t: 'sandbox.set', path: 'sandbox.display.hideMinimap', v: true });
    await settle(b);
    expect(b.rig.slices.sandbox).toEqual(sandbox);
    expect(b.rig.slices.story).toEqual(story);
    expect(b.request).not.toHaveBeenCalled();
    expect(b.rig.posted.length).toBe(posted);
  });
});
