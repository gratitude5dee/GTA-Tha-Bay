import { describe, expect, it } from 'vitest';
import { MediaBudget } from '../../src/platform/media/media-budget.ts';

const MB = 1024 * 1024;

describe('MediaBudget (AC-3)', () => {
  it('refuses a third clip with reason budget and reports the sum of the two renditions', () => {
    const seen: number[] = [];
    const b = new MediaBudget({ maxMediaMB: 64, sink: (mb) => seen.push(mb) });
    expect(b.prepare('a', 3 * MB)).toEqual({ ok: true, slot: 'decoding' });
    expect(b.prepare('b', 5 * MB)).toEqual({ ok: true, slot: 'preroll' });
    expect(b.prepare('c', 1 * MB)).toEqual({ ok: false, reason: 'budget' });
    expect(b.bytes()).toBe(8 * MB);
    expect(b.mediaMB()).toBe(8);
    expect(seen.at(-1)).toBe(8);
  });

  it('promotes the pre-rolled clip when the decoding one ends, then accepts a new pre-roll', () => {
    const b = new MediaBudget({ maxMediaMB: null });
    b.prepare('a', MB);
    b.prepare('b', MB);
    b.release('a');
    expect(b.held()).toEqual(['b']);
    expect(b.prepare('c', MB)).toEqual({ ok: true, slot: 'preroll' });
    b.release('missing');
    expect(b.held()).toEqual(['b', 'c']);
  });

  it('refuses a clip that would cross the media line of the tier', () => {
    const b = new MediaBudget({ maxMediaMB: 10 });
    expect(b.prepare('a', 6 * MB).ok).toBe(true);
    expect(b.prepare('b', 6 * MB)).toEqual({ ok: false, reason: 'budget' });
    expect(b.held()).toEqual(['a']);
  });

  it('prepare is idempotent for a clip that is already held', () => {
    const b = new MediaBudget({ maxMediaMB: null });
    b.prepare('a', MB);
    expect(b.prepare('a', MB)).toEqual({ ok: true, slot: 'decoding' });
    expect(b.bytes()).toBe(MB);
  });
});
