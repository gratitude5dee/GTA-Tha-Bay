/** AC-4 / T-03: the determinism lint rejects the banned math in the tycoon directory, and the real tycoon source is clean. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { SIM_FILES, SIM_IGNORES, determinismConfig } from '../../../../config/eslint/determinism.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');

function makeEslint(): ESLint {
  return new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [{ files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } }, determinismConfig(SIM_FILES, SIM_IGNORES)],
  });
}

describe('tycoon.nolint', () => {
  it('Math.pow, Math.random, ** and Date each report an error in a copy of the fixture under packages/shared/src/tycoon', async () => {
    const text = readFileSync(path.join(here, '__fixtures__', 'banned-math.ts.txt'), 'utf8');
    const [r] = await makeEslint().lintText(text, { filePath: path.join(here, 'banned-math.ts') });
    const messages = (r?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.message);
    expect(messages.some((m) => m.includes('Math.pow is not allowed'))).toBe(true);
    expect(messages.some((m) => m.includes('Math.random is not allowed'))).toBe(true);
    expect(messages.some((m) => m.includes('The ** operator'))).toBe(true);
    expect(messages.some((m) => m.includes('Date is not allowed'))).toBe(true);
  });

  it('the real packages/shared/src/tycoon/** reports no error', async () => {
    const results = await makeEslint().lintFiles(['packages/shared/src/tycoon/**/*.ts']);
    const errors = results.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => `${path.relative(repoRoot, r.filePath)}:${m.line} ${m.message}`));
    expect(errors).toEqual([]);
    expect(results.some((r) => r.filePath.endsWith(path.join('tycoon', 'step.ts')))).toBe(true);
  });
});
