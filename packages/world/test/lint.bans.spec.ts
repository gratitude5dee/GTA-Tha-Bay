/**
 * AC-1: `packages/world/src/sim/**` is inside the C02 determinism lint globs and passes it, and the banned-API fixture, linted as if
 * it lived under `packages/world/src/sim/`, reports an error per banned API (`Math.random`, `Date`, a `three` import).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { SIM_FILES, SIM_IGNORES, determinismConfig } from '../../../config/eslint/determinism.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

function makeEslint(): ESLint {
  return new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [{ files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } }, determinismConfig(SIM_FILES, SIM_IGNORES)],
  });
}

describe('determinism lint over @dv/world (AC-1)', () => {
  it('has packages/world/src/sim/** among the sim globs', () => {
    expect(SIM_FILES).toContain('packages/world/src/sim/**/*.{ts,tsx}');
  });

  it('reports Math.random, Date and a three import in the fixture linted at a sim path', async () => {
    const text = readFileSync(path.join(here, 'fixtures', 'banned', 'sim-bans.ts'), 'utf8');
    const [res] = await makeEslint().lintText(text, { filePath: path.join(repoRoot, 'packages', 'world', 'src', 'sim', 'streaming', '__fixture__.ts') });
    const errors = (res?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.message);
    expect(errors.some((m) => m.includes('Math.random is not allowed'))).toBe(true);
    expect(errors.some((m) => m.includes('Date is not allowed'))).toBe(true);
    expect(errors.some((m) => m.includes('three is not allowed'))).toBe(true);
  });

  it('the same fixture outside the sim globs (packages/world/src/client) is not subject to the sim rules', async () => {
    const text = readFileSync(path.join(here, 'fixtures', 'banned', 'sim-bans.ts'), 'utf8');
    const [res] = await makeEslint().lintText(text, { filePath: path.join(repoRoot, 'packages', 'world', 'src', 'client', '__fixture__.ts') });
    expect((res?.messages ?? []).filter((m) => m.severity === 2)).toEqual([]);
  });

  it('the world sim source itself is clean', async () => {
    const results = await makeEslint().lintFiles(['packages/world/src/sim']);
    expect(results.length).toBeGreaterThan(5);
    const errors = results.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => `${path.relative(repoRoot, r.filePath)}:${m.line} ${m.message}`));
    expect(errors).toEqual([]);
  });

  it('world sim tsconfig is in the root typecheck chain', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { scripts: { typecheck: string } };
    expect(pkg.scripts.typecheck).toContain('tsc -p packages/world/tsconfig.sim.json --noEmit');
  });
});
