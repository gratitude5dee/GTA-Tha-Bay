import {
  Fnv64, Rng, ctrU32, datan2, dcos, dexp, dhypot, dlog, dpow, dsin, dsqrt, fnv32, fnv64Hex, hex32, lerpAngle,
  normalizeAngle, splitmix32, streams, utf8Bytes,
} from '@dv/shared';

/**
 * Runs the shared golden vectors (detmath, rng, ctr, fnv) against the current engine. The same function runs in Node
 * (to prove the checker catches a corrupted vector) and in sim.worker on the QA page (Chromium and WebKit), where
 * `mismatches` must be 0 (M01a2 AC-6 and AC-7).
 */
export interface DetmathGolden {
  functions: Record<string, { arity: number; cases: string[][] }>;
}
export interface RngGolden {
  splitmix32: { x: number; out: number }[];
  xoshiro: { seed: number; initial: number[]; out: number[] }[];
  streams: { seed: number; name: string; fnv32: number; initial: number[]; out: number[] }[];
}
export interface CtrGolden {
  cases: { seed: number; stream: string; counter: number; out: number }[];
}
export interface FnvGolden {
  strings: { text?: string; repeat?: { ch: string; n: number }; fnv32: number; fnv64: string }[];
  feeders: { hex: string; nanCount: number };
}
export interface VectorGoldens {
  detmath: DetmathGolden;
  rng: RngGolden;
  ctr: CtrGolden;
  fnv: FnvGolden;
}

export interface VectorGroupResult {
  total: number;
  mismatches: number;
}
export interface VectorResult {
  total: number;
  mismatches: number;
  groups: Record<string, VectorGroupResult>;
  /** The first mismatch, for the failure message. */
  first: string | null;
}

const F = new Float64Array(1);
const U = new Uint32Array(F.buffer);

function bitsOf(x: number): string {
  if (x !== x) return '7ff8000000000000';
  F[0] = x;
  return hex32(U[1] as number) + hex32(U[0] as number);
}

function fromBits(s: string): number {
  U[1] = parseInt(s.slice(0, 8), 16);
  U[0] = parseInt(s.slice(8), 16);
  return F[0] as number;
}

const DETMATH_FUNCTIONS: Record<string, (...a: number[]) => number> = {
  dsqrt, dsin, dcos, datan2, dexp, dlog, dpow, dhypot, lerpAngle, normalizeAngle,
};

export function runVectorChecks(g: VectorGoldens): VectorResult {
  const groups: Record<string, VectorGroupResult> = {};
  let first: string | null = null;
  const tally = (group: string, ok: boolean, what: () => string): void => {
    const r = groups[group] ?? (groups[group] = { total: 0, mismatches: 0 });
    r.total++;
    if (!ok) {
      r.mismatches++;
      if (first === null) first = `${group}: ${what()}`;
    }
  };

  for (const name of Object.keys(DETMATH_FUNCTIONS)) {
    const table = g.detmath.functions[name];
    const impl = DETMATH_FUNCTIONS[name] as (...a: number[]) => number;
    if (!table) {
      tally(`detmath.${name}`, false, () => 'missing from the golden file');
      continue;
    }
    for (const c of table.cases) {
      const got = bitsOf(impl(...c.slice(0, table.arity).map(fromBits)));
      tally(`detmath.${name}`, got === c[table.arity], () => `${name}(${c.slice(0, table.arity).join(',')}) = ${got}, golden ${c[table.arity]}`);
    }
  }

  for (const e of g.rng.splitmix32) tally('rng.splitmix32', splitmix32(e.x) === e.out, () => `splitmix32(${e.x}) = ${splitmix32(e.x)}, golden ${e.out}`);
  for (const e of g.rng.xoshiro) {
    const r = new Rng(e.seed);
    tally('rng.xoshiro', sameList(r.getState(), e.initial), () => `seed ${e.seed}: initial state differs`);
    const got = e.out.map(() => r.nextU32());
    tally('rng.xoshiro', sameList(got, e.out), () => `seed ${e.seed}: outputs differ`);
  }
  for (const e of g.rng.streams) {
    const r = streams(e.seed).get(e.name);
    tally('rng.streams', fnv32(e.name) === e.fnv32, () => `fnv32(${e.name}) differs`);
    tally('rng.streams', sameList(r.getState(), e.initial), () => `stream ${e.name}: initial state differs`);
    const got = e.out.map(() => r.nextU32());
    tally('rng.streams', sameList(got, e.out), () => `stream ${e.name}: outputs differ`);
  }

  for (const e of g.ctr.cases) {
    const got = ctrU32(e.seed, e.stream, e.counter);
    tally('ctr', got === e.out, () => `ctrU32(${e.seed}, ${e.stream}, ${e.counter}) = ${got}, golden ${e.out}`);
  }

  for (const e of g.fnv.strings) {
    const text = e.text ?? (e.repeat ? e.repeat.ch.repeat(e.repeat.n) : '');
    tally('fnv', fnv32(text) === e.fnv32, () => `fnv32 of a ${text.length}-char string differs`);
    tally('fnv', fnv64Hex(text) === e.fnv64, () => `fnv64 of a ${text.length}-char string differs`);
    tally('fnv', new Fnv64().bytes(utf8Bytes(text)).hex() === e.fnv64, () => `Fnv64.bytes of a ${text.length}-char string differs`);
  }
  const h = new Fnv64();
  h.u8(1).u32(0xdeadbeef).f32(1.5).f32(-0).f64(Math.PI).f64(-0).f64(NaN).str('ab').str('c');
  tally('fnv', h.hex() === g.fnv.feeders.hex, () => `feeder hash ${h.hex()}, golden ${g.fnv.feeders.hex}`);
  tally('fnv', h.nanCount === g.fnv.feeders.nanCount, () => 'feeder NaN count differs');

  let total = 0;
  let mismatches = 0;
  for (const r of Object.values(groups)) {
    total += r.total;
    mismatches += r.mismatches;
  }
  return { total, mismatches, groups, first };
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
