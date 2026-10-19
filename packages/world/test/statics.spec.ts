/**
 * AC-4: headless Rapier with the world streaming module and a scripted 2 km walk across `synth` chunks. At most one chunk's statics
 * are added per tick, the capsule never falls below the heightfield, a rebase at 1,000 m keeps the state hash path identical across
 * two runs, also when the test channel delivers the `p0` replies out of order and late (they are applied at tick boundaries in
 * `seq` order, DL-678). Needs the `synth` bake (`pnpm map:build -- --area synth`).
 */
import { readFileSync } from 'node:fs';
import { SIM_DT, decodeP0, sampleHeight, type SimChunk } from '@dv/shared';
import { bakedWorldConfig, bakedWorldScenario, createPhysicsSim, type PhysicsSim } from '@dv/engine/sim';
import { describe, expect, it } from 'vitest';
import { player, frame, YAW, SPRINT } from '../../engine/test/walk-sim.ts';
import { createWorldStreamingModule } from '../src/sim/streaming/module.ts';
import type { PackReply, PackRequest, WorldSimConfig } from '../src/sim/streaming/channel.ts';
import { groundHeightAt, spawnPose, bootSet } from '../src/sim/streaming/boot.ts';
import { requireBake } from '../../../tests/support/require-bake.ts';

type Mode = 'immediate' | 'scripted';

/** The sim end of the pack channel, served from the bake on disk; replies are delivered by the test loop, never by themselves. */
class TestPort {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readonly requests: PackRequest[] = [];
  readonly sentAt = new Map<number, number>();
  private readonly due: { at: number; reply: PackReply }[] = [];
  tick = 0;
  constructor(private readonly dir: string, private readonly mode: Mode) {}
  postMessage(msg: unknown): void {
    const req = msg as PackRequest;
    this.requests.push(req);
    this.sentAt.set(req.seq, this.tick);
    const name = req.ref.url.split('/').pop() as string;
    const bytes = new Uint8Array(readFileSync(`${this.dir}/${name}`));
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    // immediate: the next tick; scripted: 2 to 40 ticks, in an order that reverses runs of seq numbers.
    const delay = this.mode === 'immediate' ? 1 : 2 + ((req.seq * 37 + 11) % 39);
    this.due.push({ at: this.tick + delay, reply: { seq: req.seq, bytes: buf } });
  }
  /** Delivers every reply due at or before `tick` (between ticks). */
  deliver(tick: number): number {
    this.tick = tick;
    const now = this.due.filter((d) => d.at <= tick).sort((a, b) => a.at - b.at || b.reply.seq - a.reply.seq);
    for (const d of now) {
      this.due.splice(this.due.indexOf(d), 1);
      this.onmessage?.({ data: d.reply });
    }
    return now.length;
  }
  get inFlight(): number {
    return this.due.length;
  }
}

interface Walk {
  hashes: string[];
  rebases: number;
  maxAddedPerTick: number;
  minClearance: number;
  travelled: number;
  applied: number[];
  requestsSeq: number[];
  outOfOrderArrivals: number;
  ticks: number;
  statics: number;
}

async function walk(bakeDir: string, bakeId: string, mode: Mode, meters: number, tier: 'mobile-low' | 'desktop' = 'mobile-low'): Promise<Walk> {
  const index = JSON.parse(readFileSync(`${bakeDir}/world-index.json`, 'utf8')) as Parameters<typeof spawnPose>[0] & Parameters<typeof bootSet>[0] & { tiles: { p0: string[] } };
  const dir = `${bakeDir}/packs`;
  const pose = spawnPose(index);
  const set = bootSet(index, pose, tier);
  const p0 = decodeP0(new Uint8Array(readFileSync(`${dir}/${(set.p0[0] as string).split('/')[1]}.pack`)));
  const ground = groundHeightAt(p0, pose.x, pose.z) as number;
  const refs: WorldSimConfig['refs'] = {};
  for (const t of index.tiles.p0) refs[`world_pack/p0-${t}`] = { url: `file://p0-${t}.pack`, sha256: '0'.repeat(64), bytes: 0, kind: 'chunk' };
  const spawn: [number, number, number] = [pose.x, ground + 1.5, pose.z];
  const world: WorldSimConfig = { bakeId, p0Tiles: index.tiles.p0, refs, spawn };
  const cfg = { ...bakedWorldConfig('canonical', 0, bakeId), tier };
  const boot = { strings: [], prefabs: [], config: { scenario: 'baked-world', spawn, spawnYaw: 0, world } };

  const sim: PhysicsSim = await createPhysicsSim(cfg, bakedWorldScenario, { boot: boot.config });
  const port = new TestPort(dir, mode);
  const mod = createWorldStreamingModule();
  for (const s of mod.systems) sim.core.addSystem(s);
  await mod.onInit?.({ sim, cfg, boot, runtime: { env: {} } as never, ports: { world: port } });
  const state = mod.state;
  if (!state) throw new Error('the world module did not start');

  // Count every chunk's statics added per tick.
  const original = sim.backend.addChunkStatics.bind(sim.backend);
  let addedThisTick = 0;
  let statics = 0;
  sim.backend.addChunkStatics = (key, shapes) => {
    addedThisTick++;
    statics++;
    original(key, shapes);
  };

  const chunkOf = new Map<string, SimChunk>();
  const heightAt = (x: number, z: number): number | null => {
    const key = `9/${Math.floor((x + 65664) / 256)}/${Math.floor((z + 65664) / 256)}`;
    let c = chunkOf.get(key);
    if (!c) {
      const u = state.store.unit('p0', key as never);
      if (u?.payload) {
        c = u.payload;
        chunkOf.set(key, c);
      }
    }
    return c ? sampleHeight(c.height, x, z) : null;
  };

  const hashes: string[] = [];
  let maxAdded = 0;
  let minClearance = Infinity;
  let started = false;
  let startX = 0;
  const maxTicks = Math.ceil((meters / 3) * 60) + 4000;
  let tick = 0;
  let outOfOrder = 0;
  let lastSeqArrived = 0;
  const orig = (port.onmessage as (ev: { data: unknown }) => void) ?? (() => {});
  port.onmessage = (ev) => {
    const seq = (ev.data as { seq: number }).seq;
    if (seq < lastSeqArrived) outOfOrder++;
    lastSeqArrived = Math.max(lastSeqArrived, seq);
    orig(ev);
  };
  for (; tick < maxTicks; tick++) {
    port.deliver(tick);
    addedThisTick = 0;
    const p = player(sim);
    if (!started && p.state === 100 && p.grounded) {
      started = true;
      startX = p.x;
    }
    sim.step(1, (t) => (started ? frame({ tick: t, moveY: -127, buttons: SPRINT, camYaw: YAW.west }) : frame({ tick: t })));
    maxAdded = Math.max(maxAdded, addedThisTick);
    const q = player(sim);
    if (started) {
      const h = heightAt(q.x, q.z);
      if (h !== null) minClearance = Math.min(minClearance, q.y - h);
      if (startX - q.x >= meters) break;
    }
    if (tick % 600 === 0) hashes.push(sim.hash());
  }
  hashes.push(sim.hash());
  const end = player(sim);
  void SIM_DT;
  return {
    hashes,
    rebases: sim.backend.rebases,
    maxAddedPerTick: maxAdded,
    minClearance,
    travelled: startX - end.x,
    applied: state.appliedSeqs.slice(),
    requestsSeq: port.requests.map((r) => r.seq),
    outOfOrderArrivals: outOfOrder,
    ticks: tick,
    statics,
  };
}

const WALK_M = Number(process.env['DV_WALK_M'] ?? 2000);
const REPEAT_M = Math.min(WALK_M, 1200);

describe('statics feed on the synth bake (AC-4)', () => {
  const bake = requireBake('synth', 'statics.spec synth bake');

  it('adds at most one chunk per tick, never lets the capsule fall below the heightfield, and rebases at 1,000 m with the same hash path twice', async () => {
    if (!bake) return;
    const a = await walk(bake.dir, bake.bakeId, 'immediate', WALK_M);
    // The second run covers the first 1,200 m, past the rebase at 1,000 m: its hash path is the prefix of the first.
    const b = await walk(bake.dir, bake.bakeId, 'immediate', REPEAT_M);
    expect(a.travelled).toBeGreaterThanOrEqual(WALK_M);
    expect(a.maxAddedPerTick).toBe(1);
    expect(a.minClearance).toBeGreaterThan(-0.05);
    expect(a.rebases).toBeGreaterThanOrEqual(1);
    expect(a.statics).toBeGreaterThanOrEqual(15);
    expect(b.rebases).toBeGreaterThanOrEqual(1);
    expect(b.hashes.length).toBeGreaterThan(10);
    expect(b.hashes.slice(0, -1)).toEqual(a.hashes.slice(0, b.hashes.length - 1));
    expect(a.applied).toEqual([...a.applied].sort((x, y) => x - y));
  }, 600_000);

  it('applies out-of-order and late replies at tick boundaries in seq order, with the same hash path twice', async () => {
    if (!bake) return;
    const a = await walk(bake.dir, bake.bakeId, 'scripted', WALK_M);
    const b = await walk(bake.dir, bake.bakeId, 'scripted', REPEAT_M);
    expect(a.outOfOrderArrivals).toBeGreaterThan(3);
    // Applied strictly in seq order, one after the other, none skipped.
    expect(a.applied).toEqual(a.applied.map((_, i) => i + 1));
    expect(a.maxAddedPerTick).toBe(1);
    expect(a.minClearance).toBeGreaterThan(-0.05);
    expect(a.travelled).toBeGreaterThanOrEqual(WALK_M);
    expect(a.rebases).toBeGreaterThanOrEqual(1);
    expect(b.rebases).toBeGreaterThanOrEqual(1);
    expect(b.hashes.slice(0, -1)).toEqual(a.hashes.slice(0, b.hashes.length - 1));
  }, 600_000);
});
