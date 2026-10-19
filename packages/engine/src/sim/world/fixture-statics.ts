import { decodeP0, dhypot, SimStage, TERRAIN_POSTS, toStaticShapeSet, type SimChunk, type SystemDef } from '@dv/shared';
import type { ByteReader, ByteWriter } from '../bytes.ts';
import type { PhysicsSystemsBackend, StaticShapeSet } from '../physics/backend.ts';
import type { SimEventLog } from '../events.ts';
import type { SimResource } from '../services.ts';

export const FIXTURE_STATICS_ID = 'engine.world.fixtureStatics';

/** One decoded chunk ready for `addChunkStatics`. */
export interface FixtureChunk {
  key: string;
  shapes: StaticShapeSet;
  /** Centre of the chunk, ENU metres (used to order the queue). */
  cx: number;
  cz: number;
}

/**
 * The gray-box fixture chunks in the order the sim adds them: nearest to the spawn first, ties by key. A fixed order keeps the
 * tick on which each chunk's colliders appear (and so the state hash) the same on every run.
 */
export function fixtureChunksFromP0(p0: Uint8Array, spawnX: number, spawnZ: number): FixtureChunk[] {
  const chunks: SimChunk[] = decodeP0(p0);
  const out: FixtureChunk[] = chunks.map((c) => {
    const h = c.height;
    const edge = h.cellM * (TERRAIN_POSTS - 1);
    return { key: c.key, shapes: toStaticShapeSet(c) as StaticShapeSet, cx: h.originX + edge / 2, cz: h.originZ + edge / 2 };
  });
  out.sort((a, b) => {
    const da = dhypot(a.cx - spawnX, a.cz - spawnZ);
    const db = dhypot(b.cx - spawnX, b.cz - spawnZ);
    return da !== db ? da - db : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return out;
}

/** The chunks still to add and how many have been added. `added` is simulation state (hashed and checkpointed). */
export class FixtureStaticsQueue {
  added = 0;
  constructor(readonly chunks: readonly FixtureChunk[]) {}

  get done(): boolean {
    return this.added >= this.chunks.length;
  }
}

/**
 * Adds at most one chunk's static colliders per tick (M01b2; a stand-in for the streaming of M02b1). Runs first in the
 * Commands stage, so the colliders are in Rapier's broad phase after that tick's physics step and the ownership machine sees
 * them on the next tick.
 */
export function fixtureStaticsSystem(
  backend: Pick<PhysicsSystemsBackend, 'addChunkStatics'>,
  queue: FixtureStaticsQueue,
  events?: Pick<SimEventLog, 'push'>,
): SystemDef {
  return {
    id: FIXTURE_STATICS_ID, owner: 'S01', stage: SimStage.Commands, order: -500,
    run: ({ tick }) => {
      if (queue.done) return;
      const c = queue.chunks[queue.added] as FixtureChunk;
      backend.addChunkStatics(c.key, c.shapes);
      queue.added++;
      events?.push({ t: 'world.chunk', tick, n: queue.added, s: c.key });
    },
  };
}

/** The queue position as a hashed, checkpointed resource. */
export function fixtureStaticsResource(queue: FixtureStaticsQueue): SimResource {
  return {
    name: 'world.fixtureStatics',
    hash(h) {
      h.u32(queue.added);
    },
    save(w: ByteWriter) {
      w.u32(queue.added);
    },
    load(r: ByteReader) {
      queue.added = r.u32();
    },
  };
}
