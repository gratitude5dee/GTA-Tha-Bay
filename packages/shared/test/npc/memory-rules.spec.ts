import { describe, expect, it } from 'vitest';
import type { SummaryPatch } from '../../src/contracts/c10-npc.ts';
import { clampPatch, filterMemoryWrites, isReflectionEncounter, mergeSummary, quotesPlayer, type SummaryPatchX } from '../../src/npc/memory.ts';

// M06a4: the pure rules behind the memory writer and the summarize consumer.
const PLAYER = 'i will bring the red car back to the lot before midnight on friday I swear it';

describe('quotesPlayer', () => {
  it('flags more than 8 consecutive words of the player, ignoring case and punctuation', () => {
    expect(quotesPlayer('Player says: I will bring the red car back to the lot before midnight.', PLAYER)).toBe(true);
  });
  it('allows exactly 8 consecutive words', () => {
    expect(quotesPlayer('He vowed to i will bring the red car back there', PLAYER)).toBe(false);
  });
  it('allows a paraphrase', () => {
    expect(quotesPlayer('The player promised to return the car by Friday night.', PLAYER)).toBe(false);
  });
  it('is false for short texts', () => {
    expect(quotesPlayer('i will bring the red car', PLAYER)).toBe(false);
  });
});

describe('filterMemoryWrites', () => {
  it('keeps two writes, removes contact data, drops quotes, lifts a promise to importance 6', () => {
    const out = filterMemoryWrites(
      [
        { kind: 'player_fact', text: 'Reach the player at kai@example.com about the lot.', importance: 3 },
        { kind: 'promise', text: 'The player will return the car by Friday.', importance: 2 },
        { kind: 'event', text: 'the red car back to the lot before midnight on friday I swear it', importance: 5 },
      ],
      PLAYER,
    );
    expect(out).toEqual([
      { kind: 'player_fact', text: 'Reach the player at [removed] about the lot.', importance: 3 },
      { kind: 'promise', text: 'The player will return the car by Friday.', importance: 6 },
    ]);
  });

  it('drops a quoting write and keeps the next one inside the limit of two', () => {
    const out = filterMemoryWrites(
      [
        { kind: 'event', text: 'bring the red car back to the lot before midnight on friday', importance: 5 },
        { kind: 'event', text: 'The player cares about the red car.', importance: 4 },
        { kind: 'preference', text: 'Likes Fridays.', importance: 2 },
        { kind: 'preference', text: 'Likes lots.', importance: 2 },
      ],
      PLAYER,
    );
    expect(out.map((w) => w.text)).toEqual(['The player cares about the red car.', 'Likes Fridays.']);
  });

  it('drops a write that is empty after scrubbing and clamps importance', () => {
    expect(filterMemoryWrites([{ kind: 'event', text: '   ', importance: 5 }], undefined)).toEqual([]);
    expect(filterMemoryWrites([{ kind: 'event', text: 'ok', importance: 99 }], undefined)[0]?.importance).toBe(10);
    expect(filterMemoryWrites([{ kind: 'event', text: 'ok', importance: -4 }], undefined)[0]?.importance).toBe(1);
  });
});

const patch = (over: Partial<SummaryPatchX> = {}): SummaryPatchX => ({
  summaryUpdate: 'They met at the lot.',
  memories: [],
  affinityDelta: 0,
  trustDelta: 0,
  flagsPatch: {},
  soulVersion: 1,
  reflection: false,
  ...over,
});

describe('clampPatch and mergeSummary', () => {
  it('clamps the deltas to +-10 and the memories to 5', () => {
    const p = clampPatch(
      patch({
        affinityDelta: 40,
        trustDelta: -99,
        memories: Array.from({ length: 7 }, () => ({ kind: 'event' as const, text: 'x', importance: 3, gameTime: 1, source: 'summary' as const })),
      }),
    );
    expect(p.affinityDelta).toBe(10);
    expect(p.trustDelta).toBe(-10);
    expect(p.memories).toHaveLength(5);
  });

  it('appends by default and replaces with replaceSummary', () => {
    const cur = { affinity: 5, trust: 5, flags: {}, encounters: 2, summary: 'Old.', soul_version: 1 };
    expect(mergeSummary(cur, patch()).summary).toBe('Old. They met at the lot.');
    const replaced = mergeSummary(cur, patch({ summaryUpdate: 'Short.', replaceSummary: true }));
    expect(replaced.summary).toBe('Short.');
    expect(replaced.encounters).toBe(3);
  });

  it('keeps the summary within 1,200 characters', () => {
    const merged = mergeSummary(null, patch({ summaryUpdate: 'a'.repeat(1500) } as SummaryPatch));
    expect(merged.summary.length).toBe(1200);
  });

  it('every 10th encounter is a reflection encounter', () => {
    expect([0, 8, 9, 10, 18, 19].map(isReflectionEncounter)).toEqual([false, false, true, false, false, true]);
  });
});
