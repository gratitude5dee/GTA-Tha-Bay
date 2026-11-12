import { describe, expect, it } from 'vitest';
import {
  collectTests,
  estimator,
  isSerialSource,
  listLine,
  LOAD_ONLY,
  mergeTimings,
  pack,
  readTimings,
  shardBound,
  shardLines,
  testKey,
  timingsFromLogs,
  unitsOf,
  type JsonReport,
  type ListedTest,
  type Unit,
} from '../e2e-plan.ts';

// BD-FIX-CI-DURSHARD-01: the e2e shards are cut by measured minutes, not by test count over the sorted file names.

const spec = (title: string, file: string, projects = ['chromium-webgl2', 'webkit-webgl2']) => ({ title, file, tests: projects.map((projectName) => ({ projectName })) });
const report: JsonReport = {
  suites: [
    {
      title: 'a.spec.ts',
      file: 'a.spec.ts',
      specs: [spec('top level @a', 'a.spec.ts')],
      suites: [{ title: 'group @a', file: 'a.spec.ts', specs: [spec('desktop: one', 'a.spec.ts'), spec('mobile: two', 'a-helpers.ts'), spec('webkit only', 'a.spec.ts', ['webkit-webgl2'])] }],
    },
    { title: 'b.spec.ts', file: 'b.spec.ts', suites: [{ title: 'serial @b', file: 'b.spec.ts', specs: [spec('first', 'b.spec.ts'), spec('second', 'b.spec.ts')] }] },
  ],
};

const unit = (key: string, minutes: number): Unit => ({ key, minutes, tests: [{ spec: `${key}.spec.ts`, file: `${key}.spec.ts`, titles: [key] }] });

describe('e2e-plan (BD-FIX-CI-DURSHARD-01)', () => {
  it('collects the project tests with their describe path, declaring file and spec file', () => {
    const tests = collectTests(report, 'chromium-webgl2');
    expect(tests.map((t) => [t.spec, t.file, t.titles.join(' / ')])).toEqual([
      ['a.spec.ts', 'a.spec.ts', 'top level @a'],
      ['a.spec.ts', 'a.spec.ts', 'group @a / desktop: one'],
      ['a.spec.ts', 'a-helpers.ts', 'group @a / mobile: two'],
      ['b.spec.ts', 'b.spec.ts', 'serial @b / first'],
      ['b.spec.ts', 'b.spec.ts', 'serial @b / second'],
    ]);
    expect(collectTests(report, 'webkit-webgl2')).toHaveLength(6);
  });

  it('writes the test-list line Playwright matches (project, declaring file, titles; "›" between)', () => {
    const t: ListedTest = { spec: 'a.spec.ts', file: 'a-helpers.ts', titles: ['group @a', 'mobile: two'] };
    expect(listLine('chromium-webgl2', t)).toBe('[chromium-webgl2] › a-helpers.ts › group @a › mobile: two');
    expect(testKey(t)).toBe('a-helpers.ts › group @a › mobile: two');
  });

  it('adds a load line for the spec file of a test a helper declares (a list loads only the files it names)', () => {
    const tests = collectTests(report, 'chromium-webgl2');
    const lines = shardLines('chromium-webgl2', unitsOf(tests, () => false, () => 1));
    expect(lines.filter((l) => l.includes(LOAD_ONLY))).toEqual([`[chromium-webgl2] \u203A a.spec.ts \u203A ${LOAD_ONLY}`]);
    expect(lines).toHaveLength(tests.length + 1);
  });

  it('refuses a test whose title path begins another test path of the same file (a list line matches by prefix)', () => {
    const clash: JsonReport = {
      suites: [{ title: 'c.spec.ts', file: 'c.spec.ts', specs: [spec('x', 'c.spec.ts')], suites: [{ title: 'x', file: 'c.spec.ts', specs: [spec('y', 'c.spec.ts')] }] }],
    };
    expect(() => collectTests(clash, 'chromium-webgl2')).toThrow(/cannot tell them apart/);
  });

  it('refuses a title a test list cannot name', () => {
    const bad: JsonReport = { suites: [{ title: 'c.spec.ts', file: 'c.spec.ts', specs: [spec('a › b', 'c.spec.ts')] }] };
    expect(() => collectTests(bad, 'chromium-webgl2')).toThrow(/cannot be named/);
    const spaced: JsonReport = { suites: [{ title: 'c.spec.ts', file: 'c.spec.ts', specs: [spec(' padded', 'c.spec.ts')] }] };
    expect(() => collectTests(spaced, 'chromium-webgl2')).toThrow(/cannot be named/);
  });

  it('detects a serial group in the source', () => {
    expect(isSerialSource("test.describe.configure({ timeout: 1, mode: 'serial' });")).toBe(true);
    expect(isSerialSource('test.describe.serial("x", () => {});')).toBe(true);
    expect(isSerialSource("test.describe.configure({ mode: 'parallel' });")).toBe(false);
  });

  it('keeps a serial file in one unit and every other test alone; tests with the same line stay together', () => {
    const tests = collectTests(report, 'chromium-webgl2');
    const units = unitsOf(tests, (t) => t.spec === 'b.spec.ts', () => 2);
    expect(units.map((u) => [u.key.startsWith('serial') ? u.key : 'test', u.tests.length, u.minutes])).toEqual([
      ['test', 1, 2],
      ['test', 1, 2],
      ['test', 1, 2],
      ['serial b.spec.ts', 2, 4],
    ]);
    const twice = unitsOf([...tests.slice(0, 1), ...tests.slice(0, 1)], () => false, () => 1);
    expect(twice).toHaveLength(1);
    expect(twice[0]?.tests).toHaveLength(2);
  });

  it('estimates an unmeasured test from its file, then the project, desktop titles apart', () => {
    const tests: ListedTest[] = [
      { spec: 'a.spec.ts', file: 'a.spec.ts', titles: ['desktop: measured'] },
      { spec: 'a.spec.ts', file: 'a.spec.ts', titles: ['desktop: new'] },
      { spec: 'a.spec.ts', file: 'a.spec.ts', titles: ['mobile: new'] },
      { spec: 'b.spec.ts', file: 'b.spec.ts', titles: ['mobile: measured'] },
      { spec: 'c.spec.ts', file: 'c.spec.ts', titles: ['desktop-ultra: new'] },
    ];
    const est = estimator(tests, { 'a.spec.ts › desktop: measured': 12, 'b.spec.ts › mobile: measured': 0.5 });
    expect(tests.map(est)).toEqual([12, 12, 0.5, 0.5, 12]);
    expect(estimator(tests, {})(tests[0] as ListedTest)).toBe(1);
  });

  it('packs every unit into exactly one shard and keeps the bounds close', () => {
    const units = [unit('a', 30), unit('b', 28), unit('c', 20), ...Array.from({ length: 60 }, (_, i) => unit(`s${String(i).padStart(2, '0')}`, 1 + (i % 5)))];
    const plan = pack(units, 4, 2);
    expect(plan.flat().map((u) => u.key).sort()).toEqual(units.map((u) => u.key).sort());
    const bounds = plan.map((us) => shardBound(us, 2));
    expect(Math.max(...bounds) - Math.min(...bounds)).toBeLessThan(5);
    // Deterministic: the same input gives the same plan.
    expect(pack(units, 4, 2).map((us) => us.map((u) => u.key))).toEqual(plan.map((us) => us.map((u) => u.key)));
    expect(() => pack(units, 0, 2)).toThrow(/bad shape/);
  });

  it('bounds a shard by its minutes over the workers plus the part of its longest unit that may start last', () => {
    expect(shardBound([unit('a', 30), unit('b', 10)], 2)).toBe(20 + 15);
    expect(shardBound([], 2)).toBe(0);
  });

  it('reads list-reporter lines from CI logs: units, retries, the longest attempt per log, the mean over logs', () => {
    const log1 = [
      '2026-11-01T11:13:33.0Z   ✓  1 [chromium-webgl2] › tests/e2e/a.spec.ts:10:3 › group @a › desktop: one (2.5m)',
      '2026-11-01T11:13:33.0Z   ✘  2 [chromium-webgl2] › tests/e2e/b.spec.ts:5:3 › serial @b › first (30.0s)',
      '2026-11-01T11:13:33.0Z   ✓  3 [chromium-webgl2] › tests/e2e/b.spec.ts:5:3 › serial @b › first (retry #1) (45.0s)',
      '2026-11-01T11:13:33.0Z   -  4 [chromium-webgl2] › tests/e2e/c.spec.ts:5:3 › skipped',
      '2026-11-01T11:13:33.0Z   ✓  5 [webkit-webgl2] › tests/e2e/a.spec.ts:10:3 › group @a › desktop: one (900ms)',
    ].join('\n');
    const log2 = '2026-11-01T11:13:33.0Z   ✓  1 [chromium-webgl2] › tests/e2e/a.spec.ts:10:3 › group @a › desktop: one (1.5m)';
    expect(timingsFromLogs([log1, log2])).toEqual({
      'chromium-webgl2': { 'a.spec.ts › group @a › desktop: one': 2, 'b.spec.ts › serial @b › first': 0.75 },
      'webkit-webgl2': { 'a.spec.ts › group @a › desktop: one': 0.02 },
    });
  });

  // BD-FIX-CI-PLAN-02: a test that skips itself on a project is planned at 0 minutes, under three guards.
  const ok = (n: number, project: string, rest: string): string => `2026-11-12T11:32:00.0Z   ✓  ${n} [${project}] › tests/e2e/${rest}`;
  const skip = (n: number, project: string, rest: string): string => `2026-11-12T11:32:00.0Z   -  ${n} [${project}] › tests/e2e/${rest}`;
  const fail = (n: number, project: string, rest: string): string => `2026-11-12T11:32:00.0Z   ✘  ${n} [${project}] › tests/e2e/${rest}`;

  it('records 0 for a test that only skips, and only from a log with no failed test line (BD-FIX-CI-PLAN-02)', () => {
    const clean = [
      ok(1, 'chromium-webgpu', 'a.spec.ts:10:3 › group @a › mobile: runs (30.0s)'),
      skip(2, 'chromium-webgpu', 'a.spec.ts:20:3 › goldens @g › desktop golden is within the tolerance @g'),
      skip(3, 'chromium-webgpu', 'a-helpers.ts:55:5 › goldens @g › mobile-low golden'),
      // a line of the web server that carries the failure mark is not a failed test line
      '2026-11-12T12:10:26.1Z [WebServer] ✘ [ERROR] kj::getCaughtExceptionAsKj() = disconnected: write(): Broken pipe (os error 32)',
      '2026-11-12T11:52:11.7Z   2 skipped',
    ].join('\n');
    // a serial group skips its remaining tests after a failure: that says nothing about what they cost
    const red = [
      fail(1, 'chromium-webgpu', 'b.spec.ts:5:3 › serial @b › first (30.0s)'),
      skip(2, 'chromium-webgpu', 'b.spec.ts:9:3 › serial @b › second'),
      skip(3, 'chromium-webgpu', 'b.spec.ts:13:3 › serial @b › third'),
    ].join('\n');
    expect(timingsFromLogs([clean, red])).toEqual({
      'chromium-webgpu': {
        'a.spec.ts › group @a › mobile: runs': 0.5,
        'a.spec.ts › goldens @g › desktop golden is within the tolerance @g': 0,
        'a-helpers.ts › goldens @g › mobile-low golden': 0,
        'b.spec.ts › serial @b › first': 0.5,
      },
    });
  });

  it('a log that ran a test wins over a log that skipped it: a 0 never lowers measured minutes (BD-FIX-CI-PLAN-02)', () => {
    const ran = ok(1, 'webkit-webgl2', 'a.spec.ts:10:3 › group @a › desktop: one (3.0m)');
    const ranAgain = ok(1, 'webkit-webgl2', 'a.spec.ts:10:3 › group @a › desktop: one (2.0m)');
    const skipped = [skip(1, 'webkit-webgl2', 'a.spec.ts:10:3 › group @a › desktop: one'), skip(2, 'webkit-webgl2', 'a.spec.ts:20:3 › group @a › desktop: two')].join('\n');
    // the mean runs over the logs that ran it (2.5), not over the three logs (1.67)
    expect(timingsFromLogs([skipped, ran, ranAgain, skipped])).toEqual({
      'webkit-webgl2': { 'a.spec.ts › group @a › desktop: one': 2.5, 'a.spec.ts › group @a › desktop: two': 0 },
    });
    // a passed and a skipped line of the same test in one log (a retry): the run counts
    expect(timingsFromLogs([[skip(1, 'webkit-webgl2', 'a.spec.ts:10:3 › g › t'), ok(2, 'webkit-webgl2', 'a.spec.ts:10:3 › g › t (6.0s)')].join('\n')])).toEqual({
      'webkit-webgl2': { 'a.spec.ts › g › t': 0.1 },
    });
  });

  it('timings --write never replaces a stored value above 0 by 0; other entries are replaced, added or kept (BD-FIX-CI-PLAN-02)', () => {
    const stored = { 'a › ran before, skipped now': 4.2, 'a › measured again': 1, 'a › was 0': 0, 'z › not in the logs': 7 };
    const parsed = { 'a › ran before, skipped now': 0, 'a › measured again': 2, 'a › was 0': 0, 'a › new skip': 0, 'a › new run': 0.3 };
    const merged = mergeTimings(stored, parsed);
    expect(merged).toEqual({
      'a › ran before, skipped now': 4.2,
      'a › measured again': 2,
      'a › was 0': 0,
      'a › new skip': 0,
      'a › new run': 0.3,
      'z › not in the logs': 7,
    });
    expect(Object.keys(merged)).toEqual([...Object.keys(merged)].sort());
    // a stored 0 gives way to a measured value
    expect(mergeTimings({ k: 0 }, { k: 1.5 })).toEqual({ k: 1.5 });
  });

  it('the medians of the estimator leave the zeros out; a test measured at 0 is still planned at 0 (BD-FIX-CI-PLAN-02)', () => {
    const t = (specFile: string, title: string): ListedTest => ({ spec: specFile, file: specFile, titles: [title] });
    const tests = [
      t('a.spec.ts', 'desktop: runs'), t('a.spec.ts', 'desktop: skips one'), t('a.spec.ts', 'desktop: skips two'), t('a.spec.ts', 'desktop: skips three'),
      t('a.spec.ts', 'desktop: new'), t('a.spec.ts', 'mobile: skips'), t('a.spec.ts', 'mobile: new'), t('b.spec.ts', 'mobile: runs'),
    ];
    const measured = {
      'a.spec.ts › desktop: runs': 3.3,
      'a.spec.ts › desktop: skips one': 0,
      'a.spec.ts › desktop: skips two': 0,
      'a.spec.ts › desktop: skips three': 0,
      'a.spec.ts › mobile: skips': 0,
      'b.spec.ts › mobile: runs': 0.4,
    };
    // with the zeros in, the file's desktop median would be 0 (3 of 4) and the new desktop case would be planned at nothing
    expect(tests.map(estimator(tests, measured))).toEqual([3.3, 0, 0, 0, 3.3, 0, 0.4, 0.4]);
  });

  it('a file whose desktop tests all skip leaves the desktop median of the project unchanged (BD-FIX-CI-PLAN-02)', () => {
    const t = (specFile: string, title: string): ListedTest => ({ spec: specFile, file: specFile, titles: [title] });
    const ran = [t('a.spec.ts', 'desktop: one'), t('b.spec.ts', 'desktop: two'), t('c.spec.ts', 'desktop: three')];
    const golden = [t('g.spec.ts', 'desktop golden one'), t('g.spec.ts', 'desktop golden two')];
    const fresh = [t('g.spec.ts', 'desktop golden new'), t('n.spec.ts', 'desktop: brand new')];
    const before = { 'a.spec.ts › desktop: one': 2, 'b.spec.ts › desktop: two': 4, 'c.spec.ts › desktop: three': 9 };
    const after = { ...before, 'g.spec.ts › desktop golden one': 0, 'g.spec.ts › desktop golden two': 0 };
    const unmeasured = t('n.spec.ts', 'desktop: brand new');
    expect(estimator([...ran, ...golden, ...fresh], before)(unmeasured)).toBe(4);
    const est = estimator([...ran, ...golden, ...fresh], after);
    expect(est(unmeasured)).toBe(4);
    // the skipped goldens plan at 0; a new case of their file has no measured sibling above 0 and takes the project's median
    expect(golden.map(est)).toEqual([0, 0]);
    expect(est(t('g.spec.ts', 'desktop golden new'))).toBe(4);
  });

  it('the committed table holds minutes for the four projects', () => {
    const t = readTimings();
    for (const p of ['chromium-webgl2', 'webkit-webgl2', 'chromium-webgpu', 'xr-quest3']) {
      const keys = Object.entries(t.projects[p] ?? {});
      expect(keys.length, p).toBeGreaterThan(0);
      for (const [k, v] of keys) expect(Number.isFinite(v) && v >= 0, `${p} ${k}`).toBe(true);
    }
  });
});
