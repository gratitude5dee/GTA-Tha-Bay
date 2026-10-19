import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GENAI_GUARDRAILS } from '../../../packages/shared/src/genai/guardrails.generated.ts';
import { GENERATED_PATH, genaiSection, main, parseGuardrailsYaml, renderGenerated, YAML_PATH } from '../guardrails.ts';

describe('config/guardrails.yaml', () => {
  it('holds the DL-OWN-01 program cap, the fal concurrency and the alarm fractions', () => {
    const g = genaiSection(readFileSync(YAML_PATH, 'utf8'));
    expect(g).toEqual({ programCapUsdMicros: 100_000_000, falConcurrency: 2, alarms: [0.5, 0.8, 1] });
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
