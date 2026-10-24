import { RngStreams, type EntityHandle, type SimEvent } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { Health, Prop, Transform } from '../src/sim/ecs/components.ts';
import { EcsWorld } from '../src/sim/ecs/world.ts';
import { ModeEventBus } from '../src/sim/modes/host.ts';
import { SimSchedulerImpl } from '../src/sim/script/scheduler.ts';
import { decodeDvtl } from '../src/sim/script/dvtl.ts';
import { TimelineRecorderImpl } from '../src/sim/script/timeline.ts';
import { ZoneServiceImpl } from '../src/sim/script/zones.ts';

function world(): EcsWorld {
  const w = new EcsWorld();
  w.definePrefab({ id: 'thing', components: [{ def: Transform, init: { qw: 1 } }, { def: Health, init: { hp: 100, max: 100 } }, { def: Prop }] });
  return w;
}
function put(w: EcsWorld, x: number, y: number, z: number): EntityHandle {
  const h = w.commands.spawn('thing', { 'Transform.px': x, 'Transform.py': y, 'Transform.pz': z });
  w.flush();
  return h;
}
function moveTo(w: EcsWorld, h: EntityHandle, x: number, z: number): void {
  const tr = w.store(Transform);
  const id = w.resolve(h) as number;
  tr.px[id] = x;
  tr.pz[id] = z;
}

function scheduler(onError?: (id: string, e: unknown) => void): { s: SimSchedulerImpl; bus: ModeEventBus; sent: SimEvent[] } {
  const sent: SimEvent[] = [];
  const bus = new ModeEventBus((e) => sent.push(e));
  const s = new SimSchedulerImpl({ rng: new RngStreams(3), events: bus, ...(onError ? { onError } : {}) });
  return { s, bus, sent };
}

describe('SimScheduler', () => {
  it('runs threads in threadId order whatever the spawn order', () => {
    const { s } = scheduler();
    const order: string[] = [];
    for (const id of ['mis:b', 'mis:a', 'mis:c']) s.spawn(id, () => (order.push(id), { k: 'done' }));
    s.run(1);
    expect(order).toEqual(['mis:a', 'mis:b', 'mis:c']);
    expect(s.size).toBe(0);
  });

  it('waitTicks n resumes n ticks later, waitUntil re-checks every tick and honours its timeout', () => {
    const { s } = scheduler();
    const log: string[] = [];
    let flag = false;
    s.spawn('a', (() => {
      let phase = 0;
      return (t) => {
        log.push(`a${phase}@${t.tick}`);
        return phase++ === 0 ? { k: 'waitTicks', n: 3 } : { k: 'done' };
      };
    })());
    s.spawn('b', (() => {
      let phase = 0;
      return (t) => {
        log.push(`b${phase}@${t.tick}`);
        return phase++ === 0 ? { k: 'waitUntil', pred: () => flag } : { k: 'done' };
      };
    })());
    s.spawn('c', (() => {
      let phase = 0;
      return (t) => {
        log.push(`c${phase}@${t.tick}`);
        return phase++ === 0 ? { k: 'waitUntil', pred: () => false, timeoutTicks: 4 } : { k: 'done' };
      };
    })());
    for (let t = 1; t <= 8; t++) {
      if (t === 6) flag = true;
      s.run(t);
    }
    expect(log).toEqual(['a0@1', 'b0@1', 'c0@1', 'a1@4', 'c1@5', 'b1@6']);
  });

  it('a waitEvent thread resumes on the tick after its event; other events leave it asleep', () => {
    const { s, bus } = scheduler();
    const log: number[] = [];
    s.spawn('e', (() => {
      let first = true;
      return (t) => {
        log.push(t.tick);
        if (first) {
          first = false;
          return { k: 'waitEvent', t: 'go' };
        }
        return { k: 'done' };
      };
    })());
    s.run(1);
    bus.emit({ t: 'other', tick: 1 });
    s.run(2);
    bus.emit({ t: 'go', tick: 2 });
    s.run(3);
    expect(log).toEqual([1, 3]);
  });

  it('a killed thread never runs again, even later in the same tick; a thread spawned during a run starts next tick', () => {
    const { s } = scheduler();
    const ran: string[] = [];
    s.spawn('a', () => {
      ran.push('a');
      s.kill('b');
      s.spawn('z', () => (ran.push('z'), { k: 'done' }));
      return { k: 'done' };
    });
    s.spawn('b', () => (ran.push('b'), { k: 'done' }));
    s.run(1);
    expect(ran).toEqual(['a']);
    s.run(2);
    expect(ran).toEqual(['a', 'z']);
  });

  it('a step that spends the budget resumes next tick; one that throws is reported and removed', () => {
    const errors: string[] = [];
    const { s } = scheduler((id, e) => errors.push(`${id}:${(e as Error).message}`));
    s.spawn('busy', (t) => {
      t.ops += s.opsBudgetPerTick;
      return { k: 'continue' };
    });
    s.spawn('boom', () => {
      throw new Error('bad');
    });
    s.run(1);
    expect(s.info('busy')?.wait).toBe('budget');
    expect(s.info('busy')?.opsLastStep).toBe(2000);
    expect(s.has('boom')).toBe(false);
    expect(errors).toEqual(['boom:bad']);
    s.run(2);
    expect(s.info('busy')?.steps).toBe(2);
  });

  it('refuses a duplicate thread id; the hashed resource describes the live threads', () => {
    const { s } = scheduler();
    s.spawn('x', () => ({ k: 'waitTicks', n: 5 }));
    expect(() => s.spawn('x', () => ({ k: 'done' }))).toThrow();
    expect(s.resource().name).toBe('script');
  });
});

describe('ZoneService', () => {
  it('inside tests a circle as a cylinder, a polygon with its y range, and answers false for stale handles', () => {
    const w = world();
    const z = new ZoneServiceImpl({ ecs: w, tick: () => 0 });
    z.define('c', { k: 'circle', at: [10, 0, 10], r: 5 });
    z.define('p', { k: 'poly', ring: [[0, 0], [10, 0], [10, 10], [0, 10]], yMin: -1, yMax: 3 });
    const inC = put(w, 12, 0, 12);
    const outC = put(w, 20, 0, 20);
    const high = put(w, 10, 60, 10);
    const inP = put(w, 5, 1, 5);
    expect(z.inside('c', inC)).toBe(true);
    expect(z.inside('c', outC)).toBe(false);
    expect(z.inside('c', high)).toBe(false);
    expect(z.inside('p', inP)).toBe(true);
    expect(z.inside('p', put(w, 5, 9, 5))).toBe(false);
    expect(z.inside('none', inC)).toBe(false);
    w.commands.despawn(inC);
    w.flush();
    expect(z.inside('c', inC)).toBe(false);
  });

  it('query returns the handles in ascending order, across the cells the shape touches', () => {
    const w = world();
    let tick = 0;
    const z = new ZoneServiceImpl({ ecs: w, tick: () => tick });
    z.define('big', { k: 'circle', at: [0, 0, 0], r: 250 });
    const hs = [put(w, 190, 0, 0), put(w, -190, 0, 40), put(w, 0, 0, -240), put(w, 400, 0, 0)];
    const got = z.query('big');
    expect(got).toEqual([hs[0], hs[1], hs[2]].sort((a, b) => (a as number) - (b as number)));
    tick++;
    moveTo(w, hs[3] as EntityHandle, 10, 10);
    expect(z.query('big')).toContain(hs[3]);
    expect(z.query('big', [Prop])).toHaveLength(4);
    expect(z.query('big', [Health, Prop])).toHaveLength(4);
  });

  it('enter and exit watchers fire from update, exits before enters, ascending handles; the first update only records', () => {
    const w = world();
    const z = new ZoneServiceImpl({ ecs: w, tick: () => 0 });
    z.define('a', { k: 'circle', at: [0, 0, 0], r: 10 });
    const h1 = put(w, 50, 0, 0);
    const h2 = put(w, 60, 0, 0);
    const inside = put(w, 1, 0, 1);
    const log: string[] = [];
    z.onEnter('a', [], (h) => log.push(`in${h === h1 ? 1 : h === h2 ? 2 : 'x'}`));
    z.onExit('a', [], (h) => log.push(`out${h === inside ? 'I' : 'x'}`));
    z.update(1);
    expect(log).toEqual([]);
    moveTo(w, h2, 0, 0);
    moveTo(w, h1, 2, 2);
    moveTo(w, inside, 90, 90);
    z.update(2);
    expect(log).toEqual(['outI', 'in1', 'in2']);
    const off = z.onEnter('a', [], () => log.push('never'));
    off();
    moveTo(w, inside, 0, 0);
    z.update(3);
    expect(log).not.toContain('never');
  });

  it('an edges zone asks the probe: the edge or its twin within half the width', () => {
    const w = world();
    const z = new ZoneServiceImpl({ ecs: w, tick: () => 0, edgeProbe: (x) => (x < 100 ? { edge: 7, twin: 3, distM: 2 } : null) });
    z.define('r', { k: 'edges', edgeIds: [3, 4], widthM: 12 });
    expect(z.inside('r', put(w, 50, 0, 0))).toBe(true);
    expect(z.inside('r', put(w, 150, 0, 0))).toBe(false);
    z.define('r2', { k: 'edges', edgeIds: [9], widthM: 12 });
    expect(z.inside('r2', put(w, 50, 0, 0))).toBe(false);
  });
});

describe('TimelineRecorder', () => {
  it('keeps events and externals in order, samples tracked entities every 2 ticks, exports a .dvtl file', () => {
    const w = world();
    const t = new TimelineRecorderImpl({ ecs: w, tick: () => 0, cap: 3 });
    const h = put(w, 1, 2, 3);
    t.track(h, 'player');
    for (let tick = 0; tick < 6; tick++) {
      moveTo(w, h, tick, 0);
      t.update(tick);
    }
    expect(t.tracks().get('player')?.map((s) => s[0])).toEqual([0, 2, 4]);
    for (let i = 0; i < 5; i++) t.emit({ t: 'mis.stage', tick: i, data: { i } });
    expect(t.events().map((e) => e.tick)).toEqual([2, 3, 4]);
    expect(t.events(4)).toHaveLength(1);
    t.external({ src: 'talk', tick: 9, data: { outcome: 'a' } });
    const parsed = decodeDvtl(t.export());
    expect(parsed.version).toBe(1);
    expect(parsed.external).toHaveLength(1);
    expect(parsed.events.map((e) => e.tick)).toEqual([2, 3, 4]);
    expect(parsed.tracks.map((x) => x.name)).toEqual(['player']);
    t.untrack(h);
    t.update(6);
    expect(t.tracks().get('player')).toHaveLength(3);
  });
});
