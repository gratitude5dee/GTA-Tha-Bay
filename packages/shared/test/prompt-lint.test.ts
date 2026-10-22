import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '../src/npc/parse.ts';
import { CLOSED_SLOT_SOURCES, PROMPT_MAX_CHARS, lintPrompt, slotBase, templateSlots, type PromptBanned, type PromptLintCtx } from '../src/genai/prompt-lint.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as T;
const denylist = readJson<PromptLintCtx['denylist']>('config/ip-denylist.json');
const banned = readJson<PromptBanned>('config/prompt-banned.json');
const registry = readJson<{ endpoints: Record<string, { id: string; pinnedUpdatedAt: string | null }> }>('config/genai-endpoints.json');

const CLAUSE = 'No text, no letters, no logos.';
const ctx = (over: Partial<PromptLintCtx> = {}): PromptLintCtx => ({
  names: ['Jordan Quillfeather', 'JQ the Gate'],
  denylist,
  banned,
  cast: [{ id: 'npc_test', tier: 'fictionalized' }],
  ...over,
});
const clean = `A cel-shaded plaza at dusk, a crowd waits at the edges. A person in a gray jumpsuit walks toward the camera. ${CLAUSE}`;

describe('lintPrompt', () => {
  it('passes a clean prompt', () => {
    const r = lintPrompt(clean, ctx());
    expect(r).toEqual({ ok: true, rules: [], failures: [] });
  });

  it('rule 1: a registry name or alias, in any case and with separators', () => {
    expect(lintPrompt(`${clean} Jordan Quillfeather waves.`, ctx()).rules).toEqual([1]);
    expect(lintPrompt(`${clean} jordan-quillfeather waves.`, ctx()).rules).toEqual([1]);
    expect(lintPrompt(`${clean} The jq the gate sign.`, ctx()).rules).toEqual([1]);
    // the failure never repeats the name
    expect(JSON.stringify(lintPrompt(`${clean} Jordan Quillfeather`, ctx()))).not.toMatch(/quillfeather/i);
  });

  it('rule 1: a denylist term and "in the style of"', () => {
    expect(lintPrompt(`${clean} Like Rockstar.`, ctx()).rules).toEqual([1]);
    expect(lintPrompt(`${clean} In the style of a famous painter.`, ctx()).rules).toEqual([1]);
    expect(lintPrompt(`${clean} In the manner of a famous painter.`, ctx()).rules).toEqual([1]);
  });

  it('rule 2: banned vocabulary, whole words only', () => {
    const r = lintPrompt(`${clean} He holds a pistol.`, ctx());
    expect(r.rules).toEqual([2]);
    expect(r.failures[0]?.detail).toContain('pistol');
    expect(lintPrompt(`${clean} A gory scene.`, ctx()).rules).toEqual([2]);
    expect(lintPrompt(`${clean} Someone is killing time.`, ctx()).rules).toEqual([2]);
    expect(lintPrompt(`${clean} A sexy car.`, ctx()).rules).toEqual([2]);
    expect(lintPrompt(`${clean} Tumbleweeds roll by, sussex, assessment.`, ctx()).ok).toBe(true);
  });

  it('rule 3: realism tokens only with a non-consented cast', () => {
    const text = `${clean} Photorealistic, shot on a Kodak Portra film stock.`;
    expect(lintPrompt(text, ctx()).rules).toEqual([3]);
    expect(lintPrompt(text, ctx({ cast: [{ id: 'c', tier: 'original' }] })).rules).toEqual([3]);
    expect(lintPrompt(text, ctx({ cast: [{ id: 'c', tier: 'consented' }] })).ok).toBe(true);
    expect(lintPrompt(text, ctx({ cast: [] })).ok).toBe(true);
  });

  it('rule 4: a slot filled from outside its closed source', () => {
    const good = [{ slot: 'place_desc', source: 'places' }, { slot: 'subject_brief_2', source: 'soul-visual-brief' }, { slot: 'action_1', source: 'ref-slots' }];
    expect(lintPrompt(clean, ctx({ slots: good })).ok).toBe(true);
    const r = lintPrompt(clean, ctx({ slots: [{ slot: 'place_desc', source: 'player-input' }] }));
    expect(r.rules).toEqual([4]);
    expect(lintPrompt(clean, ctx({ slots: [{ slot: 'secret_slot', source: 'ref-slots' }] })).rules).toEqual([4]);
  });

  it('rule 4: a protagonist or user-NPC reference, and the length cap', () => {
    expect(lintPrompt(clean, ctx({ cast: [{ id: 'player', tier: 'original', protected: true }] })).rules).toEqual([4]);
    const long = `${'a calm street. '.repeat(100)}${CLAUSE}`;
    expect([...long].length).toBeGreaterThan(PROMPT_MAX_CHARS);
    expect(lintPrompt(long, ctx()).rules).toEqual([4]);
    const atCap = `${'x'.repeat(PROMPT_MAX_CHARS - CLAUSE.length - 1)} ${CLAUSE}`;
    expect([...atCap].length).toBe(PROMPT_MAX_CHARS);
    expect(lintPrompt(atCap, ctx()).ok).toBe(true);
  });

  it('rule 5: the "no text, no logos" clause', () => {
    expect(lintPrompt('A cel-shaded plaza at dusk.', ctx()).rules).toEqual([5]);
    expect(lintPrompt('A cel-shaded plaza. No text and no logos anywhere.', ctx()).ok).toBe(true);
    expect(lintPrompt('A cel-shaded plaza. No logos. No text.', ctx()).rules).toEqual([5]);
  });

  it('rule 6: a template keyframePin that differs from the registry pin', () => {
    const pin = (template: string, reg: string): PromptLintCtx => ctx({ keyframePin: { template, registry: reg } });
    expect(lintPrompt(clean, pin('a@1', 'a@1')).ok).toBe(true);
    expect(lintPrompt(clean, pin('a@1', 'a@2')).rules).toEqual([6]);
  });

  it('lists every failing rule once, ascending, and never throws', () => {
    const r = lintPrompt('Rockstar pistol photoreal', ctx());
    expect(r.rules).toEqual([1, 2, 3, 5]);
    expect(() => lintPrompt('', ctx({ names: [], cast: [] }))).not.toThrow();
  });
});

describe('slots', () => {
  it('slotBase drops a numeric suffix', () => {
    expect(slotBase('subject_brief_2')).toBe('subject_brief');
    expect(slotBase('place_desc')).toBe('place_desc');
  });
  it('templateSlots lists the placeholders once', () => {
    expect(templateSlots('{a_1} x {b}, {a_1} {c_2}')).toEqual(['a_1', 'b', 'c_2']);
  });
});

describe('the two story templates', () => {
  const keyframe = registry.endpoints['openai/gpt-image-2.5/sunburst/edit'];
  const registryPin = `${keyframe?.id}@${keyframe?.pinnedUpdatedAt ?? 'unpinned'}`;

  for (const name of ['story.establish@1', 'story.beat@1']) {
    const text = readFileSync(path.join(root, `content/prompts/genai/${name}.md`), 'utf8');
    const { yaml, body } = splitFrontmatter(text);
    const front = parseYaml(yaml) as { id: string; version: number; slots: string[]; keyframePin: string; style: string; aspect: string; resolution: string };
    const slots = templateSlots(body).map((s) => ({ slot: s, source: CLOSED_SLOT_SOURCES[slotBase(s)] ?? 'unknown' }));

    it(`${name} passes with a fictionalized cast`, () => {
      const r = lintPrompt(body, ctx({ slots, keyframePin: { template: front.keyframePin, registry: registryPin } }));
      expect(r.failures).toEqual([]);
      expect(front.aspect).toBe('16:9');
      expect(front.resolution).toBe('768P');
    });

    it(`${name} declares exactly the slots its body uses, all closed`, () => {
      expect([...front.slots].sort()).toEqual(templateSlots(body).sort());
      for (const s of front.slots) expect(CLOSED_SLOT_SOURCES[slotBase(s)], s).toBeDefined();
    });

    it(`${name} fails when its keyframePin differs from the registry`, () => {
      const r = lintPrompt(body, ctx({ keyframePin: { template: `${front.keyframePin}-old`, registry: registryPin } }));
      expect(r.rules).toEqual([6]);
    });
  }
});
