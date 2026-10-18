/**
 * Canonical JSON (M01a1). One byte string per value: object keys sorted by UTF-16 code unit, no whitespace,
 * `-0` written as `0`, numbers formatted by JSON.stringify. Used for save checksums, cache keys and content hashes.
 *
 * Rejected with CanonicalizeError (path in `$.a.b[0]` form): NaN, Infinity, undefined, functions, symbols, bigint,
 * and any object that is not a plain object or array (class instances, Map, Set, Date, typed arrays).
 */

export class CanonicalizeError extends Error {
  readonly path: string;
  constructor(path: string, reason: string) {
    super(`canonicalize: ${reason} at ${path}`);
    this.name = 'CanonicalizeError';
    this.path = path;
  }
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function child(path: string, key: string): string {
  return IDENT.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function write(value: unknown, path: string, out: string[]): void {
  if (value === null) {
    out.push('null');
    return;
  }
  switch (typeof value) {
    case 'string':
      out.push(JSON.stringify(value));
      return;
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalizeError(path, `non-finite number (${String(value)})`);
      out.push(value === 0 ? '0' : JSON.stringify(value));
      return;
    case 'undefined':
      throw new CanonicalizeError(path, 'undefined');
    case 'function':
      throw new CanonicalizeError(path, 'function');
    case 'symbol':
      throw new CanonicalizeError(path, 'symbol');
    case 'bigint':
      throw new CanonicalizeError(path, 'bigint');
    default:
      break;
  }
  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(',');
      if (!(i in value)) throw new CanonicalizeError(`${path}[${i}]`, 'sparse array hole');
      write(value[i], `${path}[${i}]`, out);
    }
    out.push(']');
    return;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonicalizeError(path, 'non-plain object');
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort(compareKeys);
  out.push('{');
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i] as string;
    if (i > 0) out.push(',');
    out.push(JSON.stringify(k), ':');
    write(obj[k], child(path, k), out);
  }
  out.push('}');
}

/** Deterministic JSON text for `value`. Throws CanonicalizeError for values JSON cannot represent exactly. */
export function canonicalize(value: unknown): string {
  const out: string[] = [];
  write(value, '$', out);
  return out.join('');
}
