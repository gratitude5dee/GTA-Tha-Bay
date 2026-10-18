import { addEntity, removeEntity, type World } from 'bitecs';
import { ENTITY_GEN_MAX, ENTITY_ID_BITS, MAX_ENTITIES, type EntityHandle, type EntityId } from '@dv/shared';

export class EntityLimitError extends Error {
  constructor() {
    super(`entity limit reached: at most ${MAX_ENTITIES - 1} live entities per world (id 0 is reserved)`);
    this.name = 'EntityLimitError';
  }
}

export const enum EntityState {
  Free = 0,
  /** Allocated by a spawn command that has not been applied yet. Resolves to null. */
  Reserved = 1,
  Live = 2,
}

const ID_MASK = (1 << ENTITY_ID_BITS) - 1;
const GEN_SHIFT = 1 << ENTITY_ID_BITS; // 2^20

/** Next generation for an id: 0 (never allocated) -> 1, 4,095 wraps to 1. */
export function nextGeneration(g: number): number {
  return g === 0 || g >= ENTITY_GEN_MAX ? 1 : g + 1;
}

export function handleOf(id: number, gen: number): EntityHandle {
  return (gen * GEN_SHIFT + id) as EntityHandle;
}

export function idOfHandle(h: number): number {
  return h & ID_MASK;
}

export function genOfHandle(h: number): number {
  return h >>> ENTITY_ID_BITS;
}

/**
 * Hands out entity ids and generation-checked handles on top of a bitECS world.
 *
 * - bitECS owns existence and recycling (addEntity / removeEntity). The allocator does not rely on where bitECS
 *   starts counting: if it returns id 0 the id is kept as a sentinel and never handed out, and the allocator checks
 *   that recycled ids come back last-freed-first and new ids ascend, throwing at once if bitECS ever disagrees.
 * - Generations live in the engine's own Gen store (u16 per id), bumped when an id is allocated.
 * - At most MAX_ENTITIES - 1 entities (ids 1..65,535) are allocated at once, reserved ones included.
 */
export class EntityAllocator {
  /** EntityState per id. */
  readonly state = new Uint8Array(MAX_ENTITIES);
  /** Freed ids; the last element is handed out next (mirrors bitECS's recycling order). */
  readonly freeStack: number[] = [];
  /** Highest id ever allocated. */
  maxId = 0;
  /** Reserved plus live entities. */
  count = 0;
  private sentinel = false;

  constructor(private bw: World, private readonly gen: Uint16Array) {}

  /** Reserve an id and a fresh generation. The entity is invisible to queries until `activate`. */
  allocate(): EntityHandle {
    if (this.count >= MAX_ENTITIES - 1) throw new EntityLimitError();
    let id = addEntity(this.bw);
    if (id === 0) {
      this.sentinel = true;
      id = addEntity(this.bw);
    }
    if (id <= 0 || id >= MAX_ENTITIES) throw new Error(`EntityAllocator: bitECS returned id ${id}`);
    if (this.freeStack.length > 0) {
      const expected = this.freeStack.pop() as number;
      if (expected !== id) throw new Error(`EntityAllocator: bitECS recycled id ${id}, expected ${expected}`);
    } else if (id !== this.maxId + 1) {
      throw new Error(`EntityAllocator: bitECS returned id ${id}, expected ${this.maxId + 1}`);
    }
    if (id > this.maxId) this.maxId = id;
    const g = nextGeneration(this.gen[id] as number);
    this.gen[id] = g;
    this.state[id] = EntityState.Reserved;
    this.count++;
    return handleOf(id, g);
  }

  activate(id: number): void {
    this.state[id] = EntityState.Live;
  }

  /** Free an id (reserved or live). The caller removes component data first. */
  release(id: number): void {
    removeEntity(this.bw, id);
    this.freeStack.push(id);
    this.state[id] = EntityState.Free;
    this.count--;
  }

  /** The id for a handle, or null if the handle is stale, never allocated, or not yet applied. */
  resolve(h: number): EntityId | null {
    const id = h & ID_MASK;
    if (id === 0 || this.state[id] !== EntityState.Live) return null;
    return this.gen[id] === h >>> ENTITY_ID_BITS ? (id as EntityId) : null;
  }

  handle(id: number): EntityHandle {
    return handleOf(id, this.gen[id] as number);
  }

  isLive(id: number): boolean {
    return this.state[id] === EntityState.Live;
  }

  get hasSentinel(): boolean {
    return this.sentinel;
  }

  /**
   * Rebuild the allocator on a fresh bitECS world so that ids `live` are allocated and the free stack equals
   * `freeStack` (bottom first). Used by restore. Replays addEntity / removeEntity only, never bitECS internals.
   */
  rebuild(bw: World, maxId: number, live: readonly number[], freeStack: readonly number[]): void {
    this.bw = bw;
    this.state.fill(0);
    this.freeStack.length = 0;
    this.maxId = 0;
    this.count = 0;
    this.sentinel = false;
    for (let want = 1; want <= maxId; want++) {
      let id = addEntity(bw);
      if (id === 0) {
        this.sentinel = true;
        id = addEntity(bw);
      }
      if (id !== want) throw new Error(`EntityAllocator.rebuild: bitECS returned id ${id}, expected ${want}`);
    }
    this.maxId = maxId;
    for (const id of freeStack) {
      removeEntity(bw, id);
      this.freeStack.push(id);
    }
    for (const id of live) {
      this.state[id] = EntityState.Live;
      this.count++;
    }
  }
}
