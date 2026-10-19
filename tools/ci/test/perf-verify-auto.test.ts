import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checklistIdOf, resolveAuto } from '../perf-verify.ts';
import { repoRoot } from '../run.ts';

const fixture = path.join(repoRoot, 'tools', 'ci', 'fixtures', 'device-runs', 'M00d', 'ci-fixture', 'perf.json');
const checklistDir = path.join(repoRoot, 'tools', 'ci', 'fixtures', 'checklists');

describe('perf:verify --auto (AC-9)', () => {
  it('derives <M##>-<device> from .../<M##>/<device>/perf.json', () => {
    expect(checklistIdOf(fixture)).toBe('M00d-ci-fixture');
    expect(checklistIdOf('docs/device-spike/M01c/iphone15/perf.json')).toBe('M01c-iphone15');
    expect(checklistIdOf('perf.json')).toBeNull();
    expect(checklistIdOf('/tmp/x/notes/dev/perf.json')).toBeNull();
  });

  it('takes the tier from the report and the checklist from the checklist directory', () => {
    const r = resolveAuto(fixture, checklistDir);
    expect(r).toMatchObject({ tier: 'mobile-low', checklistId: 'M00d-ci-fixture' });
    expect(r.checklistFile).toBe(path.join(checklistDir, 'M00d-ci-fixture.json'));
    expect(r.error).toBeUndefined();
  });

  it('a missing checklist fails with "no checklist for <M##>-<device>"', () => {
    expect(resolveAuto(fixture, path.join(repoRoot, 'tools', 'ci', 'checklists')).error).toBe('no checklist for M00d-ci-fixture');
  });
});
