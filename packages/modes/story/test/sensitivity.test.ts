/**
 * M05c2 AC-5: the sensitivity-read gate. A release build fails naming each sensitivity-read mission whose CURRENT version has no row in
 * content/story/sensitivity.json; a plain build only warns; a new version re-opens the gate.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSensitivity, validateSensitivityFile, type SensitivityRow } from '../src/compiler/index.ts';
import { planBuild } from '../../../../tools/ci/missions/build.ts';

const root = path.resolve(import.meta.dirname, '../../../..');
const tags = ['story', 'sensitivity-read'];
const row = (missionId: string, version: number): SensitivityRow => ({ missionId, version, readBy: 'reader@example.org', readAt: 1_790_000_000_000 });
const file = (rows: SensitivityRow[]) => ({ schema: 'story-sensitivity/1', rows });

describe('checkSensitivity', () => {
  const missions = [
    { id: 'm.a1.10', version: 1, tags },
    { id: 'm.a1.07', version: 2, tags },
    { id: 'm.a1.01', version: 1, tags: ['story'] },
  ];
  it('a release build fails naming each unread sensitivity-read mission, in id order', () => {
    const r = checkSensitivity(missions, [], true);
    expect(r.warnings).toEqual([]);
    expect(r.errors.map((e) => e.missionId)).toEqual(['m.a1.07', 'm.a1.10']);
    expect(r.errors[1]?.message).toContain('m.a1.10');
  });
  it('a plain build warns and does not fail', () => {
    const r = checkSensitivity(missions, [], false);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(2);
  });
  it('a row for the current version passes; a row for an older version does not', () => {
    expect(checkSensitivity(missions, [row('m.a1.10', 1), row('m.a1.07', 2)], true).errors).toEqual([]);
    const r = checkSensitivity(missions, [row('m.a1.10', 1), row('m.a1.07', 1)], true);
    expect(r.errors.map((e) => e.missionId)).toEqual(['m.a1.07']);
  });
  it('rejects a malformed or repeating file', () => {
    expect(validateSensitivityFile(file([]))).toEqual([]);
    expect(validateSensitivityFile({ schema: 'x', rows: [] })).not.toEqual([]);
    expect(validateSensitivityFile(file([row('a', 1), row('a', 1)]))).toHaveLength(1);
    expect(validateSensitivityFile({ schema: 'story-sensitivity/1', rows: [{ missionId: 'a' }] })).toHaveLength(1);
  });
});

describe('missions:build --release on the Act 1 content', () => {
  it('names m.a1.10 when it is unread, only warns without --release, and passes with the rows', async () => {
    const release = await planBuild({ root, release: true, sensitivity: file([]) });
    expect(release.problems.some((p) => p.startsWith('sensitivity:') && p.includes('m.a1.10'))).toBe(true);
    const plain = await planBuild({ root, sensitivity: file([]) });
    expect(plain.problems.filter((p) => p.startsWith('sensitivity:'))).toEqual([]);
    expect(plain.warnings.some((w) => w.includes('m.a1.10'))).toBe(true);
    const rows: SensitivityRow[] = [];
    for (const w of plain.warnings) {
      const m = /^sensitivity: (m\.[a-z0-9.]+) version (\d+)/.exec(w);
      if (m) rows.push(row(m[1] as string, Number(m[2])));
    }
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const ok = await planBuild({ root, release: true, sensitivity: file(rows) });
    expect(ok.problems.filter((p) => p.startsWith('sensitivity:'))).toEqual([]);
    // a new version of one mission re-opens the gate
    const bumped = rows.map((r) => (r.missionId === 'm.a1.10' ? { ...r, version: r.version + 1 } : r));
    const again = await planBuild({ root, release: true, sensitivity: file(bumped) });
    expect(again.problems.filter((p) => p.startsWith('sensitivity:')).join('\n')).toContain('m.a1.10');
  }, 120_000);
});
