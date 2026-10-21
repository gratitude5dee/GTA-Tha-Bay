/**
 * M04d AC-6: every suite fails under each of its mutants and passes without them; a mutant that leaves its suite green makes
 * the check fail with "vacuous suite".
 */
import { describe, expect, it } from 'vitest';
import { assertKilled, loadMutant, mutantFiles, MUTANT_SUITES, type MutantModule, type MutantSuite } from '../mutants/harness.ts';

describe('mutant sets', () => {
  for (const suite of MUTANT_SUITES) {
    describe(suite.id, () => {
      const files = mutantFiles(suite.id);

      it('has at least two mutants', () => {
        expect(files.length).toBeGreaterThanOrEqual(2);
      });

      it('passes without a mutant', async () => {
        const r = await (suite as MutantSuite<unknown>).run(suite.base);
        expect(r.pass, r.detail).toBe(true);
      }, 120_000);

      for (const file of files) {
        it(`fails under ${file.split('/').pop()}`, async () => {
          const m = await loadMutant<unknown>(file);
          const r = await assertKilled(suite as MutantSuite<unknown>, m, file);
          expect(r.pass).toBe(false);
          console.log(`${suite.id}: '${m.description}' killed: ${r.detail}`);
        }, 120_000);
      }
    });
  }

  it('a fixture mutant that leaves its suite green fails with "vacuous suite"', async () => {
    const noop: MutantModule<unknown> = { description: 'does nothing', patch: (d) => d };
    for (const suite of MUTANT_SUITES) {
      await expect(assertKilled(suite as MutantSuite<unknown>, noop, 'noop')).rejects.toThrow(/vacuous suite/);
    }
  }, 240_000);
});
