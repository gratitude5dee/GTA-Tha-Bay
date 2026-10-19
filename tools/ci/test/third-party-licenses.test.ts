/** M00f AC-1: the licences tool. */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { toolsRoot } from '../lib/common.ts';
import { writeThirdPartyLicences } from '../third-party-licenses.ts';
import { buildCase, cleanupCases, COPYRIGHT, ENTRY } from './third-party-fixtures.ts';

afterAll(cleanupCases);

describe('third-party-licenses (M00f)', () => {
  it('writes every NOTICE line and every licenceFiles file verbatim', () => {
    const c = buildCase('clean');
    const out = path.join(c.root, 'apps/web/dist/third-party-licenses.txt');
    expect(writeThirdPartyLicences(c.root, out)).toBe(out);
    const text = readFileSync(out, 'utf8');
    const notice = readFileSync(path.join(c.root, 'third_party/NOTICE'), 'utf8').trim().split('\n');
    for (const line of notice) expect(text).toContain(line);
    expect(text).toContain(readFileSync(path.join(c.root, `third_party/${ENTRY}/LICENSE`), 'utf8'));
    expect(text).toContain(readFileSync(path.join(c.root, `third_party/${ENTRY}/data/CREDIT.excerpt.md`), 'utf8'));
    expect(text).toContain(COPYRIGHT);
    expect(text).toContain('Pinned SHA: aaaaaaaa');
  });

  it('a package with a ported file gets THIRD_PARTY_LICENSES.txt, one without gets none', () => {
    const c = buildCase('pack-no-licences');
    const out = path.join(c.root, 'tools/cli/THIRD_PARTY_LICENSES.txt');
    expect(writeThirdPartyLicences(c.root, out, { packageDir: 'tools/cli' })).toBe(out);
    expect(readFileSync(out, 'utf8')).toContain(COPYRIGHT);
    const other = path.join(c.root, 'packages/none/THIRD_PARTY_LICENSES.txt');
    expect(writeThirdPartyLicences(c.root, other, { packageDir: 'packages/none' })).toBeNull();
    expect(existsSync(other)).toBe(false);
  });

  it('the repository has nothing vendored, so no file is written', () => {
    const out = path.join(os.tmpdir(), `dv-none-${process.pid}`, 'third-party-licenses.txt');
    expect(writeThirdPartyLicences(toolsRoot, out)).toBeNull();
    expect(existsSync(out)).toBe(false);
  });
});
