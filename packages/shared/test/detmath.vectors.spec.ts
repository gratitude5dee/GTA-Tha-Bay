import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PI, Rng, TWO_PI, datan2, dcos, detmath, dexp, dhypot, dlog, dpow, dsin, dsqrt, hex32, lerpAngle, normalizeAngle,
} from '../src/index.ts';

const golden = JSON.parse(readFileSync(new URL('./golden/detmath.v1.json', import.meta.url), 'utf8')) as {
  functions: Record<string, { arity: number; cases: string[][] }>;
};

const F = new Float64Array(1);
const U = new Uint32Array(F.buffer);
function bits(x: number): string {
  if (x !== x) return '7ff8000000000000';
  F[0] = x;
  return hex32(U[1] as number) + hex32(U[0] as number);
}
function fromBits(s: string): number {
  U[1] = parseInt(s.slice(0, 8), 16);
  U[0] = parseInt(s.slice(8), 16);
  return F[0] as number;
}

const IMPLS: Record<string, (...a: number[]) => number> = {
  dsqrt, dsin, dcos, datan2, dexp, dlog, dpow, dhypot, lerpAngle, normalizeAngle,
};

describe('detmath golden vectors (IEEE-754 bits)', () => {
  for (const [name, impl] of Object.entries(IMPLS)) {
    it(`${name}: at least 2,000 vectors, every result bit-identical`, () => {
      const table = golden.functions[name];
      expect(table).toBeDefined();
      const { arity, cases } = table as { arity: number; cases: string[][] };
      expect(cases.length).toBeGreaterThanOrEqual(2000);
      let bad = 0;
      let first = '';
      for (const c of cases) {
        const args = c.slice(0, arity).map(fromBits);
        const got = bits(impl(...args));
        if (got !== c[arity]) {
          bad++;
          if (!first) first = `${name}(${c.slice(0, arity).join(',')}) = ${got}, golden ${c[arity]}`;
        }
      }
      expect(bad, first).toBe(0);
    });
  }

  it('inputs include the required edge values: +-0, subnormals, +-pi boundaries, 1e-300 and 1e300', () => {
    const ins = new Set((golden.functions['dsin'] as { cases: string[][] }).cases.map((c) => c[0]));
    for (const v of [0, -0, 5e-324, -5e-324, 1e-300, 1e300, -1e300, PI, -PI, PI / 2, -PI / 2]) {
      expect(ins.has(bits(v)), `dsin input ${v}`).toBe(true);
    }
    const sq = new Set((golden.functions['dsqrt'] as { cases: string[][] }).cases.map((c) => c[0]));
    for (const v of [0, -0, 5e-324, 1e-300, 1e300]) expect(sq.has(bits(v)), `dsqrt input ${v}`).toBe(true);
  });

  it('the frozen detmath object carries the C02 rule 2 names', () => {
    expect(Object.isFrozen(detmath)).toBe(true);
    expect(Object.keys(detmath).sort((a, b) => (a < b ? -1 : 1))).toEqual(
      ['atan2', 'cos', 'exp', 'hypot', 'lerpAngle', 'log', 'normalizeAngle', 'pow', 'sin', 'sqrt'],
    );
    expect(detmath.sqrt(9)).toBe(3);
  });
});

// --- accuracy against Math.* (Node) within the design bounds ---------------------------------

const rng = new Rng(0xacc0);
const u = (lo: number, hi: number): number => rng.range(lo, hi);

function ulpDistance(a: number, b: number): number {
  if (a === b) return 0;
  const key = (x: number): bigint => {
    F[0] = x;
    const raw = (BigInt(U[1] as number) << 32n) | BigInt(U[0] as number);
    return raw >> 63n ? -(raw & 0x7fffffffffffffffn) : raw;
  };
  const d = key(a) - key(b);
  return Number(d < 0n ? -d : d);
}

describe('detmath accuracy against Math.* (design bounds)', () => {
  const N = 20000;

  it('dsqrt is within 1 ulp of Math.sqrt over the whole range', () => {
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const x = Math.pow(10, u(-323, 308));
      worst = Math.max(worst, ulpDistance(dsqrt(x), Math.sqrt(x)));
    }
    for (const x of [0, 1, 2, 3, 4, 0.5, 1e-310, 5e-324, 1.7976931348623157e308]) {
      worst = Math.max(worst, ulpDistance(dsqrt(x), Math.sqrt(x)));
    }
    expect(worst).toBeLessThanOrEqual(1);
    expect(Object.is(dsqrt(-0), -0)).toBe(true);
    expect(dsqrt(-1)).toBeNaN();
    expect(dsqrt(Infinity)).toBe(Infinity);
  });

  it('dsin and dcos: absolute error <= 2e-15 for |x| <= 1e5', () => {
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const x = i % 2 === 0 ? u(-1e5, 1e5) : u(-20, 20);
      worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
    }
    expect(worst).toBeLessThanOrEqual(2e-15);
    expect(Object.is(dsin(-0), -0)).toBe(true);
    expect(dcos(0)).toBe(1);
    expect(dsin(Infinity)).toBeNaN();
    const huge = dsin(1e300);
    expect(huge).toBeGreaterThanOrEqual(-1);
    expect(huge).toBeLessThanOrEqual(1);
  });

  it('datan2: absolute error <= 4e-15, same special cases as Math.atan2', () => {
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const y = i % 3 === 0 ? u(-1, 1) : u(-1e3, 1e3);
      const x = i % 5 === 0 ? u(-1e-3, 1e-3) : u(-1e3, 1e3);
      worst = Math.max(worst, Math.abs(datan2(y, x) - Math.atan2(y, x)));
    }
    expect(worst).toBeLessThanOrEqual(4e-15);
    const specials = [0, -0, 1, -1, Infinity, -Infinity, NaN, 5e-324, 1e300];
    for (const y of specials) {
      for (const x of specials) {
        const a = datan2(y, x);
        const b = Math.atan2(y, x);
        if (b !== b) expect(a).toBeNaN();
        else expect(Math.abs(a - b), `atan2(${y}, ${x})`).toBeLessThanOrEqual(4e-15);
        if (b === 0) expect(Object.is(a, b), `sign of atan2(${y}, ${x})`).toBe(true);
      }
    }
  });

  it('dexp and dlog: relative error <= 4e-15', () => {
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const e = i % 2 === 0 ? u(-745, 709) : u(-5, 5);
      worst = Math.max(worst, Math.abs(dexp(e) - Math.exp(e)) / Math.exp(e));
      const l = Math.pow(10, u(-320, 308));
      const ref = Math.log(l);
      worst = Math.max(worst, Math.abs(dlog(l) - ref) / Math.abs(ref));
    }
    expect(worst).toBeLessThanOrEqual(4e-15);
    expect(dexp(710)).toBe(Infinity);
    expect(dexp(-746)).toBe(0);
    expect(dlog(0)).toBe(-Infinity);
    expect(dlog(-1)).toBeNaN();
    expect(dlog(1)).toBe(0);
  });

  it('dpow: relative error <= 1e-13; integer exponents are repeated squaring', () => {
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const x = u(0.01, 20);
      const y = u(-5, 5);
      if (Math.abs(y * Math.log(x)) <= 50) worst = Math.max(worst, Math.abs(dpow(x, y) / Math.pow(x, y) - 1));
      const n = Math.trunc(u(-64, 64));
      const b = u(-4, 4);
      if (b !== 0) worst = Math.max(worst, Math.abs(dpow(b, n) / Math.pow(b, n) - 1));
    }
    expect(worst).toBeLessThanOrEqual(1e-13);
    expect(dpow(2, 10)).toBe(1024);
    expect(dpow(-2, 3)).toBe(-8);
    expect(dpow(-2, 0.5)).toBeNaN();
    expect(dpow(5, 0)).toBe(1);
    expect(dpow(0, -1)).toBe(Infinity);
    expect(Object.is(dpow(-0, 3), -0)).toBe(true);
  });

  it('dhypot: relative error <= 4e-16 * 2 and no overflow', () => {
    let worst = 0;
    for (let i = 0; i < N; i++) {
      const x = u(-1e3, 1e3);
      const y = u(-1e3, 1e3);
      worst = Math.max(worst, Math.abs(dhypot(x, y) / Math.hypot(x, y) - 1));
    }
    expect(worst).toBeLessThanOrEqual(8e-16);
    expect(Math.abs(dhypot(3e200, 4e200) / 5e200 - 1)).toBeLessThanOrEqual(8e-16);
    expect(dhypot(Infinity, NaN)).toBe(Infinity);
    expect(dhypot(0, 0)).toBe(0);
  });

  it('normalizeAngle wraps to [-pi, pi) and lerpAngle takes the short arc', () => {
    for (let i = 0; i < 2000; i++) {
      const a = u(-100, 100);
      const r = normalizeAngle(a);
      expect(r).toBeGreaterThanOrEqual(-PI);
      expect(r).toBeLessThan(PI);
      expect(Math.abs(Math.sin(r) - Math.sin(a))).toBeLessThan(1e-12);
      expect(Math.abs(Math.cos(r) - Math.cos(a))).toBeLessThan(1e-12);
    }
    expect(normalizeAngle(PI)).toBe(-PI);
    expect(normalizeAngle(TWO_PI)).toBeCloseTo(0, 12);
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(3 + (normalizeAngle(-6) * 0.5), 12);
    expect(Math.abs(normalizeAngle(lerpAngle(3.1, -3.1, 0.5)))).toBeGreaterThan(3);
  });
});
