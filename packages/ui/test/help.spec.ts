import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@dv/shared';
import { ERROR_TOPIC, GUIDE, helpText, topicIds } from '../src/pages/help.tsx';
import { ERROR_KINDS } from '../src/pages/system.tsx';
import en from '../../../content/ui/i18n/en.json';

const cat = en as Record<string, string>;

describe('help (AC-10)', () => {
  it('the guide has the eight groups of 4.4 and every title and step is in the catalog', () => {
    expect(GUIDE.version).toBe(1);
    expect(GUIDE.groups.map((g) => g.id)).toEqual(['install', 'performance', 'graphics', 'audio', 'controls', 'saves', 'vr', 'online']);
    for (const g of GUIDE.groups) {
      expect(cat[g.title], g.title).toBeTypeOf('string');
      expect(g.topics.length).toBeGreaterThan(0);
      for (const topic of g.topics) {
        expect(cat[topic.title], topic.title).toBeTypeOf('string');
        expect(topic.steps.length).toBeGreaterThan(0);
        for (const s of topic.steps) expect(cat[s], s).toBeTypeOf('string');
      }
    }
    expect(new Set(topicIds()).size).toBe(topicIds().length);
  });

  it('every error-page kind maps to an existing help topic', () => {
    for (const kind of ERROR_KINDS) expect(topicIds(), kind).toContain(ERROR_TOPIC[kind]);
    expect(Object.keys(ERROR_TOPIC).sort()).toEqual([...ERROR_KINDS].sort());
  });

  it('sources cite only listed URLs (none are cited yet)', () => {
    expect(GUIDE.sources).toEqual([]);
  });

  it('a stale translation falls back to English; a current one is used', () => {
    const key = 'help.audio.silent.title';
    const english = cat[key]!;
    const cats = { en: cat, fr: { [key]: 'Pas de son' } };
    const current = { [key]: sha256Hex(english).slice(0, 12) };
    expect(helpText(key, 'fr', cats, current)).toBe('Pas de son');
    expect(helpText(key, 'fr', cats, { [key]: 'deadbeef0000' })).toBe(english);
    expect(helpText(key, 'fr', cats, {})).toBe(english);
    expect(helpText(key, 'fr-CA', cats, current)).toBe('Pas de son');
    expect(helpText(key, 'en', cats)).toBe(english);
    expect(helpText('help.nope', 'fr', cats, {})).toBe('help.nope');
  });
});
