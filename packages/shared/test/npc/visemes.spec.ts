import { describe, expect, it } from 'vitest';
import { ATLAS_ORDER, atlasCell, cueAt, parseRhubarb, shapeFromEnvelope, shapesOf, visemesFromAlignment, vowelDensity } from '../../src/npc/visemes.ts';

// M06a4 AC-6 (second half): the viseme mapper turns the fixture alignment strings into the expected Rhubarb shape sequences.

/** An alignment with 50 ms per character, the way ElevenLabs reports it. */
function align(chars: string, perCharS = 0.05): { chars: string; startS: number[]; endS: number[] } {
  const startS: number[] = [];
  const endS: number[] = [];
  Array.from(chars).forEach((_, i) => {
    startS.push(+(i * perCharS).toFixed(3));
    endS.push(+((i + 1) * perCharS).toFixed(3));
  });
  return { chars, startS, endS };
}

describe('visemesFromAlignment', () => {
  const FIXTURES: [string, string][] = [
    // h is skipped; i -> B; space -> X
    ['hi', 'B'],
    // b -> A, r -> B, o -> E
    ['bro', 'ABE'],
    // th -> H, a -> D, n -> B, k -> B (merged with n), s -> B (merged), then X, then y -> B ... "thanks you"
    ['mama', 'ADAD'],
    // "oo" is one puckered sound, a silent final e adds nothing
    ['moon', 'AFB'],
    ['bake', 'ADB'],
    // sh -> F, doubled l is one sound
    ['shell', 'FCH'],
    // words are separated by a closed mouth
    ['go on', 'BEXEB'],
    // ph -> G
    ['phone', 'GEB'],
  ];

  it.each(FIXTURES)('turns %j into %s', (text, shapes) => {
    expect(shapesOf(visemesFromAlignment(align(text)))).toBe(shapes);
  });

  it('carries the start and end of the first and last character of a group', () => {
    const cues = visemesFromAlignment(align('moon', 0.1));
    // m 0..0.1, oo 0.1..0.3, n 0.3..0.4
    expect(cues).toEqual([
      { start: 0, end: 0.1, shape: 'A' },
      { start: 0.1, end: 0.3, shape: 'F' },
      { start: 0.3, end: 0.4, shape: 'B' },
    ]);
  });

  it('merges neighbours with the same shape into one cue', () => {
    const cues = visemesFromAlignment(align('stk', 0.1));
    expect(cues).toEqual([{ start: 0, end: 0.3, shape: 'B' }]);
  });

  it('survives uneven arrays, capitals, digits and astral characters', () => {
    expect(visemesFromAlignment({ chars: 'ABC', startS: [0], endS: [0.1] })).toHaveLength(1);
    expect(shapesOf(visemesFromAlignment(align('BRO 2U')))).toBe('ABEXF');
    expect(() => visemesFromAlignment(align('hey \u{1F600} you'))).not.toThrow();
    expect(visemesFromAlignment({ chars: '', startS: [], endS: [] })).toEqual([]);
  });
});

describe('the envelope mapper (t1)', () => {
  it('maps loudness to X, A, B, C, D', () => {
    expect(shapeFromEnvelope(0, 0.3, 0)).toBe('X');
    expect(shapeFromEnvelope(0.03, 0.3, 0)).toBe('A');
    expect(shapeFromEnvelope(0.1, 0.3, 0)).toBe('B');
    expect(shapeFromEnvelope(0.2, 0.3, 0)).toBe('C');
    expect(shapeFromEnvelope(0.5, 0.3, 0)).toBe('D');
  });

  it('alternates the open shapes with E and F only for vowel-heavy text', () => {
    const run = (dens: number): string => [0, 1, 2, 3].map((step) => shapeFromEnvelope(0.5, dens, step)).join('');
    expect(run(0.3)).toBe('DDDD');
    expect(run(0.5)).toBe('DEDF');
  });

  it('treats a non-finite level as silence', () => {
    expect(shapeFromEnvelope(Number.NaN, 0.5, 1)).toBe('X');
  });

  it('counts vowels among letters', () => {
    expect(vowelDensity('')).toBe(0);
    expect(vowelDensity('1234')).toBe(0);
    expect(vowelDensity('aeio')).toBe(1);
    expect(vowelDensity('bcda')).toBe(0.25);
  });
});

describe('Rhubarb cues and the atlas', () => {
  it('parses the JSON export, sorts it and maps unknown values to X', () => {
    const cues = parseRhubarb({ mouthCues: [{ start: 0.2, end: 0.4, value: 'D' }, { start: 0, end: 0.2, value: 'A' }, { start: 0.4, end: 0.5, value: 'Z' }, { start: 'x' }] });
    expect(shapesOf(cues)).toBe('ADX');
    expect(parseRhubarb(null)).toEqual([]);
    expect(parseRhubarb({ mouthCues: 3 })).toEqual([]);
  });

  it('finds the shape at a time, X outside the cues', () => {
    const cues = parseRhubarb({ mouthCues: [{ start: 0, end: 0.2, value: 'A' }, { start: 0.2, end: 0.4, value: 'D' }] });
    expect(cueAt(cues, -1)).toBe('X');
    expect(cueAt(cues, 0)).toBe('A');
    expect(cueAt(cues, 0.199)).toBe('A');
    expect(cueAt(cues, 0.2)).toBe('D');
    expect(cueAt(cues, 0.4)).toBe('X');
  });

  it('lays the nine shapes on the 3x3 grid, row-major', () => {
    expect(ATLAS_ORDER).toHaveLength(9);
    expect(new Set(ATLAS_ORDER).size).toBe(9);
    expect(atlasCell('A')).toEqual({ col: 0, row: 0, index: 0 });
    expect(atlasCell('D')).toEqual({ col: 0, row: 1, index: 3 });
    expect(atlasCell('X')).toEqual({ col: 2, row: 2, index: 8 });
  });
});
