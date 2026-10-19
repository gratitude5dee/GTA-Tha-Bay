/** M00f AC-3 (lint half): third_party/ is never imported, except by tools/{map,assets,ci,soul}. */
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../run.ts';

const eslint = new ESLint({ cwd: repoRoot });
const SRC = "import { x } from '../../third_party/some-lib/render.js';\nexport const y = x;\n";

async function rules(source: string, rel: string): Promise<string[]> {
  const [res] = await eslint.lintText(source, { filePath: path.join(repoRoot, rel) });
  return (res?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

describe('no-restricted-imports for third_party (M00f)', () => {
  it.each(['packages/world/src/a.ts', 'tools/cli/src/a.ts', 'services/edge/src/a.ts', 'apps/web/src/a.ts', 'packages/shared/src/a.ts'])(
    'reports an import from third_party/ in %s',
    async (rel) => {
      expect(await rules(SRC, rel)).toContain('no-restricted-imports');
    },
  );

  it.each(['tools/map/src/a.ts', 'tools/assets/a.ts', 'tools/ci/a.ts', 'tools/soul/a.ts'])('allows it in %s', async (rel) => {
    expect(await rules(SRC, rel)).not.toContain('no-restricted-imports');
  });

  it('ignores vendored files', async () => {
    expect(await eslint.isPathIgnored(path.join(repoRoot, 'third_party/some-lib/render.js'))).toBe(true);
  });
});
