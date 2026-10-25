import { describe, expect, it } from 'vitest';
import { parseRangeHeader, servedRange, type RangeSpec } from '../src/routes/media-range.ts';

describe('parseRangeHeader', () => {
  it.each<[string, RangeSpec]>([
    ['bytes=0-9', { offset: 0, length: 10 }],
    ['bytes=15-', { offset: 15 }],
    ['bytes=-5', { suffix: 5 }],
    ['Bytes=0-0', { offset: 0, length: 1 }],
    [' bytes=3-4 ', { offset: 3, length: 2 }],
  ])('accepts %s', (value, expected) => {
    expect(parseRangeHeader(value)).toEqual(expected);
  });

  it.each([
    'bytes=0-1,4-5',
    'bytes=0-1, 4-5',
    'bytes=0-1,',
    'items=0-1',
    'bytes=',
    'bytes=-',
    'bytes=-0',
    'bytes=5-2',
    'bytes=1e3-',
    'bytes=0x10-',
    'bytes=9007199254740993-',
    '',
  ])('rejects %j', (value) => {
    expect(parseRangeHeader(value)).toBeNull();
  });
});

describe('servedRange against a 20-byte object', () => {
  it.each<[RangeSpec, number, number, number]>([
    [{ offset: 0, length: 10 }, 0, 9, 10],
    [{ offset: 15 }, 15, 19, 5],
    [{ suffix: 5 }, 15, 19, 5],
    [{ suffix: 50 }, 0, 19, 20],
    [{ offset: 0, length: 100 }, 0, 19, 20],
  ])('%j serves %i-%i', (spec, start, end, length) => {
    expect(servedRange(spec, 20)).toEqual({ start, end, length });
  });

  it('is unsatisfiable at or past the end, and for an empty object', () => {
    expect(servedRange({ offset: 20 }, 20)).toBeNull();
    expect(servedRange({ offset: 25, length: 2 }, 20)).toBeNull();
    expect(servedRange({ suffix: 5 }, 0)).toBeNull();
    expect(servedRange({ offset: 0 }, 0)).toBeNull();
  });
});
