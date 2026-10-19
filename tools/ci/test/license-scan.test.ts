/** M00f AC-2 and AC-5 (scan half): every fixture case through license:scan, rule named in the output. */
import { afterAll, describe, expect, it } from 'vitest';
import { formatFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import { runLicenseScan } from '../license-scan.ts';
import { buildCase, cleanupCases, type CaseName } from './third-party-fixtures.ts';

afterAll(cleanupCases);

function scan(name: CaseName) {
  const c = buildCase(name);
  const notes: string[] = [];
  const res = runLicenseScan({ root: c.root, deps: [], packageDeps: c.packageDeps, packFiles: c.packFiles, real: c.real, notes });
  return { ...res, notes, text: res.findings.map(formatFinding).join('\n'), rules: res.findings.map((f) => f.rule) };
}

const FAILS: Array<[CaseName, string]> = [
  ['no-entry', 'no-entry'],
  ['no-sha', 'no-sha'],
  ['no-license', 'no-license'],
  ['licence-file-missing', 'licence-file-missing'],
  ['dual-licence-missing-data-grant', 'dual-licence-missing-data-grant'],
  ['outside-paths', 'outside-allowed-paths'],
  ['gpl-code', 'item-licence'],
  ['data-as-code', 'item-licence'],
  ['reuse-toml-mismatch', 'reuse-toml-mismatch'],
  ['subset-keys', 'subset-keys'],
  ['geocoded-field', 'excluded-field'],
  ['field-synonym', 'excluded-field'],
  ['subset-high-cardinality', 'subset-high-cardinality'],
  ['subset-name-value', 'subset-name-value'],
  ['notice-no-url', 'notice-no-url'],
  ['notice-no-modified', 'notice-no-modified'],
  ['notice-bad-format', 'notice-bad-format'],
  ['credits-missing', 'credits-missing'],
  ['header-unresolved', 'header-unresolved'],
  ['header-no-copyright', 'header-no-copyright'],
  ['pack-no-licences', 'pack-no-licences'],
  ['gpl-exception', 'gpl-exception'],
  ['services-gpl-dep', 'license-copyleft'],
  ['mapbox-host', 'mapbox-host'],
  ['mapbox-token', 'mapbox-token'],
];

describe('license:scan third_party rules (M00f)', () => {
  it('clean passes, with the subset-value SKIP note', () => {
    const r = scan('clean');
    expect(r.text).toBe('');
    expect(r.notes).toContain('SKIP reuse subset values: DV_NAMES_REAL_JSON not set');
  });

  it.each(FAILS)('%s fails with rule %s', (name, rule) => {
    const r = scan(name);
    expect(r.rules).toContain(rule);
    expect(r.text).toContain(rule);
  });

  it('names the excluded synonyms of field-synonym', () => {
    const r = scan('field-synonym');
    for (const f of ['company', 'website', 'blurb', 'lat']) expect(r.text).toContain(`"${f}"`);
  });

  it('ported-with-header passes (copyright line, SPDX line, resolvable header)', () => {
    expect(scan('ported-with-header').text).toBe('');
  });

  it('ported-no-header is the clone check\'s job, not this scan', () => {
    expect(scan('ported-no-header').rules).not.toContain('header-unresolved');
  });
});
