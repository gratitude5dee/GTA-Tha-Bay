/**
 * assets:retarget --spec (M10a2): the A5 report, the asset spec and the derived provenance record written beside a baked `anim/<slug>.moves`,
 * and the refusals (no record for the authored clip file, no published character). Synthetic mannequin clips; nothing leaves the temp tree.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { useTempDirs } from '../../ci/test-tmp.ts';
import { sha256Hex } from '../../ci/lib/common.ts';
import { buildRecord } from '../provenance-new.ts';
import { retargetCommand } from '../src/retarget-cli.ts';
import { glbJson, type Retarget5 } from '../src/moves-check.ts';
import { buildMannequin } from './helpers/mannequin.ts';

const tempDir = useTempDirs();

async function tree(opts: { clipRecord: boolean; character: boolean }): Promise<{ root: string; clipsSha: string }> {
  const root = tempDir('dv-moves-asset-');
  const put = (rel: string, data: string | Uint8Array): void => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), data);
  };
  const clips = await buildMannequin({ clipsOnly: true, heightM: 1.75, clips: [{ name: '5L', fps: 60, seconds: 14 / 60 }, { name: '5M', fps: 60, seconds: 19 / 60 }] });
  const clipsSha = sha256Hex(clips);
  put('assets/src/anim/mannequin/clips.glb', clips);
  if (opts.clipRecord) {
    const rec = buildRecord({ sha256: clipsSha, paths: ['assets/src/anim/mannequin/clips.glb'], kind: 'anim', origin: 'authored', license: 'LicenseRef-DeeVerse-Owned', authors: ['studio:dee-verse'], createdAt: '2026-10-28T00:00:00Z' });
    put(`assets/provenance/${clipsSha.slice(0, 2)}/${clipsSha}.json`, `${JSON.stringify(rec, null, 2)}\n`);
  }
  if (opts.character) {
    put('assets/src/character/fixture-mc/desktop.glb', await buildMannequin({ heightM: 1.7 }));
    put('assets/src/character/fixture-mc/asset.json', JSON.stringify({
      kind: 'character', id: 'fixture-mc', variants: { hi: 'assets/src/character/fixture-mc/desktop.glb' }, deps: [], tags: ['char:fixture-mc', 'class:hero'],
      extras: { t: 'character', npcId: 'fixture-mc', rigFamily: 'bay_rig_v1', heightM: 1.7, bones: { jaw: false, fingers: false }, animSets: [], portrait: 'portrait/fixture-mc' },
      likeness: { tier: 'original', subjectId: null, soulVersion: 1, faceReferenceUsed: false, voiceMode: 'none', photoreal: false, disclaimer: 'none' }, status: 'active', visibility: 'public',
    }));
  }
  return { root, clipsSha };
}

const argv = ['--rig', 'bay_rig_v1', '--clips', 'assets/src/anim/mannequin/clips.glb', '--to', 'fixture-mc', '--fps', '60', '--target', 'assets/src/character/fixture-mc/desktop.glb', '--height', '1.7'];

describe('assets:retarget --spec', () => {
  it('writes the baked file, retarget.json with a passing A5, asset.json and a derived record that chains to the authored clip file', async () => {
    const { root, clipsSha } = await tree({ clipRecord: true, character: true });
    const logs: string[] = [];
    const code = await retargetCommand([...argv, '--spec', '--by', 'art-lead'], root, (l) => logs.push(l));
    expect(code, logs.join('\n')).toBe(0);
    const dir = 'assets/src/anim/fixture-mc.moves';
    const report = JSON.parse(readFileSync(path.join(root, dir, 'retarget.json'), 'utf8')) as Retarget5;
    expect(report).toMatchObject({ schema: 'retarget-report/1', slug: 'fixture-mc', rig: 'bay_rig_v1', fps: 60, a5: 'pass' });
    expect(report.clips.map((c) => [c.name, c.frames, c.status])).toEqual([['5L', 14, 'pass'], ['5M', 19, 'pass']]);
    const glb = new Uint8Array(readFileSync(path.join(root, dir, 'default.glb')));
    expect((glbJson(glb).animations ?? []).map((a) => a.name)).toEqual(['5L', '5M']);
    const spec = JSON.parse(readFileSync(path.join(root, dir, 'asset.json'), 'utf8')) as { kind: string; id: string; variants: Record<string, string>; tags: string[]; likeness: { tier: string } };
    expect(spec).toMatchObject({ kind: 'anim', id: 'fixture-mc.moves', variants: { default: `${dir}/default.glb` }, likeness: { tier: 'original' } });
    expect(spec.tags).toEqual(['fighter', 'char:fixture-mc']);
    const sha = sha256Hex(glb);
    const rec = JSON.parse(readFileSync(path.join(root, 'assets/provenance', sha.slice(0, 2), `${sha}.json`), 'utf8')) as ProvenanceRecord;
    expect(rec).toMatchObject({ kind: 'anim', origin: 'derived', derived_from: [clipsSha], ai_generated: false, likeness: { tier: 'original', face_reference_used: false, photoreal: false }, tool: { name: 'assets:retarget' } });
    expect(rec.paths).toEqual([`${dir}/default.glb`]);
  }, 120_000);

  it('refuses --spec when the authored clip file has no provenance record, and when the character has no spec', async () => {
    const a = await tree({ clipRecord: false, character: true });
    const logsA: string[] = [];
    expect(await retargetCommand([...argv, '--spec'], a.root, (l) => logsA.push(l))).toBe(1);
    expect(logsA.join('\n')).toMatch(/has no provenance record: run provenance:new/);
    expect(existsSync(path.join(a.root, 'assets/src/anim/fixture-mc.moves/asset.json'))).toBe(false);
    const b = await tree({ clipRecord: true, character: false });
    const logsB: string[] = [];
    const code = await retargetCommand([...argv, '--spec'], b.root, (l) => logsB.push(l));
    expect(code).toBe(1);
  }, 120_000);

  it('without --spec it writes only the baked file and the A5 report', async () => {
    const { root } = await tree({ clipRecord: true, character: true });
    expect(await retargetCommand(argv, root, () => undefined)).toBe(0);
    expect(existsSync(path.join(root, 'assets/src/anim/fixture-mc.moves/default.glb'))).toBe(true);
    expect(existsSync(path.join(root, 'assets/src/anim/fixture-mc.moves/retarget.json'))).toBe(true);
    expect(existsSync(path.join(root, 'assets/src/anim/fixture-mc.moves/asset.json'))).toBe(false);
  }, 120_000);
});
