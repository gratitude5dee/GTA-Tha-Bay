/**
 * assets:verify --slug, assets:lock and assets:publish --slug on a character that the mock pipeline published into a temporary tree (M10a1,
 * spec section 12). A mock run can never pass: its records say `executor: mock`. The same tree with live-looking records passes every gate,
 * which shows that the specs, the files and the provenance chain the publish stage writes are what the catalog build and the gates expect.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { makeHarness, walkStandard } from '../../../services/pipeline/test/helpers/character-harness.ts';
import { repoRoot } from '../../ci/run.ts';
import { useTempDirs } from '../../ci/test-tmp.ts';
import { main } from '../gen/cli.ts';
import { readLock, recordMap, updateLock, writeLock } from '../src/lock.ts';
import { loadSpecs } from '../src/spec.ts';
import { publishAssets } from '../src/publish.ts';
import { verifySlug } from '../src/verify-slug.ts';
import { probeBones, withProbedAliases } from '../src/probe-bones.ts';
import { runProbeBones, RIG_FILE } from '../src/probe-run.ts';
import { buildMannequin } from './helpers/mannequin.ts';

const tempDir = useTempDirs();
let tree: string;
let published: Map<string, Uint8Array>;

function mkTree(): string {
  const root = tempDir('dv-verify-slug-');
  for (const f of ['config/asset-budgets.json', 'config/license-allowlist.json', 'config/consent-index.json', 'packages/shared/src/rig/bay_rig_v1.json']) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    cpSync(path.join(repoRoot, f), path.join(root, f));
  }
  return root;
}

function write(root: string, files: Map<string, Uint8Array>): void {
  for (const [rel, bytes] of files) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), bytes);
  }
}

/** Records written as a live run would write them. */
function goLive(root: string): void {
  const dir = path.join(root, 'assets/provenance');
  for (const sub of readdirSync(dir)) {
    for (const f of readdirSync(path.join(dir, sub))) {
      const file = path.join(dir, sub, f);
      const rec = JSON.parse(readFileSync(file, 'utf8')) as ProvenanceRecord;
      if (rec.generator) {
        rec.generator.executor = 'cli';
        rec.generator.env = 'production';
      }
      writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
    }
  }
}

beforeAll(async () => {
  const h = await makeHarness({ subject: { slug: 'fixture-mc' } });
  const done = await walkStandard(h);
  expect(done.status, done.detail).toBe('complete');
  published = h.published;
  tree = mkTree();
  write(tree, published);
}, 240_000);

describe('assets:verify --slug', () => {
  it('rejects a mock run: its provenance records say executor mock', async () => {
    const r = await verifySlug(tree, 'fixture-mc');
    expect(r.findings.some((f) => f.rule === 'mock-reference')).toBe(true);
    expect(r.findings.some((f) => f.rule === 'env-not-production')).toBe(true);
  });

  it('reports a missing character as slug-missing', async () => {
    const r = await verifySlug(tree, 'nobody');
    expect(r.findings.map((f) => f.rule)).toEqual(['slug-missing']);
  });

  it('passes A4, A6, A7 and A8 on live-looking records once the lock holds the character, and the catalog builds from the specs', async () => {
    goLive(tree);
    const before = await verifySlug(tree, 'fixture-mc');
    expect(before.findings.map((f) => f.rule)).toContain('not-in-lock');
    const { specs } = loadSpecs(tree);
    expect(specs.map((s) => s.ref).sort()).toEqual(['anim/fixture-mc.base', 'character/fixture-mc', 'mouth_atlas/fixture-mc', 'portrait/fixture-mc']);
    const { lock } = updateLock(specs, readLock(tree), recordMap(tree), 'art-lead', '2026-10-27T13:00:00Z');
    writeLock(tree, lock);
    const after = await verifySlug(tree, 'fixture-mc');
    expect(after.findings, after.findings.map((f) => `${f.gate} ${f.file} ${f.rule} ${f.detail}`).join('\n')).toEqual([]);
    expect(after.notes.join(' ')).toMatch(/A4: 22 bones, 5 clips/);
    expect(after.notes.join(' ')).toMatch(/A7: SSIM/);
    expect(lock.entries['character/fixture-mc']?.root).toMatch(/^[0-9a-f]{64}$/);
  });

  it('assets:publish --slug runs the character gates, then uploads the catalog to a directory target', async () => {
    const logs: string[] = [];
    const dest = path.join(tempDir('dv-verify-dest-'), 'out');
    const res = await publishAssets({ root: tree, env: 'staging', target: `dir:${dest}`, slug: 'fixture-mc', log: (l) => logs.push(l), stamp: { gitSha: '0'.repeat(40), createdAt: 0 }, distRoot: path.join(tree, 'dist') });
    expect(res.code, logs.join('\n')).toBe(0);
    expect(logs.join('\n')).toMatch(/verify fixture-mc: A4: 22 bones/);
    expect(existsSync(dest)).toBe(true);
    // and a character that fails its gates uploads nothing
    const bad = mkTree();
    write(bad, published);
    goLive(bad);
    const specFile = path.join(bad, 'assets/src/character/fixture-mc/asset.json');
    const spec = JSON.parse(readFileSync(specFile, 'utf8')) as { stats: Record<string, { tris: number }> };
    (spec.stats['mobile-low'] as { tris: number }).tris = 999_999;
    writeFileSync(specFile, JSON.stringify(spec, null, 2));
    const { specs } = loadSpecs(bad);
    writeLock(bad, updateLock(specs, null, recordMap(bad), 'art-lead', '2026-10-27T13:00:00Z').lock);
    const logs2: string[] = [];
    const res2 = await publishAssets({ root: bad, env: 'staging', target: `dir:${path.join(tempDir('dv-verify-dest2-'), 'out')}`, slug: 'fixture-mc', log: (l) => logs2.push(l), stamp: { gitSha: '0'.repeat(40), createdAt: 0 }, distRoot: path.join(bad, 'dist') });
    expect(res2.code).toBe(1);
    expect(logs2.join('\n')).toMatch(/FAILED its character gates|verify FAILED/);
    expect(res2.uploaded).toBe(0);
  });
});

describe('assets:verify --slug --probe-bones', () => {
  const vendor = (b: string): string => `mixamorig:${b === 'hips' ? 'Hips' : b}`;

  it('proposes aliases for Mixamo-style names and leaves unplaceable bones unmapped', async () => {
    const names: Record<string, string> = {
      hips: 'mixamorig:Hips', spine: 'mixamorig:Spine', chest: 'mixamorig:Spine1', upperChest: 'mixamorig:Spine2', neck: 'mixamorig:Neck', head: 'mixamorig:Head',
      l_shoulder: 'mixamorig:LeftShoulder', l_upperArm: 'mixamorig:LeftArm', l_lowerArm: 'mixamorig:LeftForeArm', l_hand: 'mixamorig:LeftHand',
      r_shoulder: 'mixamorig:RightShoulder', r_upperArm: 'mixamorig:RightArm', r_lowerArm: 'mixamorig:RightForeArm', r_hand: 'mixamorig:RightHand',
      l_upperLeg: 'mixamorig:LeftUpLeg', l_lowerLeg: 'mixamorig:LeftLeg', l_foot: 'mixamorig:LeftFoot', l_toes: 'mixamorig:LeftToeBase',
      r_upperLeg: 'mixamorig:RightUpLeg', r_lowerLeg: 'mixamorig:RightLeg', r_foot: 'mixamorig:RightFoot', r_toes: 'Unknown_Toe_Bone',
    };
    const glb = await buildMannequin({ name: (b) => names[b] ?? vendor(b) });
    const table = JSON.parse(readFileSync(path.join(repoRoot, RIG_FILE), 'utf8')) as Record<string, unknown>;
    const probe = await probeBones(glb, table as never);
    expect(probe.aliases['mixamorig:Spine1']).toBe('chest');
    expect(probe.aliases['mixamorig:LeftToeBase']).toBe('l_toes');
    expect(probe.missing).toEqual(['r_toes']);
    expect(probe.extra).toEqual(['Unknown_Toe_Bone']);
    const next = withProbedAliases(table, probe, 'rigged.glb') as { probed: boolean; probedFrom: string; aliases: Record<string, string> };
    expect(next.probed).toBe(true);
    expect(Object.keys(next.aliases)).toHaveLength(21);
  });

  it('writes the table into the tree and exits non-zero while a required bone is unplaced', async () => {
    const root = mkTree();
    const names = (b: string): string => (b === 'r_toes' ? 'Odd_Toe' : `mixamorig:${b}`);
    const glb = await buildMannequin({ name: names });
    const dir = path.join(root, '.genai/work/character/zed/rig/abc');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'rigged.glb'), glb);
    const logs: string[] = [];
    // mixamorig:<canonical> is not in the Mixamo table, so most bones stay unplaced: the command must say so and exit 1
    expect(await runProbeBones(root, 'zed', undefined, (l) => logs.push(l))).toBe(1);
    expect(logs.join('\n')).toMatch(/unplaced required bones/);
    expect(JSON.parse(readFileSync(path.join(root, RIG_FILE), 'utf8'))).toMatchObject({ probed: true });
    expect(await runProbeBones(root, 'nobody', undefined, (l) => logs.push(l))).toBe(1);
  });
});

describe('assets:gen gate', () => {
  it('records a decision in the run and refuses an H1 for a parody design without the checklist', async () => {
    const root = mkTree();
    mkdirSync(path.join(root, 'content/npcs/zed'), { recursive: true });
    cpSync(path.join(repoRoot, 'content/npcs/canary-mc/soul.md'), path.join(root, 'content/npcs/zed/soul.md'));
    const soul = readFileSync(path.join(root, 'content/npcs/zed/soul.md'), 'utf8').replace('id: canary-mc', 'id: zed').replace('basis: original', 'basis: real_person');
    writeFileSync(path.join(root, 'content/npcs/zed/soul.md'), soul);
    const roster = JSON.parse(readFileSync(path.join(repoRoot, 'content/npcs/roster.json'), 'utf8')) as { entries: Record<string, unknown>[] };
    roster.entries = [{ ...(roster.entries.find((e) => e['id'] === 'canary-mc') as Record<string, unknown>), id: 'zed', soul: 'content/npcs/zed/soul.md' }];
    mkdirSync(path.join(root, 'content/npcs'), { recursive: true });
    writeFileSync(path.join(root, 'content/npcs/roster.json'), JSON.stringify(roster));
    mkdirSync(path.join(root, 'config'), { recursive: true });
    cpSync(path.join(repoRoot, 'config/genai-endpoints.json'), path.join(root, 'config/genai-endpoints.json'));
    const logs: string[] = [];
    const run = (argv: string[]): Promise<number> => main(['gate', ...argv], {}, fetch, (l) => logs.push(l), { root, now: () => Date.parse('2026-10-27T12:00:00Z') });
    const { runIdOf } = await import('../../../services/pipeline/src/steps/character.ts');
    const { loadWorld } = await import('../gen/plan.ts');
    const subject = loadWorld(root).entries[0]?.subject;
    expect(subject?.tier).toBe('fictionalized');
    const runId = runIdOf(subject as never);
    expect(await run(['--run', runId, '--gate', 'H1', '--choose', '2', '--by', 'art-lead'])).toBe(1);
    expect(logs.join('\n')).toMatch(/H1 checklist for a fictionalized character/);
    expect(await run(['--run', runId, '--gate', 'H1', '--choose', '2', '--by', 'art-lead', '--checklist'])).toBe(0);
    expect(logs.join('\n')).toMatch(/recorded H1 approve \(choice 2\) by art-lead/);
    const saved = JSON.parse(readFileSync(path.join(root, `.genai/work/character/zed/run.json`), 'utf8')) as { review: { gate: string; choose: number; note: string; at: string }[] };
    expect(saved.review).toEqual([{ gate: 'H1', by: 'art-lead', decision: 'approve', note: 'H1 checklist confirmed', choose: 2, at: '2026-10-27T12:00:00Z' }]);
    // a stale run id, a missing choice and an unknown gate are refused
    expect(await run(['--run', 'zed-00000000', '--gate', 'H3', '--choose', '1', '--by', 'x'])).toBe(1);
    expect(await run(['--run', runId, '--gate', 'H3', '--by', 'x'])).toBe(2);
    expect(await run(['--run', runId, '--gate', 'H9', '--choose', '1', '--by', 'x'])).toBe(2);
    expect(await run(['--run', runId, '--gate', 'H4', '--choose', '1', '--by', 'art-lead', '--anchor', '0,1.5,0.09', '--jaw'])).toBe(0);
    const again = JSON.parse(readFileSync(path.join(root, `.genai/work/character/zed/run.json`), 'utf8')) as { review: { gate: string; data?: Record<string, unknown> }[] };
    expect(again.review[1]).toMatchObject({ gate: 'H4', data: { jaw: true, fingers: false, mouthAnchor: [0, 1.5, 0.09] } });
  });
});
