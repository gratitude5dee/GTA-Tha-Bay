/**
 * Writes the golden vector files in packages/shared/test/golden/ from the current implementation:
 *   detmath.v1.json, rng.v1.json, ctr.v1.json, fnv.v1.json
 * Doubles are stored as 16 hex digits of their IEEE-754 bit pattern (high word first); every NaN is written as
 * 7ff8000000000000. A golden file is never overwritten unless --force is passed: a changed vector means a change in
 * simulation behaviour and must be reviewed.
 *
 * Usage: pnpm --filter @dv/shared vectors:write [-- --force]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Fnv64, Rng, ctrU32, datan2, dcos, dexp, dhypot, dlog, dpow, dsin, dsqrt, fnv32, hex32, lerpAngle, normalizeAngle,
  splitmix32, streams, utf8Bytes,
} from '../src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const goldenDir = path.join(here, '..', 'test', 'golden');
const force = process.argv.slice(2).includes('--force');

const F = new Float64Array(1);
const U = new Uint32Array(F.buffer);

export function toBits(x: number): string {
  if (x !== x) return '7ff8000000000000';
  F[0] = x;
  return hex32(U[1] as number) + hex32(U[0] as number);
}

function fromBits(hi: number, lo: number): number {
  U[1] = hi >>> 0;
  U[0] = lo >>> 0;
  return F[0] as number;
}

const rng = new Rng(0xd37a4a7);
const uniform = (lo: number, hi: number): number => rng.range(lo, hi);
/** Sign times 10^e with e uniform in [e0, e1]. */
const logUniform = (e0: number, e1: number): number => {
  const mag = dpow(10, uniform(e0, e1));
  return rng.nextU32() & 1 ? -mag : mag;
};
const randomBits = (): number => fromBits(rng.nextU32(), rng.nextU32());
const nextUp = (x: number): number => {
  F[0] = x;
  if (x >= 0) {
    U[0] = (U[0] as number) + 1;
    if (U[0] === 0) U[1] = (U[1] as number) + 1;
  } else {
    if (U[0] === 0) U[1] = (U[1] as number) - 1;
    U[0] = (U[0] as number) - 1;
  }
  return F[0] as number;
};
const nextDown = (x: number): number => -nextUp(-x);

const HALF_PI = 1.5707963267948966;
const SPECIAL: number[] = [
  0, -0, 5e-324, -5e-324, 2.225073858507201e-308, 2.2250738585072014e-308, 1e-300, -1e-300, 1e300, -1e300,
  1, -1, 0.5, -0.5, 2, 3, 10, 100, 0.1, 1e5, -1e5, 1e9, 1e15, 1.7976931348623157e308, -1.7976931348623157e308,
  NaN, Infinity, -Infinity, 709.78, 710, -745, -746, 1023, -1075, 4.4e-16,
];
for (let k = -40; k <= 40; k++) {
  const v = k * HALF_PI;
  SPECIAL.push(v, nextUp(v), nextDown(v));
}

function pad(list: number[][], n: number, make: () => number[]): number[][] {
  while (list.length < n) list.push(make());
  return list;
}

const N = 2400;

const sqrtIn = pad(SPECIAL.map((x) => [x]), N, () => {
  const r = rng.nextU32() % 4;
  return [r === 0 ? Math.abs(randomBits()) : r === 1 ? Math.abs(logUniform(-323, 308)) : r === 2 ? uniform(0, 100) : uniform(0.9, 1.1)];
});
const trigIn = pad(SPECIAL.map((x) => [x]), N, () => {
  const r = rng.nextU32() % 5;
  return [r === 0 ? uniform(-10, 10) : r === 1 ? uniform(-1e5, 1e5) : r === 2 ? logUniform(-300, 300) : r === 3 ? randomBits() : uniform(-1e9, 1e9)];
});
const pairIn = (): number[] => {
  const r = rng.nextU32() % 4;
  if (r === 0) return [uniform(-100, 100), uniform(-100, 100)];
  if (r === 1) return [logUniform(-300, 300), logUniform(-300, 300)];
  if (r === 2) return [randomBits(), randomBits()];
  return [uniform(-1, 1), uniform(-1, 1)];
};
const atan2In = pad(
  SPECIAL.slice(0, 30).flatMap((y) => SPECIAL.slice(0, 30).map((x) => [y, x])).concat([[0, -0], [-0, -0], [-0, 0], [1, 1]]),
  N + 900, pairIn,
);
const expIn = pad(SPECIAL.map((x) => [x]), N, () => {
  const r = rng.nextU32() % 4;
  return [r === 0 ? uniform(-745, 710) : r === 1 ? uniform(-1, 1) : r === 2 ? logUniform(-30, 0) : uniform(-20, 20)];
});
const logIn = pad(SPECIAL.map((x) => [x]), N, () => {
  const r = rng.nextU32() % 4;
  return [r === 0 ? Math.abs(logUniform(-323, 308)) : r === 1 ? uniform(0, 10) : r === 2 ? uniform(0.5, 2) : Math.abs(randomBits())];
});
const powIn = pad(
  SPECIAL.slice(0, 20).flatMap((b) => [0, -0, 1, -1, 2, -2, 0.5, 3, 10, 0.1, 1000, -1000, 1e10, NaN, Infinity, -Infinity].map((e) => [b, e])),
  N + 400,
  () => {
    const r = rng.nextU32() % 5;
    if (r === 0) return [uniform(0, 20), uniform(-30, 30)];
    if (r === 1) return [uniform(-20, 20), Math.trunc(uniform(-60, 60))];
    if (r === 2) return [uniform(0.9, 1.1), uniform(-1000, 1000)];
    if (r === 3) return [Math.abs(logUniform(-20, 20)), uniform(-5, 5)];
    return [uniform(-3, 3), Math.trunc(uniform(-1100, 1100))];
  },
);
const hypotIn = pad(
  SPECIAL.slice(0, 30).flatMap((y) => SPECIAL.slice(0, 30).map((x) => [y, x])),
  N + 900, pairIn,
);
const lerpIn = pad(
  [[0, 1, 0.5], [3, -3, 0.5], [-3, 3, 0.25], [6.2, 0.1, 0.5], [NaN, 1, 0.5], [1, Infinity, 0.5], [0, 1, 0], [0, 1, 1]],
  N, () => [uniform(-10, 10), uniform(-10, 10), rng.range(-0.5, 1.5)],
);
const normIn = pad(SPECIAL.map((x) => [x]), N, () => {
  const r = rng.nextU32() % 3;
  return [r === 0 ? uniform(-100, 100) : r === 1 ? logUniform(-5, 12) : uniform(-7, 7)];
});

type Fn = (...a: number[]) => number;
function table(name: string, arity: number, inputs: number[][], fn: Fn): [string, object] {
  const cases = inputs.map((a) => [...a.map(toBits), toBits(fn(...a))]);
  return [name, { arity, cases }];
}

const detmathFile = {
  version: 1,
  format: 'each case is [...args, result] as 16 hex digits of the IEEE-754 bits; every NaN is 7ff8000000000000',
  functions: Object.fromEntries([
    table('dsqrt', 1, sqrtIn, dsqrt),
    table('dsin', 1, trigIn, dsin),
    table('dcos', 1, trigIn, dcos),
    table('datan2', 2, atan2In, datan2),
    table('dexp', 1, expIn, dexp),
    table('dlog', 1, logIn, dlog),
    table('dpow', 2, powIn, dpow),
    table('dhypot', 2, hypotIn, dhypot),
    table('lerpAngle', 3, lerpIn, lerpAngle),
    table('normalizeAngle', 1, normIn, normalizeAngle),
  ]),
};

// RNG goldens.
const seeds = [0, 1, 0xc0ffee, 0xffffffff, 123456789, 0x80000000];
const rngFile = {
  version: 1,
  splitmix32: [0, 1, 2, 0x9e3779b9, 0xc0ffee, 0xffffffff, 0x80000000, 12345].map((x) => ({ x, out: splitmix32(x) })),
  xoshiro: seeds.map((seed) => {
    const r = new Rng(seed);
    const initial = r.getState();
    const out: number[] = [];
    for (let i = 0; i < 64; i++) out.push(r.nextU32());
    return { seed, initial, out };
  }),
  streams: (() => {
    const s = streams(0xc0ffee);
    return ['world', 'weather', 'pursuit', 'mode:racing', 'amb:cell_3:7'].map((name) => {
      const r = s.get(name);
      const initial = r.getState();
      const out: number[] = [];
      for (let i = 0; i < 16; i++) out.push(r.nextU32());
      return { seed: 0xc0ffee, name, fnv32: fnv32(name), initial, out };
    });
  })(),
};

// ctrU32 goldens.
const ctrCases: { seed: number; stream: string; counter: number; out: number }[] = [];
for (const seed of [0, 0xc0ffee, 0xffffffff]) {
  for (const stream of ['tycoon.events', 'hire', 'board', '']) {
    for (const counter of [0, 1, 2, 3, 1000, 65535, 0x7fffffff, 0xffffffff]) {
      ctrCases.push({ seed, stream, counter, out: ctrU32(seed, stream, counter) });
    }
  }
}
const ctrFile = { version: 1, cases: ctrCases };

// FNV goldens.
const strings = ['', 'a', 'foobar', 'world', 'weather', 'mode:racing', 'amb:cell_3:7', 'Tha Bay', 'café', '\u{1f309} bridge', 'x'.repeat(1000)];
const fnvFile = {
  version: 1,
  strings: strings.map((s) => ({
    text: s.length > 64 ? undefined : s,
    repeat: s.length > 64 ? { ch: 'x', n: s.length } : undefined,
    fnv32: fnv32(s),
    fnv64: new Fnv64().bytes(utf8Bytes(s)).hex(),
  })),
  feeders: (() => {
    const h = new Fnv64();
    h.u8(1).u32(0xdeadbeef).f32(1.5).f32(-0).f64(Math.PI).f64(-0).f64(NaN).str('ab').str('c');
    return { sequence: 'u8(1) u32(0xdeadbeef) f32(1.5) f32(-0) f64(PI) f64(-0) f64(NaN) str(ab) str(c)', hex: h.hex(), nanCount: h.nanCount };
  })(),
};

function emit(file: string, data: unknown): void {
  const target = path.join(goldenDir, file);
  if (existsSync(target) && !force) {
    console.error(`refusing to overwrite ${path.relative(process.cwd(), target)} (pass --force to replace it)`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(goldenDir, { recursive: true });
  writeFileSync(target, `${JSON.stringify(data)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), target)}`);
}

emit('detmath.v1.json', detmathFile);
emit('rng.v1.json', rngFile);
emit('ctr.v1.json', ctrFile);
emit('fnv.v1.json', fnvFile);
