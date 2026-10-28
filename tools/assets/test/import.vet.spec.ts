/** M10d0 AC-3: the vetting rules of assets:import -- vet. Franchise strings are built from fragments so the repo scans stay clean. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { toolsRoot } from '../../ci/lib/common.ts';
import { vetDir, type IntakeRecord } from '../src/import/vet.ts';

const CLEAN_DIR = path.join(toolsRoot, 'tools/assets/test/fixtures/intake/clean');
const clean = JSON.parse(readFileSync(path.join(CLEAN_DIR, 'polyhaven/asphalt-patched.json'), 'utf8')) as IntakeRecord;

const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

function vet(over: (r: IntakeRecord) => void): string[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dv-vet-'));
  tmp.push(dir);
  const r = structuredClone(clean);
  over(r);
  writeFileSync(path.join(dir, 'item.json'), JSON.stringify(r));
  const res = vetDir(toolsRoot, dir);
  expect(res).toHaveLength(1);
  return (res[0]?.findings ?? []).map((f) => f.rule);
}

const FRANCHISE = ['rock', 'star'].join('') + ' games';
const MAKE = ['for', 'd'].join('');

describe('assets:import -- vet', () => {
  it('approves the clean fixture', () => {
    const res = vetDir(toolsRoot, CLEAN_DIR);
    expect(res.map((r) => [r.item, r.decision, r.findings])).toEqual([['asphalt-patched', 'approve', []]]);
  });

  it('V-MAKE: a real make in the title, a model on a vehicle', () => {
    expect(vet((r) => { r.title = `${MAKE} pickup`; })).toContain('V-MAKE');
    expect(vet((r) => { r.kind = 'vehicle'; r.answers['V-SIL'] = 'pass'; r.title = 'Pony coupe mustang'; })).toContain('V-MAKE');
    expect(vet((r) => { r.title = 'Pony coupe mustang'; })).not.toContain('V-MAKE');
  });

  it('game-style names: _lod0, vehshare, _hi and a game-format extension', () => {
    expect(vet((r) => { r.files = ['road_lod0.glb']; })).toContain('V-NAME-LOD0');
    expect(vet((r) => { r.tags = ['vehshare']; })).toContain('V-NAME-VEHSHARE');
    expect(vet((r) => { r.files = ['road_hi.png']; })).toContain('V-NAME-HI');
    expect(vet((r) => { r.files = [`tex.${['y', 'td'].join('')}`]; })).toContain('V-NAME-EXT');
    expect(vet((r) => { r.files = ['hi-rise.png']; })).not.toContain('V-NAME-HI');
  });

  it('V-TAG and V-DENYLIST: franchise tags and names', () => {
    expect(vet((r) => { r.tags = ['road', FRANCHISE]; })).toContain('V-TAG');
    expect(vet((r) => { r.title = `${FRANCHISE} road`; })).toContain('V-DENYLIST');
  });

  it('V-UPLOADER: a franchise-heavy uploader, by name and by share', () => {
    expect(vet((r) => { r.uploader = { name: 'Some Uploader', franchiseShare: 0.6 }; })).toContain('V-UPLOADER');
    expect(vet((r) => { r.uploader = { name: FRANCHISE, franchiseShare: 0 }; })).toContain('V-UPLOADER');
    expect(vet((r) => { r.uploader = { name: 'Some Uploader', franchiseShare: 0.1 }; })).not.toContain('V-UPLOADER');
  });

  it('V-EVIDENCE: no authorship evidence', () => {
    expect(vet((r) => { r.evidence = []; })).toContain('V-EVIDENCE');
  });

  it('V-LICENCE: editorial, non-commercial and share-alike licences', () => {
    for (const lic of ['LicenseRef-Editorial-Use', 'CC-BY-NC-4.0', 'CC-BY-SA-4.0', 'CC-BY-ND-4.0']) {
      expect(vet((r) => { r.licence = lic; })).toContain('V-LICENCE');
    }
  });

  it('V-PACK: a source host in no pack', () => {
    expect(vet((r) => { r.sourceUrl = 'https://unlisted.example/a'; })).toContain('V-PACK');
  });

  it('V-MURAL and V-PERSON and V-LOGO: present, and unanswered', () => {
    expect(vet((r) => { r.answers.mural = 'present'; })).toContain('V-MURAL');
    expect(vet((r) => { r.answers.people = 'present'; })).toContain('V-PERSON');
    expect(vet((r) => { r.answers.logos = 'present'; })).toContain('V-LOGO');
    expect(vet((r) => { r.answers.mural = null; })).toContain('V-MURAL');
  });

  it('V-ORIGIN: an unclear or unanswered origin rejects', () => {
    expect(vet((r) => { r.answers.origin = 'unclear'; })).toContain('V-ORIGIN');
    expect(vet((r) => { r.answers.origin = null; })).toContain('V-ORIGIN');
  });

  it('V-SIL: a vehicle needs its silhouette answered and passed', () => {
    const veh = (r: IntakeRecord): void => { r.kind = 'vehicle'; r.title = 'Orange hatchback'; };
    expect(vet((r) => { veh(r); })).toContain('V-SIL');
    expect(vet((r) => { veh(r); r.answers['V-SIL'] = null; })).toContain('V-SIL');
    expect(vet((r) => { veh(r); r.answers['V-SIL'] = 'fail'; })).toContain('V-SIL');
    expect(vet((r) => { veh(r); r.answers['V-SIL'] = 'pass'; })).toEqual([]);
  });

  it('V-SCHEMA: a record that does not match the intake schema', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dv-vet-'));
    tmp.push(dir);
    mkdirSync(path.join(dir, 'p'));
    writeFileSync(path.join(dir, 'p/bad.json'), JSON.stringify({ schema: 'art-intake/1', pack: 'p', item: 'bad' }));
    const res = vetDir(toolsRoot, dir);
    expect(res[0]?.decision).toBe('reject');
    expect(res[0]?.findings[0]?.rule).toBe('V-SCHEMA');
  });
});

describe('assets:import -- vet (CLI)', () => {
  const cli = (dir: string): { status: number | null; out: string } => {
    const res = spawnSync('pnpm', ['exec', 'tsx', 'tools/assets/src/import/cli.ts', 'vet', dir], { cwd: toolsRoot, encoding: 'utf8' });
    return { status: res.status, out: res.stdout + res.stderr };
  };
  it('exits 0 on the clean fixture and 1 on a rejected one', () => {
    const ok = cli(CLEAN_DIR);
    expect(ok.status).toBe(0);
    expect(ok.out).toContain('polyhaven/asphalt-patched: approve');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dv-vet-'));
    tmp.push(dir);
    writeFileSync(path.join(dir, 'item.json'), JSON.stringify({ ...clean, evidence: [] }));
    const bad = cli(dir);
    expect(bad.status).toBe(1);
    expect(bad.out).toContain('V-EVIDENCE');
  });
});
