/**
 * Seeded RNG for the sim (C02 determinism rule 3). 32 bit integer math only (Math.imul, shifts, xor).
 *
 * - splitmix32(x): the first output of the SplitMix32 generator started at state x. Stateless.
 * - Rng: xoshiro128** with four u32 words of state. Seeding fills the words with splitmix32(seed + i * GOLDEN).
 * - streams(seed): named streams, each seeded with splitmix32(seed ^ fnv32(name)) as the base.
 * - ctrU32(seed, stream, counter): stateless counter hash (C02 1.1), splitmix32((seed ^ fnv32(stream)) + imul(counter, GOLDEN)).
 */
import { fnv32 } from './hash.ts';

const GOLDEN = 0x9e3779b1;
const SPLITMIX_INC = 0x9e3779b9;
const INV_2_32 = 1 / 4294967296;

/** SplitMix32 output for state `x`: one increment, then the finalizer. Returns an unsigned 32 bit integer. */
export function splitmix32(x: number): number {
  let z = (x + SPLITMIX_INC) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

/** Stateless counter-based u32: the same (seed, stream, counter) always gives the same value. */
export function ctrU32(seed: number, stream: string, counter: number): number {
  return splitmix32(((seed ^ fnv32(stream)) + Math.imul(counter, GOLDEN)) | 0);
}

export type RngState = readonly [number, number, number, number];

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/** xoshiro128** (Blackman and Vigna). */
export class Rng {
  private s0 = 1;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  /** `seed` is any u32 or i32; it is expanded to the four state words with splitmix32. */
  constructor(seed: number) {
    this.seed(seed);
  }

  seed(seed: number): void {
    const s = seed | 0;
    this.s0 = splitmix32(s);
    this.s1 = splitmix32((s + Math.imul(1, SPLITMIX_INC)) | 0);
    this.s2 = splitmix32((s + Math.imul(2, SPLITMIX_INC)) | 0);
    this.s3 = splitmix32((s + Math.imul(3, SPLITMIX_INC)) | 0);
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Next unsigned 32 bit integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform in [0, 1) with 2^-32 resolution. */
  nextFloat(): number {
    return this.nextU32() * INV_2_32;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + this.nextFloat() * (hi - lo);
  }

  getState(): [number, number, number, number] {
    return [this.s0 >>> 0, this.s1 >>> 0, this.s2 >>> 0, this.s3 >>> 0];
  }

  setState(s: RngState): void {
    this.s0 = s[0] | 0;
    this.s1 = s[1] | 0;
    this.s2 = s[2] | 0;
    this.s3 = s[3] | 0;
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Named streams of one world seed. Streams are created on first use; their states are hashed resources. */
export class RngStreams {
  readonly seed: number;
  private readonly byName = new Map<string, Rng>();
  private names: string[] = [];

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  /** The stream called `name`, created and seeded with splitmix32(seed ^ fnv32(name)) on first use. */
  get(name: string): Rng {
    let r = this.byName.get(name);
    if (!r) {
      r = new Rng(splitmix32((this.seed ^ fnv32(name)) | 0));
      this.byName.set(name, r);
      this.names.push(name);
      this.names.sort(compareNames);
    }
    return r;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Stream names in ascending code-unit order (the order states are hashed and saved in). */
  streamNames(): readonly string[] {
    return this.names;
  }

  /** States of every created stream, in `streamNames()` order. */
  states(): { name: string; state: [number, number, number, number] }[] {
    return this.names.map((name) => ({ name, state: (this.byName.get(name) as Rng).getState() }));
  }

  /** Replace all streams with the given states (checkpoint restore). */
  setStates(list: readonly { name: string; state: RngState }[]): void {
    this.byName.clear();
    this.names = [];
    for (const { name, state } of list) {
      const r = new Rng(0);
      r.setState(state);
      this.byName.set(name, r);
      this.names.push(name);
    }
    this.names.sort(compareNames);
  }
}

/** Named streams for a world seed (C02 rule 3). */
export function streams(seed: number): RngStreams {
  return new RngStreams(seed);
}
