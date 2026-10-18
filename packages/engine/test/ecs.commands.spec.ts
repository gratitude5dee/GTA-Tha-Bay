import { describe, expect, it } from 'vitest';
import { SimStage, type EntityHandle } from '@dv/shared';
import {
  DuplicateKeyError, EcsWorld, Health, Key, LocalPlayer, Prop, Ragdoll, SimCore, Transform, UnknownInitKeyError,
  UnknownPrefabError, Velocity, createSimServices, idOfHandle,
} from '../src/sim/index.ts';
import { UNIT_PREFAB, testConfig } from './helpers.ts';

function newWorld(): EcsWorld {
  const w = new EcsWorld();
  w.definePrefab(UNIT_PREFAB);
  w.definePrefab({ id: 'prop', components: [{ def: Transform }, { def: Prop }] });
  return w;
}

describe('command buffer', () => {
  it('spawn, add, remove and despawn apply after the stage in issue order', () => {
    const w = newWorld();
    const log: string[] = [];
    const a = w.commands.spawn('unit', undefined, 'player:0');
    const b = w.commands.spawn('unit', undefined, 'npc:b');
    w.commands.add(a, Velocity, { vx: 3 });
    w.commands.add(a, Ragdoll, { untilTick: 9, impulse: 2 });
    w.commands.remove(a, Ragdoll);
    w.commands.despawn(b);
    // Nothing happens before the flush; the handles do not resolve yet.
    expect(w.resolve(a)).toBeNull();
    expect(w.query([Key]).length).toBe(0);
    expect(w.commands.pending).toBe(6);
    w.flush();
    log.push(`pending ${w.commands.pending}`);
    const id = w.resolve(a) as number;
    expect(id).not.toBeNull();
    expect(w.resolve(b)).toBeNull();
    expect(w.has(a, Velocity)).toBe(true);
    expect(w.store(Velocity).vx[id]).toBe(3);
    expect(w.has(a, Ragdoll)).toBe(false);
    expect(w.store(Ragdoll).untilTick[id]).toBe(0); // removal zeroes the row
    expect(w.store(Health).hp[id]).toBe(100); // prefab default
    expect(log).toEqual(['pending 0']);
    expect(w.byKey('npc:b')).toBe(0);
  });

  it('SimCore applies the buffer at the end of the issuing stage', () => {
    const w = newWorld();
    const core = new SimCore(testConfig(), w, createSimServices(1));
    let spawned: EntityHandle = 0 as EntityHandle;
    const seen: Record<string, boolean> = {};
    core.addSystem({
      id: 'a.issue', owner: 'S01', stage: SimStage.Control, order: 0,
      run: ({ ecs }) => {
        spawned = ecs.commands.spawn('unit', undefined, 'player:0');
        seen['sameStageBefore'] = ecs.resolve(spawned) !== null;
      },
    });
    core.addSystem({
      id: 'b.sameStage', owner: 'S01', stage: SimStage.Control, order: 1,
      run: ({ ecs }) => { seen['sameStageAfter'] = ecs.resolve(spawned) !== null; },
    });
    core.addSystem({
      id: 'c.nextStage', owner: 'S01', stage: SimStage.Script, order: 0,
      run: ({ ecs }) => { seen['nextStage'] = ecs.resolve(spawned) !== null; },
    });
    core.stepOnce();
    expect(seen).toEqual({ sameStageBefore: false, sameStageAfter: false, nextStage: true });
  });

  it('commands on a stale handle are dropped; despawn twice is harmless', () => {
    const w = newWorld();
    const a = w.commands.spawn('unit');
    w.flush();
    w.commands.despawn(a);
    w.commands.despawn(a);
    w.commands.add(a, Velocity, { vx: 1 });
    w.commands.remove(a, Velocity);
    expect(() => w.flush()).not.toThrow();
    expect(w.resolve(a)).toBeNull();
    expect(w.entityCount).toBe(0);
  });

  it('spawn init sets Component.field values, vector lanes with Component.field.lane', () => {
    const w = newWorld();
    const h = w.commands.spawn('unit', { 'Transform.px': 12.5, 'Transform.qw': 1, 'Health.hp': 40 });
    w.flush();
    const id = w.resolve(h) as number;
    expect(w.store(Transform).px[id]).toBe(12.5);
    expect(w.store(Transform).qw[id]).toBe(1);
    expect(w.store(Health).hp[id]).toBe(40);
    expect(w.store(Health).max[id]).toBe(100);
    expect(() => w.commands.spawn('unit', { 'Velocity.vx': 1 })).toThrow(UnknownInitKeyError);
    expect(() => w.commands.spawn('unit', { 'Transform.nope': 1 })).toThrow(UnknownInitKeyError);
    expect(() => w.commands.spawn('unit', { 'Transform.px.0': 1 })).toThrow(UnknownInitKeyError);
    expect(() => w.commands.spawn('nothing')).toThrow(UnknownPrefabError);
    expect(() => w.commands.spawn('unit', undefined, 'npc:x')).not.toThrow();
    expect(() => w.commands.spawn('unit', undefined, 'npc:x')).toThrow(DuplicateKeyError);
  });

  it('adding a component that is present only applies the init values', () => {
    const w = newWorld();
    const h = w.commands.spawn('unit');
    w.flush();
    const id = w.resolve(h) as number;
    w.commands.add(h, Health, { hp: 7 });
    w.flush();
    expect(w.store(Health).hp[id]).toBe(7);
    expect(w.store(Health).max[id]).toBe(100); // untouched
  });

  it('despawn clears the row so a reused id starts from zero', () => {
    const w = newWorld();
    const a = w.commands.spawn('unit', { 'Transform.px': 5 });
    w.commands.add(a, Velocity, { vx: 9, wz: 1 });
    w.flush();
    const id = idOfHandle(a);
    w.commands.despawn(a);
    w.flush();
    expect(w.store(Transform).px[id]).toBe(0);
    expect(w.store(Velocity).vx[id]).toBe(0);
    expect(w.store(Key).key[id]).toBe(0);
    const b = w.commands.spawn('unit');
    w.flush();
    expect(idOfHandle(b)).toBe(id);
    expect(w.has(b, Velocity)).toBe(false);
    expect(w.store(Transform).px[id]).toBe(0);
  });
});

describe('queries', () => {
  it('return ascending ids, support exclusion, and see only applied entities', () => {
    const w = newWorld();
    const hs: EntityHandle[] = [];
    for (let i = 0; i < 400; i++) hs.push(w.commands.spawn(i % 3 === 0 ? 'prop' : 'unit'));
    w.commands.add(hs[1] as EntityHandle, LocalPlayer);
    expect(w.query([Transform]).length).toBe(0); // not applied yet
    w.flush();
    // Churn so that bitECS's internal order is no longer ascending.
    for (let i = 0; i < 400; i += 7) w.commands.despawn(hs[i] as EntityHandle);
    for (let i = 0; i < 20; i++) w.commands.spawn('unit');
    w.flush();
    const all = w.query([Transform]);
    expect(all.length).toBe(400 - 58 + 20);
    expect(Array.from(all)).toEqual(Array.from(all).sort((x, y) => x - y));
    const props = w.query([Prop]);
    const notProps = w.query([Transform], [Prop]);
    expect(props.length + notProps.length).toBe(all.length);
    expect(Array.from(w.query([Transform], [Prop, LocalPlayer])).includes(idOfHandle(hs[1] as EntityHandle))).toBe(false);
    expect(Array.from(w.query([Health, Transform])).every((id) => !props.includes(id))).toBe(true);
    expect(() => w.query([])).toThrow();
  });
});
