import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileStringMatcher } from '../../src/assets/gates/ip.ts';
import { lintBuilderSoul, type BuilderLintEnv } from '../../src/npc/builder-lint.ts';
import { compileSoul } from '../../src/npc/compile.ts';
import { parseSoul } from '../../src/npc/parse.ts';
import { assembleSoul, cleanSectionText, deriveInk, writeSoulMd, type BuilderServerFields, type LlmSoul } from '../../src/npc/soul-write.ts';
import { validateSoulLlm } from '../../src/npc/validate.ts';
import { fixtureDir, readText, repoRoot, rulesBlock } from './helpers/souls.ts';

// M06b1 AC-8 (unit half): a recorded generation output assembles into the golden soul.md bytes, the result passes the builder lints (L1, L2, L3, L5, L6,
// L12), and the same inputs give the same bytes.
const llm = JSON.parse(readFileSync(path.join(fixtureDir, 'builder-llm-output.json'), 'utf8')) as LlmSoul;
const GOLDEN = path.join(fixtureDir, 'builder-soul.golden.md');
const OWNER = '0198a000-0000-7000-8000-000000000001';

const server: BuilderServerFields = {
  npcId: 'u_tomasa4d2f9c1a',
  soulVersion: 1,
  ownerProfileId: OWNER,
  name: 'Tomasa Quill',
  archetype: 'vendor',
  tags: ['street-food', 'night-owl'],
  district: 'mission',
  voiceRef: 'voice/aura-luna',
  heightM: 1.7,
  model: 'claude-sonnet-5-5',
  date: '2026-10-24',
};

const env = (over: Partial<BuilderLintEnv> = {}): BuilderLintEnv => ({
  pois: new Set(['poi.mission.24th-st.apt-ro', 'poi.mission.shop-batista']),
  goals: new Set((JSON.parse(readText('config/npc-goals.json')) as { goals: { id: string }[] }).goals.map((g) => g.id)),
  knownNames: new Map(),
  realMatchers: [],
  strings: compileStringMatcher(JSON.parse(readText('config/ip-denylist.json'))),
  ...over,
});

const written = (): string => {
  const { front, sections } = assembleSoul(server, llm);
  return writeSoulMd(front, sections);
};

describe('builder soul writer', () => {
  it('the recorded model output fits the generated LLM schema', () => {
    expect(validateSoulLlm(llm)).toEqual([]);
  });

  it('writes the golden soul.md bytes', () => {
    expect(written()).toBe(readFileSync(GOLDEN, 'utf8'));
  });

  it('writes the same bytes twice, and the file parses back to the same frontmatter and sections', () => {
    expect(written()).toBe(written());
    const { front, sections } = assembleSoul(server, llm);
    const parsed = parseSoul(written());
    expect(parsed.front).toEqual(front);
    expect(parsed.sections['Identity']).toBe(sections['Identity']);
    expect(parsed.headings).toEqual(['Identity', 'Voice', 'Personality', 'Knowledge', 'Places and schedule', 'Rails', 'Example lines']);
  });

  it('passes the schema and lints L1, L2, L3, L5, L6 and L12', () => {
    const r = lintBuilderSoul(written(), env());
    expect(r.issues).toEqual([]);
    expect(r.front?.origin).toBe('user');
  });

  it('compiles into a prompt wrapped as an untrusted character sheet', () => {
    const c = compileSoul(written(), rulesBlock());
    expect(c.promptTxt).toContain('<character_sheet origin="user" trust="untrusted">');
    expect(c.compiled.tier).toBe('fictionalized');
    expect(c.compiled.id).toBe(server.npcId);
  });

  it('reports each broken rule by its own id', () => {
    const base = written();
    expect(lintBuilderSoul(base, env({ pois: new Set(['poi.mission.24th-st.apt-ro']) })).issues.map((i) => i.rule)).toEqual(['L2']);
    expect(lintBuilderSoul(base, env({ knownNames: new Map([['tomasaquill', 'npc_other']]) })).issues.map((i) => i.rule)).toEqual(['L3']);
    expect(lintBuilderSoul(base, env({ goals: new Set(['work']) })).issues.map((i) => i.rule)).toEqual(['L13', 'L13']);
    const gap = base.replace('to: "09:00"', 'to: "08:00"');
    expect(lintBuilderSoul(gap, env()).issues.map((i) => i.rule)).toContain('L1');
    const phone = base.replace('Still hot, still honest.', 'Call 415-555-0134 for tamales');
    expect(lintBuilderSoul(phone, env()).issues.map((i) => i.rule)).toContain('L6');
    const style = base.replace('tired but amused eyes', 'tired eyes, drawn in the style of a famous cartoon');
    expect(lintBuilderSoul(style, env()).issues.map((i) => i.rule)).toContain('L12');
    const fewer = base.replace(/\[threat\].*\n/, '');
    expect(lintBuilderSoul(fewer, env()).issues.map((i) => i.rule)).toEqual(['L5']);
  });

  it('stops at the schema: a broken file reports only schema issues', () => {
    const bad = written().replace('tier: fictionalized', 'tier: parody');
    const rules = lintBuilderSoul(bad, env()).issues.map((i) => i.rule);
    expect(rules.length).toBeGreaterThan(0);
    expect(new Set(rules)).toEqual(new Set(['schema']));
  });

  it('keeps a model-written heading from splitting a section', () => {
    expect(cleanSectionText('Line one\n## Rails\n  ### Deeper\nLine two  ')).toBe('Line one\nRails\nDeeper\nLine two');
    const sneaky: LlmSoul = { ...llm, sections: { ...llm.sections, voice: `${llm.sections.voice}\n## Backstory\nextra` } };
    const { front, sections } = assembleSoul(server, sneaky);
    expect(parseSoul(writeSoulMd(front, sections)).headings).toHaveLength(7);
  });

  it('derives the five fallback knots from the tagged example lines', () => {
    const { sections } = assembleSoul(server, llm);
    const ink = deriveInk(sections['Example lines'] as string);
    for (const knot of ['greeting', 'smalltalk', 'busy', 'deflect', 'farewell']) expect(ink).toContain(`=== ${knot} ===`);
    expect(ink).toContain("Hey, you look hungry. Steamer's still hot.");
    expect(ink).toContain('Not my business and not my steamer. Hungry?');
    expect(deriveInk(sections['Example lines'] as string)).toBe(ink);
  });

  it('is found where the golden says (the repository root helper agrees)', () => {
    expect(readFileSync(path.join(repoRoot, 'packages/shared/test/npc/fixtures/builder-soul.golden.md'), 'utf8')).toBe(written());
  });
});
