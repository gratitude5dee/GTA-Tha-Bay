/**
 * Bark pools (04-npc-builder.md section C9; M06c). A pool is a validated `bark-pool/1` document: lines grouped by `BarkTag`, each with a
 * weight and an optional pre-rendered audio asset (the placeholder pools ship `audio: null`; M10c bakes the voices). The five archetype
 * pools in `content/npcs/barks/` are bundled so a pedestrian can bark with no request. Per-NPC pools (`pool.owner` an NPC id) are added by
 * `BarkPools.add`. Sim code; C02 lint applies.
 */
import type { Archetype, BarkLine, BarkPool, BarkTag } from '@dv/shared/contracts/c10-npc';
import { formatIssue, validateBarkPool } from '@dv/shared/npc';
import civilian from '../../../../content/npcs/barks/civilian.json';
import founder from '../../../../content/npcs/barks/founder.json';
import police from '../../../../content/npcs/barks/police.json';
import rapper from '../../../../content/npcs/barks/rapper.json';
import vendor from '../../../../content/npcs/barks/vendor.json';

/** The archetype pools the game ships; a filler pedestrian takes one of them. */
export const FILLER_ARCHETYPES: readonly Archetype[] = ['civilian', 'vendor', 'founder', 'rapper', 'police'];

export interface WeightedRng {
  nextFloat(): number;
}

/** The lines of one pool by tag. */
export class PoolIndex {
  private readonly byTag = new Map<BarkTag, BarkLine[]>();

  constructor(readonly pool: BarkPool) {
    for (const line of pool.lines) {
      let list = this.byTag.get(line.tag);
      if (list === undefined) this.byTag.set(line.tag, (list = []));
      list.push(line);
    }
  }

  get owner(): string {
    return this.pool.owner;
  }

  has(tag: BarkTag): boolean {
    return (this.byTag.get(tag)?.length ?? 0) > 0;
  }

  lines(tag: BarkTag): readonly BarkLine[] {
    return this.byTag.get(tag) ?? [];
  }

  /**
   * A weighted pick with one draw of `rng`. `avoid` (the line said last) is left out when another line exists, so a pool of two does not
   * repeat itself.
   */
  pick(tag: BarkTag, rng: WeightedRng, avoid?: string): BarkLine | null {
    const all = this.byTag.get(tag);
    if (!all || all.length === 0) return null;
    const list = avoid !== undefined && all.length > 1 ? all.filter((l) => l.id !== avoid) : all;
    let total = 0;
    for (const l of list) total += l.weight;
    let r = rng.nextFloat() * total;
    for (const l of list) {
      r -= l.weight;
      if (r < 0) return l;
    }
    return list[list.length - 1] ?? null;
  }
}

export class PoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoolError';
  }
}

/** Validates a parsed pool document against `bark-pool-1.0` and the line rules the schema leaves to code (unique ids). */
export function parsePool(doc: unknown): BarkPool {
  const issues = validateBarkPool(doc);
  if (issues.length > 0) throw new PoolError(`bark pool: ${issues.map(formatIssue).join('; ')}`);
  const pool = doc as BarkPool;
  const seen = new Set<string>();
  for (const l of pool.lines) {
    if (seen.has(l.id)) throw new PoolError(`bark pool ${pool.owner}: duplicate line id ${l.id}`);
    seen.add(l.id);
  }
  return pool;
}

export class BarkPools {
  private readonly pools = new Map<string, PoolIndex>();

  add(doc: unknown): PoolIndex {
    const idx = new PoolIndex(parsePool(doc));
    this.pools.set(idx.owner, idx);
    return idx;
  }

  /** The pool of an owner: `archetype:<a>` or an NPC id. */
  get(owner: string): PoolIndex | undefined {
    return this.pools.get(owner);
  }

  /** The pool for a named NPC: its own, else the pool of its archetype. */
  forNpc(npcId: string, archetype: string): PoolIndex | undefined {
    return this.pools.get(npcId) ?? this.pools.get(`archetype:${archetype}`);
  }

  owners(): string[] {
    return [...this.pools.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
}

/** The five shipped archetype pools, validated. */
export function builtinPools(): BarkPools {
  const pools = new BarkPools();
  for (const doc of [civilian, vendor, police, founder, rapper]) pools.add(doc);
  return pools;
}

/** The pool owner of a filler pedestrian: a stable share by its key, so the same pedestrian keeps its voice. Civilians are most. */
export function fillerArchetype(hash32: number): Archetype {
  const r = (hash32 >>> 0) % 100;
  if (r < 60) return 'civilian';
  if (r < 75) return 'vendor';
  if (r < 85) return 'founder';
  if (r < 95) return 'rapper';
  return 'police';
}

/** Who speaks, as a subtitle speaker id, for a filler of an archetype. */
export const FILLER_SPEAKER: Readonly<Record<string, string>> = {
  civilian: 'passerby', vendor: 'vendor', police: 'officer', founder: 'founder', rapper: 'rapper',
};
