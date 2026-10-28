import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GENAI_GUARDRAILS } from '../../../packages/shared/src/genai/guardrails.generated.ts';
import { NPC_GUARDRAILS } from '../../../packages/shared/src/genai/npc-guardrails.generated.ts';
import { GENERATED_PATH, NPC_GENERATED_PATH, genaiSection, main, npcSection, parseGuardrailsYaml, renderGenerated, renderNpcGenerated, YAML_PATH } from '../guardrails.ts';

describe('config/guardrails.yaml', () => {
  it('holds the DL-OWN-01 program cap, the fal concurrency and the alarm fractions', () => {
    const g = genaiSection(readFileSync(YAML_PATH, 'utf8'));
    expect(g).toEqual({
      programCapUsdMicros: 100_000_000, falConcurrency: 2, alarms: [0.5, 0.8, 1],
      lines: { spike: 4_000_000, characters: 42_000_000, cutscenes: 38_000_000, vehiclesProps: 14_000_000, buffer: 2_000_000 },
    });
  });

  it('keeps the DL-OWN-07 lines inside the program cap', () => {
    const g = genaiSection(readFileSync(YAML_PATH, 'utf8'));
    expect(Object.values(g.lines).reduce((n, v) => n + v, 0)).toBeLessThanOrEqual(g.programCapUsdMicros);
  });

  it('is mirrored exactly into the generated constant the Worker reads', () => {
    expect(readFileSync(GENERATED_PATH, 'utf8')).toBe(renderGenerated(genaiSection(readFileSync(YAML_PATH, 'utf8'))));
    expect(GENAI_GUARDRAILS.programCapUsdMicros).toBe(100_000_000);
    expect(main([])).toBe(0);
  });

  it('parses the subset it supports and rejects the rest', () => {
    expect(parseGuardrailsYaml('a:\n  b: 1 # note\n  c: [1, 2.5]\n  d: yes-no\n# x\ne: true\n')).toEqual({ a: { b: 1, c: [1, 2.5], d: 'yes-no' }, e: true });
    expect(() => parseGuardrailsYaml('a:\n   b: 1\n')).toThrow(/indent/);
    expect(() => parseGuardrailsYaml('- a\n')).toThrow(/key: value/);
    expect(() => genaiSection('genai:\n  programCapUsdMicros: 1.5\n  falConcurrency: 2\n  alarms: [1]\n')).toThrow(/integer/);
    expect(() => genaiSection('genai:\n  programCapUsdMicros: 5\n  falConcurrency: 2\n  alarms: [2]\n')).toThrow(/fractions/);
    expect(() => genaiSection('other:\n  a: 1\n')).toThrow(/genai/);
  });
});

describe('config/guardrails.yaml npc section (M06a1)', () => {
  const text = readFileSync(YAML_PATH, 'utf8');

  it('holds the quota table of 09-backend-ops.md section 5.2', () => {
    const n = npcSection(text);
    expect(n.quotas.p0).toMatchObject({ turns: 150, perNpc: 40, voiceLines: 60, costCapUsdMicros: 50_000, builderText: 2, builderJob: 0 });
    expect(n.quotas.linked).toMatchObject({ turns: 400, perNpc: 40, voiceLines: 200, costCapUsdMicros: 150_000, builderText: 10, builderJob: 0 });
    expect(n.netMultiplier).toBe(4);
    expect(n.playTokensPerNet).toBe(50);
    expect(n.signupsPerNet).toBe(3);
    expect(n.encounter).toMatchObject({ turnCap: 12, turnCapHard: 20, cadenceMs: 1500, idleCloseMs: 60_000, firstTokenMs: 4000 });
  });

  it('is mirrored exactly into the generated constant the Worker reads', () => {
    expect(readFileSync(NPC_GENERATED_PATH, 'utf8')).toBe(renderNpcGenerated(npcSection(text)));
    expect(NPC_GUARDRAILS.quotas.p0.turns).toBe(150);
  });

  it('rejects a missing or malformed section', () => {
    expect(() => npcSection('genai:\n  a: 1\n')).toThrow(/npc section/);
    expect(() => npcSection(text.replace('turns: 150', 'turns: 1.5'))).toThrow(/npc.quotas.p0.turns/);
    expect(() => npcSection(text.replace('turnCap: 12', 'turnCap: 30'))).toThrow(/turnCapHard/);
  });
});
