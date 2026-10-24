import { describe, expect, it } from 'vitest';
import type { VoiceTier } from '../../src/contracts/c10-npc.ts';
import { effectiveTier, type IdentityTier, type VoiceSetting, type VoiceTierInput } from '../../src/npc/voice-tier.ts';

// M06a4 AC-6: the 36-row table of 04-npc.md section 5.7, written as data. Columns: soul tier, player setting, identity, ks:tts:elevenlabs.
// The NPC is a hero with the clone consent in order, no governor level, no other switch and a voice_line left, so only the four columns decide.
// Rules read off the section: `off` is text; `heroes` keeps a hero; t2 and t3 are the ElevenLabs tiers, which need a linked identity and
// ks:tts:elevenlabs off, and fall back to t1 otherwise (never to text); t1 is not affected by either.
type Ks = 'on' | 'off';
type Row = [soul: VoiceTier, setting: VoiceSetting, identity: IdentityTier, ks: Ks, expected: VoiceTier];

const MATRIX: Row[] = [
  ['t1', 'all', 'p0', 'on', 't1'], ['t1', 'all', 'p0', 'off', 't1'], ['t1', 'all', 'linked', 'on', 't1'], ['t1', 'all', 'linked', 'off', 't1'],
  ['t1', 'heroes', 'p0', 'on', 't1'], ['t1', 'heroes', 'p0', 'off', 't1'], ['t1', 'heroes', 'linked', 'on', 't1'], ['t1', 'heroes', 'linked', 'off', 't1'],
  ['t1', 'off', 'p0', 'on', 'text'], ['t1', 'off', 'p0', 'off', 'text'], ['t1', 'off', 'linked', 'on', 'text'], ['t1', 'off', 'linked', 'off', 'text'],

  ['t2', 'all', 'p0', 'on', 't1'], ['t2', 'all', 'p0', 'off', 't1'], ['t2', 'all', 'linked', 'on', 't1'], ['t2', 'all', 'linked', 'off', 't2'],
  ['t2', 'heroes', 'p0', 'on', 't1'], ['t2', 'heroes', 'p0', 'off', 't1'], ['t2', 'heroes', 'linked', 'on', 't1'], ['t2', 'heroes', 'linked', 'off', 't2'],
  ['t2', 'off', 'p0', 'on', 'text'], ['t2', 'off', 'p0', 'off', 'text'], ['t2', 'off', 'linked', 'on', 'text'], ['t2', 'off', 'linked', 'off', 'text'],

  ['t3', 'all', 'p0', 'on', 't1'], ['t3', 'all', 'p0', 'off', 't1'], ['t3', 'all', 'linked', 'on', 't1'], ['t3', 'all', 'linked', 'off', 't3'],
  ['t3', 'heroes', 'p0', 'on', 't1'], ['t3', 'heroes', 'p0', 'off', 't1'], ['t3', 'heroes', 'linked', 'on', 't1'], ['t3', 'heroes', 'linked', 'off', 't3'],
  ['t3', 'off', 'p0', 'on', 'text'], ['t3', 'off', 'p0', 'off', 'text'], ['t3', 'off', 'linked', 'on', 'text'], ['t3', 'off', 'linked', 'off', 'text'],
];

const base = (over: Partial<VoiceTierInput> = {}): VoiceTierInput => ({
  soulTier: 't1',
  hero: true,
  setting: 'all',
  identity: 'p0',
  govLevel: 0,
  ksElevenlabs: false,
  ksTtsAll: false,
  ksVoice: false,
  voiceQuotaLeft: true,
  cloneConsent: true,
  ...over,
});

describe('effectiveTier, the 36-row table', () => {
  it('has 36 distinct rows', () => {
    expect(MATRIX).toHaveLength(36);
    expect(new Set(MATRIX.map((r) => r.slice(0, 4).join('|'))).size).toBe(36);
  });

  it.each(MATRIX)('soul %s, setting %s, identity %s, ks:tts:elevenlabs %s gives %s', (soul, setting, identity, ks, expected) => {
    expect(effectiveTier(base({ soulTier: soul, setting, identity, ksElevenlabs: ks === 'on' }))).toBe(expected);
  });
});

describe('effectiveTier, the other inputs', () => {
  it('gives text for a soul without a voice', () => {
    expect(effectiveTier(base({ soulTier: 'text', identity: 'linked' }))).toBe('text');
  });

  it('heroes setting gives text for an NPC that is not a hero, and keeps the tier for a hero', () => {
    expect(effectiveTier(base({ setting: 'heroes', hero: false }))).toBe('text');
    expect(effectiveTier(base({ setting: 'heroes', hero: true }))).toBe('t1');
    expect(effectiveTier(base({ setting: 'all', hero: false }))).toBe('t1');
  });

  it('ks:tts:all, the voice kill scope and an exhausted voice_line quota each give text, even for t1', () => {
    expect(effectiveTier(base({ ksTtsAll: true }))).toBe('text');
    expect(effectiveTier(base({ ksVoice: true }))).toBe('text');
    expect(effectiveTier(base({ voiceQuotaLeft: false }))).toBe('text');
  });

  it('governor level 2 caps a linked t2 hero at t1, level 1 does not', () => {
    const linkedT2 = { soulTier: 't2' as const, identity: 'linked' as const };
    expect(effectiveTier(base({ ...linkedT2, govLevel: 1 }))).toBe('t2');
    expect(effectiveTier(base({ ...linkedT2, govLevel: 2 }))).toBe('t1');
    expect(effectiveTier(base({ ...linkedT2, govLevel: 3 }))).toBe('t1');
  });

  it('t3 without an unexpired voice_clone consent speaks with the t1 voice', () => {
    expect(effectiveTier(base({ soulTier: 't3', identity: 'linked', cloneConsent: false }))).toBe('t1');
    expect(effectiveTier(base({ soulTier: 't3', identity: 'linked', cloneConsent: true }))).toBe('t3');
  });
});
