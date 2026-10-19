/**
 * AC-6: every fixture in test/fixtures/banned/ fails the determinism rules, together they cover every API in
 * C02 determinism rule 1, and the sim source itself is clean.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import {
  DOM_GLOBALS, SIM_FILES, SIM_IGNORES, TRANSCENDENTALS, determinismConfig,
} from '../../../config/eslint/determinism.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const fixtureDir = path.join(here, 'fixtures', 'banned');

// The determinism rules alone, applied to every .ts file given (the root config is not loaded).
function makeEslint(files: string[], ignores: string[] = []): ESLint {
  return new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [
      { ignores: ['**/*.gen.ts'] }, // generated code (packages/shared/src/npc/validators.gen.ts) is outside the C02 lint
      { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
      determinismConfig(files, ignores),
    ],
  });
}

const fixtureFiles = readdirSync(fixtureDir).filter((f) => f.endsWith('.ts')).sort();

describe('determinism lint bans (C02 rule 1, C01 rule 4)', () => {
  it('has one fixture per banned category', () => {
    expect(fixtureFiles).toEqual([
      'crypto-random.ts', 'date.ts', 'dom-globals.ts', 'for-in.ts', 'intl.ts', 'math-random.ts', 'math-transcendentals.ts',
      'performance-now.ts', 'pow-operator.ts', 'sort-no-comparator.ts', 'three-import.ts', 'timers.ts',
    ]);
  });

  it('every fixture reports at least one error, and together they cover every banned API', async () => {
    const eslint = makeEslint(['**/*.ts']);
    const results = await eslint.lintFiles(fixtureFiles.map((f) => path.join(fixtureDir, f)));
    const messages: string[] = [];
    for (const r of results) {
      const errors = r.messages.filter((m) => m.severity === 2);
      expect(errors.length, `${path.basename(r.filePath)} must report an error`).toBeGreaterThan(0);
      for (const m of errors) {
        expect(m.ruleId === 'no-restricted-properties' || m.ruleId === 'no-restricted-globals' || m.ruleId === 'no-restricted-syntax'
          || m.ruleId === 'no-restricted-imports', `${path.basename(r.filePath)}: unexpected rule ${String(m.ruleId)}: ${m.message}`).toBe(true);
        messages.push(m.message);
      }
    }
    const has = (text: string): boolean => messages.some((m) => m.includes(text));
    const missing: string[] = [];
    for (const name of TRANSCENDENTALS) if (!has(`Math.${name} is not allowed`)) missing.push(`Math.${name}`);
    for (const name of DOM_GLOBALS) if (!has(`DOM global ${name} `)) missing.push(`DOM global ${name}`);
    for (const text of [
      'performance.now is not allowed', 'crypto.getRandomValues is not allowed', 'toLocaleString is not allowed',
      'Date is not allowed', 'Intl is not allowed', 'setTimeout', 'setInterval', 'The ** operator', 'The **= operator',
      'for...in is not allowed', 'three is not allowed', 'sort() without a comparator',
    ]) if (!has(text)) missing.push(text);
    expect(missing).toEqual([]);
  });

  it('a total comparator is accepted, a missing one is not', async () => {
    const eslint = makeEslint(['**/*.ts']);
    const [ok] = await eslint.lintText('export const a = (x: number[]): number[] => x.sort((p, q) => p - q);\n', {
      filePath: path.join(fixtureDir, '__ok__.ts'),
    });
    expect(ok?.messages.filter((m) => m.severity === 2)).toEqual([]);
    const [bad] = await eslint.lintText('export const a = (x: number[]): number[] => x.sort();\n', {
      filePath: path.join(fixtureDir, '__bad__.ts'),
    });
    expect(bad?.messages.filter((m) => m.severity === 2).length).toBe(1);
  });

  it('the same rules report zero errors over the sim source (shared, engine sim, mode sim)', async () => {
    const eslint = makeEslint(SIM_FILES, SIM_IGNORES);
    const results = await eslint.lintFiles(['packages/shared/src', 'packages/engine/src/sim']);
    expect(results.length).toBeGreaterThan(20);
    const errors = results.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => `${path.relative(repoRoot, r.filePath)}:${m.line} ${m.message}`));
    expect(errors).toEqual([]);
  });
});
