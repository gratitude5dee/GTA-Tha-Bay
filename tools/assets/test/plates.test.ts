/**
 * M05c2: the stage-plate tool without a browser. Shots come from the first shot of each ref's DirectorScript, the lock pins a hash once
 * (a changed hash needs --refresh), a missing renderer or missing R2 credentials give the SKIP lines and exit 0, and an upload writes a
 * provenance record of origin `derived`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { DirectorScript } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import { emptyPlateLock, mergeLock, plateJobs, plateObjectKey, plateRecord, sha256Of, type PlateRenderer } from '../plates/render.ts';
import { pickRefs, runPlates, uploadPlate } from '../plates/cli.ts';
import { loadCutsceneRefs } from '../cutscene-index/refs.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'dv-plates-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const director = (id: string): DirectorScript =>
  ({
    schema: 'director/1', id, durationSec: 14, seed: 1,
    marks: { wide: { at: [37.7, -122.4], yawDeg: 10 }, close: { at: [37.71, -122.41], yawDeg: 20 } },
    actors: [], cues: [], xrVantage: { mark: 'wide', yawDeg: 0 },
    shots: [{ atSec: 7, preset: 'single', subject: 'player', from: 'close', lens: 'tele' }, { atSec: 0, preset: 'establish', subject: 'player', from: 'wide', lens: 'wide' }],
  }) as unknown as DirectorScript;

function fakeRoot(): string {
  const r = mkdtempSync(path.join(tmp, 'root-'));
  mkdirSync(path.join(r, 'content/story/act1'), { recursive: true });
  const ref = (id: string, stage: string | null, fallback: string) => ({ id, hook: 'story.beat', template: 'story.beat@1', cast: [], stage, move: null, slots: {}, fallback, cues: [], audio: 'engine', prefetch: 'onTrigger', priority: 1 });
  writeFileSync(path.join(r, 'content/story/act1/cutscene-refs.ts'), `export default ${JSON.stringify([ref('cut.story.m.a1.90.one', 'beat.one@1', 'm.a1.90.one'), ref('cut.story.m.a1.91.two', 'beat.two@2', 'm.a1.91.two'), ref('cut.story.m.dev.x', 'beat.dev@1', 'm.dev.x')])};\n`);
  for (const id of ['m.a1.90.one', 'm.a1.91.two', 'm.dev.x']) {
    mkdirSync(path.join(r, 'assets/src/data', `director.${id}`), { recursive: true });
    writeFileSync(path.join(r, 'assets/src/data', `director.${id}`, 'director.json'), JSON.stringify(director(id)));
  }
  return r;
}

describe('plate jobs', () => {
  it('takes the first shot by time and its mark, and the stage without the @rev', async () => {
    const refs = await loadCutsceneRefs(fakeRoot());
    const dirs = new Map(['m.a1.90.one', 'm.a1.91.two', 'm.dev.x'].map((id) => [id, director(id)] as const));
    const { jobs, problems } = plateJobs(refs, dirs, pickRefs('act1'));
    expect(problems).toEqual([]);
    expect(jobs.map((j) => [j.ref, j.stage, j.mark, j.yawDeg, j.lens])).toEqual([
      ['cut.story.m.a1.90.one', 'beat.one', 'wide', 10, 'wide'],
      ['cut.story.m.a1.91.two', 'beat.two', 'wide', 10, 'wide'],
    ]);
  });

  it('names a ref without a stage or without its DirectorScript', async () => {
    const refs = await loadCutsceneRefs(fakeRoot());
    const { jobs, problems } = plateJobs(refs, new Map(), pickRefs('act1'));
    expect(jobs).toEqual([]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('cut.story.m.a1.90.one');
  });

  it('the Act 1 refs of the repository all have a plate job', async () => {
    const refs = await loadCutsceneRefs(root);
    const dirs = new Map<string, DirectorScript>();
    for (const r of refs) {
      const f = path.join(root, 'assets/src/data', `director.${r.fallback}`, 'director.json');
      if (existsSync(f)) dirs.set(r.fallback, JSON.parse(readFileSync(f, 'utf8')) as DirectorScript);
    }
    const { jobs, problems } = plateJobs(refs, dirs, pickRefs('act1'));
    expect(problems).toEqual([]);
    expect(jobs).toHaveLength(9);
  });
});

describe('plate lock', () => {
  it('pins a hash once; a changed hash needs refresh', () => {
    const a = mergeLock(emptyPlateLock(), [{ stage: 'beat.one', sha256: 'a'.repeat(64) }], false);
    expect(a.lock.plates['beat.one']?.sha256).toBe('a'.repeat(64));
    const b = mergeLock(a.lock, [{ stage: 'beat.one', sha256: 'b'.repeat(64) }], false);
    expect(b.problems).toHaveLength(1);
    expect(b.lock.plates['beat.one']?.sha256).toBe('a'.repeat(64));
    const c = mergeLock(a.lock, [{ stage: 'beat.one', sha256: 'b'.repeat(64) }], true);
    expect(c.problems).toEqual([]);
    expect(c.lock.plates['beat.one']?.sha256).toBe('b'.repeat(64));
  });
});

describe('assets:plates run', () => {
  const quiet = () => ({ lines: [] as string[], log(l: string) { this.lines.push(l); } });
  const png = (n: number) => new Uint8Array([137, 80, 78, 71, n]);
  const renderer = (): PlateRenderer => ({ render: async (j) => ({ png: png(j.ref.length), worldPacks: ['c'.repeat(64)] }), close: async () => undefined });

  it('skips with a reason when no renderer starts, lists the refs, prints the upload SKIP and exits 0', async () => {
    const r = fakeRoot();
    const out = quiet();
    const code = await runPlates({ root: r, refs: 'act1', refresh: false, env: {}, log: (l) => out.log(l), renderer: async () => ({ ok: false, reason: 'no WebGPU adapter' }) });
    expect(code).toBe(0);
    expect(out.lines.join('\n')).toContain('SKIP assets:plates render: no WebGPU adapter');
    expect(out.lines.join('\n')).toContain('cut.story.m.a1.90.one, cut.story.m.a1.91.two');
    expect(out.lines).toContain('SKIP assets:plates upload: R2_ACCESS_KEY_ID not set');
    expect(existsSync(path.join(r, 'content/cutscenes/plates.lock.json'))).toBe(false);
  });

  it('renders the refs without a plate, writes the lock, does not render a pinned one twice, and prints the upload SKIP without credentials', async () => {
    const r = fakeRoot();
    const out = quiet();
    expect(await runPlates({ root: r, refs: 'act1', refresh: false, env: {}, log: (l) => out.log(l), renderer: async () => ({ ok: true, renderer: renderer() }) })).toBe(0);
    const lock = JSON.parse(readFileSync(path.join(r, 'content/cutscenes/plates.lock.json'), 'utf8')) as { plates: Record<string, { sha256: string; ref: string }> };
    expect(Object.keys(lock.plates)).toEqual(['beat.one', 'beat.two']);
    expect(lock.plates['beat.one']?.sha256).toBe(sha256Of(png('cut.story.m.a1.90.one'.length)));
    expect(lock.plates['beat.one']?.ref).toBe(plateObjectKey(lock.plates['beat.one']?.sha256 ?? ''));
    expect(out.lines).toContain('SKIP assets:plates upload: R2_ACCESS_KEY_ID not set');
    const again = quiet();
    await runPlates({ root: r, refs: 'act1', refresh: false, env: {}, log: (l) => again.log(l), renderer: async () => { throw new Error('must not render'); } });
    expect(again.lines[0]).toContain('2 pinned, 0 to render');
  });

  it('uploads with credentials and writes a derived provenance record', () => {
    const r = fakeRoot();
    const file = path.join(r, 'p.png');
    writeFileSync(file, png(1));
    const sha = sha256Of(png(1));
    const calls: string[][] = [];
    const ok = uploadPlate(
      { root: r, env: { R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', CLOUDFLARE_ACCOUNT_ID: 'acct' }, log: () => undefined, run: (_c, argv) => { calls.push(argv); return { status: 0 }; }, createdAt: '2026-10-24T00:00:00Z' },
      file, sha, ['c'.repeat(64)],
    );
    expect(ok).toBe(true);
    expect(calls[0]?.[2]).toBe(`r2:tha-bay-private-staging/plates/${sha}.png`);
    const rec = JSON.parse(readFileSync(path.join(r, 'assets/provenance', sha.slice(0, 2), `${sha}.json`), 'utf8')) as { origin: string; derived_from: string[]; tool: { name: string } };
    expect(rec).toMatchObject({ origin: 'derived', derived_from: ['c'.repeat(64)], tool: { name: 'assets:plates' } });
    expect(plateRecord(sha, [], 'x', '2026-10-24T00:00:00Z').paths).toEqual([`plates/${sha}.png`]);
    expect(uploadPlate({ root: r, env: {}, log: () => undefined, run: () => ({ status: 0 }), createdAt: '' }, file, sha, [])).toBe(false);
  });
});
