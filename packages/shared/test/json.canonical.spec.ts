import { describe, expect, it } from 'vitest';
import { CanonicalizeError, Rng, canonicalize } from '../src/index.ts';

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

function build(order: string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {
    zebra: 1,
    alpha: { y: [3, { b: 2, a: 1 }], x: -0 },
    mid: 'text',
    '10': true,
    '2': null,
  };
  const o: Record<string, unknown> = {};
  for (const k of order) o[k] = values[k];
  return o;
}

describe('canonicalize', () => {
  it('is byte-identical for every key permutation (5! = 120), with -0 written as 0', () => {
    const keys = ['zebra', 'alpha', 'mid', '10', '2'];
    const outs = new Set(permutations(keys).map((p) => canonicalize(build(p))));
    expect(outs.size).toBe(1);
    const text = [...outs][0] as string;
    expect(text).toBe('{"10":true,"2":null,"alpha":{"x":0,"y":[3,{"a":1,"b":2}]},"mid":"text","zebra":1}');
    expect(text.includes('-0')).toBe(false);
  });

  it('formats like JSON.stringify and keeps array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize({ n: 1e21, m: 1.5, k: -2.5e-7, s: 'a"b\n ' })).toBe(JSON.stringify({ k: -2.5e-7, m: 1.5, n: 1e21, s: 'a"b\n ' }));
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(Object.assign(Object.create(null) as object, { b: 1, a: 2 }))).toBe('{"a":2,"b":1}');
    expect(canonicalize({})).toBe('{}');
    expect(canonicalize([])).toBe('[]');
  });

  it('random nested values canonicalize identically after key shuffling', () => {
    const rng = new Rng(99);
    const make = (depth: number): unknown => {
      const r = rng.nextU32() % 6;
      if (depth > 3 || r === 0) return rng.range(-5, 5);
      if (r === 1) return `s${rng.nextU32() % 100}`;
      if (r === 2) return Array.from({ length: rng.nextU32() % 4 }, () => make(depth + 1));
      const n = rng.nextU32() % 5;
      const keys = Array.from({ length: n }, (_, i) => `k${(i * 7 + (rng.nextU32() % 3)) % 11}`);
      return Object.fromEntries(keys.map((k) => [k, make(depth + 1)]));
    };
    const reorder = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(reorder);
      if (v && typeof v === 'object') {
        const entries = Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, reorder(x)] as const);
        for (let i = entries.length - 1; i > 0; i--) {
          const j = rng.nextU32() % (i + 1);
          [entries[i], entries[j]] = [entries[j] as (typeof entries)[number], entries[i] as (typeof entries)[number]];
        }
        return Object.fromEntries(entries);
      }
      return v;
    };
    for (let i = 0; i < 200; i++) {
      const v = make(0);
      expect(canonicalize(reorder(v))).toBe(canonicalize(v));
    }
  });

  const failing: [string, unknown, string][] = [
    ['NaN', { a: { b: [1, NaN] } }, '$.a.b[1]'],
    ['Infinity', { x: Infinity }, '$.x'],
    ['-Infinity', [0, -Infinity], '$[1]'],
    ['undefined in an object', { a: undefined }, '$.a'],
    ['undefined in an array', [1, undefined], '$[1]'],
    ['function', { f: () => 1 }, '$.f'],
    ['Date', { when: new Date(0) }, '$.when'],
    ['Map', new Map(), '$'],
    ['class instance', { p: new (class P { x = 1; })() }, '$.p'],
    ['typed array', { t: new Uint8Array(2) }, '$.t'],
    ['bigint', { n: 1n }, '$.n'],
    ['symbol', [Symbol('s')], '$[0]'],
    ['odd key path', { 'a b': { c: NaN } }, '$["a b"].c'],
  ];
  for (const [name, value, path] of failing) {
    it(`throws CanonicalizeError with the JSON path for ${name}`, () => {
      let err: unknown;
      try {
        canonicalize(value);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(CanonicalizeError);
      expect((err as CanonicalizeError).path).toBe(path);
      expect((err as CanonicalizeError).message).toContain(path);
    });
  }
});
