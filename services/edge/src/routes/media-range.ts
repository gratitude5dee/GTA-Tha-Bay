/**
 * Range handling of the media route (M01d3, DL-713 amendment). Two pure steps: parse the header without a size, then
 * apply the size the one bucket `get` returned. Only a single `bytes=a-b`, `bytes=a-` or `bytes=-n` is served; every
 * multi-range request is rejected (DL-109).
 */

/** The `R2Range` shapes the binding takes. */
export type RangeSpec = { offset: number; length?: number } | { suffix: number };

export interface ServedRange {
  start: number;
  end: number;
  length: number;
}

/** One `bytes=a-b`, `bytes=a-` or `bytes=-n`; null for anything else. The unit is case-insensitive and the value is trimmed. */
export function parseRangeHeader(value: string): RangeSpec | null {
  const m = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!m) return null;
  const [, a = '', b = ''] = m;
  if (a === '' && b === '') return null;
  if (a === '') {
    const n = Number(b);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    return { suffix: n };
  }
  const start = Number(a);
  if (!Number.isSafeInteger(start)) return null;
  if (b === '') return { offset: start };
  const end = Number(b);
  if (!Number.isSafeInteger(end) || end < start) return null;
  return { offset: start, length: end - start + 1 };
}

/** The bytes served for `spec` against an object of `size` bytes (RFC 9110 clamping); null when unsatisfiable. */
export function servedRange(spec: RangeSpec, size: number): ServedRange | null {
  if (size <= 0) return null;
  if ('suffix' in spec) {
    const length = Math.min(spec.suffix, size);
    return { start: size - length, end: size - 1, length };
  }
  if (spec.offset >= size) return null;
  const end = spec.length === undefined ? size - 1 : Math.min(spec.offset + spec.length - 1, size - 1);
  return { start: spec.offset, end, length: end - spec.offset + 1 };
}
