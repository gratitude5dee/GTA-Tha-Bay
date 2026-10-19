import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRIds } from '../md-parse.ts';
import { buildTrace, openGates, statusText, type TraceRow } from '../trace.ts';
import { repoRoot } from '../run.ts';

const fx = (name: string): string => path.join(repoRoot, 'tools', 'ci', 'fixtures', 'trace', name);
const row = (r: ReturnType<typeof buildTrace>, rid: string): TraceRow => r.rows.find((x) => x.rid === rid) as TraceRow;

describe('traceability over the repository (AC-4)', () => {
  const out = path.join(repoRoot, 'tests', 'reports');
  const res = buildTrace({ out });
  const rids = parseRIds(readFileSync(path.join(repoRoot, 'prompt-pack', '06-SHARED-CONTEXT.md'), 'utf8')).map((r) => r.rid);

  it('lists every 06 section 2 R-ID once and writes trace.json and trace.md', () => {
    expect(rids.length).toBe(42);
    expect(res.rows.map((r) => r.rid)).toEqual(rids);
    expect(existsSync(path.join(out, 'trace.json'))).toBe(true);
    const md = readFileSync(path.join(out, 'trace.md'), 'utf8');
    expect(md).toContain('| R-ID | spec sections | milestones | tests (names) | status |');
    for (const id of rids) expect(md.match(new RegExp(`^\\| ${id} \\|`, 'gm'))?.length).toBe(1);
  });

  it('has no empty row, no unknown R-ID, and passes strict', () => {
    expect(res.rows.filter((r) => r.flags.length > 0).map((r) => `${r.rid} ${r.flags.join(',')}`)).toEqual([]);
    expect(res.unknownCitations).toEqual([]);
    expect(buildTrace({ strict: true }).ok).toBe(true);
  });

  it('no repository row claims tested or seen-on-device before any milestone is DONE', () => {
    for (const r of res.rows) expect(['planned', 'ready', 'blocked', 'tested', 'seen-on-device', 'post-gate']).toContain(r.status);
    expect(res.rows.some((r) => r.status === 'ready')).toBe(true);
  });
});

describe('traceability fixtures (AC-4, AC-13)', () => {
  it('uncovered: the R-ID with no milestone is flagged empty and fails only with strict, naming it', () => {
    const loose = buildTrace({ root: fx('uncovered') });
    expect(loose.ok).toBe(true);
    expect(row(loose, 'R-ENG-02').flags).toEqual(['empty']);
    const strict = buildTrace({ root: fx('uncovered'), strict: true });
    expect(strict.ok).toBe(false);
    expect(strict.failures.join('\n')).toContain('R-ENG-02');
  });

  it('file-wins: a milestone whose file omits an R-ID its _PLAN row lists is left off that row', () => {
    const r = buildTrace({ root: fx('file-wins') });
    expect(row(r, 'R-ENG-01').milestones.map((m) => m.id)).toEqual(['M90']);
    expect(row(r, 'R-ENG-02').milestones).toEqual([]);
  });

  it('planned: a PENDING file, or a _PLAN row without a file', () => {
    const r = buildTrace({ root: fx('planned') });
    expect(row(r, 'R-ENG-01').status).toBe('planned');
    expect(row(r, 'R-ENG-02')).toMatchObject({ status: 'planned' });
    expect(row(r, 'R-ENG-02').milestones[0]).toMatchObject({ id: 'M91', source: 'plan' });
  });

  it('ready: every citing file READY', () => {
    expect(row(buildTrace({ root: fx('ready') }), 'R-ENG-01').status).toBe('ready');
  });

  it('tested: DONE files with green results; the same row is ready when the result is missing', () => {
    expect(row(buildTrace({ root: fx('tested') }), 'R-ENG-01').status).toBe('tested');
    expect(row(buildTrace({ root: fx('tested'), results: path.join(tmpdir(), 'dv-no-results') }), 'R-ENG-01').status).toBe('ready');
  });

  it('seen-on-device: tested plus a passing device run judged by perf:verify --auto', () => {
    expect(row(buildTrace({ root: fx('seen-on-device') }), 'R-ENG-01').status).toBe('seen-on-device');
  });

  it('seen-on-device falls back to tested when the device report breaks its budget', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dv-trace-'));
    cpSync(fx('seen-on-device'), dir, { recursive: true });
    const over = readFileSync(path.join(repoRoot, 'tools', 'ci', 'fixtures', 'perf', 'over.json'), 'utf8');
    writeFileSync(path.join(dir, 'docs', 'device-runs', 'M90', 'iphone15', 'perf.json'), over);
    expect(row(buildTrace({ root: dir }), 'R-ENG-01').status).toBe('tested');
  });

  it('blocked: tested with Q-23 mapped and Q-23a pending; tested once Q-23a passes', () => {
    const r = row(buildTrace({ root: fx('blocked') }), 'R-IP-01');
    expect(r.status).toBe('blocked');
    expect(statusText(r)).toBe('blocked (Q-23)');
    const dir = mkdtempSync(path.join(tmpdir(), 'dv-trace-'));
    cpSync(fx('blocked'), dir, { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'legal', 'launch-gates.json'), JSON.stringify([{ id: 'Q-23a', status: 'pass' }]));
    expect(row(buildTrace({ root: dir }), 'R-IP-01').status).toBe('tested');
  });

  it('openGates: a Q-id with no entry stays open; pass and waived close it; Q-23 does not match Q-230', () => {
    expect(openGates(['Q-23'], [])).toEqual(['Q-23']);
    expect(openGates(['Q-23'], [{ id: 'Q-23a', status: 'pass' }, { id: 'Q-23b', status: 'waived' }])).toEqual([]);
    expect(openGates(['Q-23'], [{ id: 'Q-230', status: 'pass' }])).toEqual(['Q-23']);
    expect(openGates(['Q-13'], { gates: [{ id: 'Q-13:iphone15', status: 'pass' }, { id: 'Q-13:quest3', status: 'pending' }] })).toEqual(['Q-13']);
  });

  it('device-only: carries its flag and fails only with strict', () => {
    expect(row(buildTrace({ root: fx('device-only') }), 'R-PLAT-05').flags).toEqual(['device-only']);
    expect(buildTrace({ root: fx('device-only') }).ok).toBe(true);
    expect(buildTrace({ root: fx('device-only'), strict: true }).ok).toBe(false);
  });

  it('post-gate: ready without closure, tested with it; the later milestone is shown as (post-gate)', () => {
    expect(row(buildTrace({ root: fx('post-gate') }), 'R-ENG-01').status).toBe('ready');
    const closed = buildTrace({ root: fx('post-gate'), closure: 'M90' });
    expect(row(closed, 'R-ENG-01').status).toBe('tested');
    expect(row(closed, 'R-ENG-01').milestones.map((m) => `${m.id}${m.postGate ? ' (post-gate)' : ''}`)).toEqual(['M90', 'M91 (post-gate)']);
    expect(closed.markdown).toContain('M91 (post-gate)');
  });

  it('a row cited only after the closure is post-gate', () => {
    const r = buildTrace({ root: fx('post-gate'), closure: 'M90' });
    expect(r.rows.every((x) => x.status !== 'post-gate')).toBe(true);
  });
});
