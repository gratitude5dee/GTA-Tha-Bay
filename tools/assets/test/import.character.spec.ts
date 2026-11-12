/** M10d4 AC-3 and AC-5: the intake rules for a character base (bones, rest pose, influences, adult check) and the kit's own files. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolsRoot } from '../../ci/lib/common.ts';
import type { RigFamily } from '../../../packages/shared/src/assets/gates/index.ts';
import { readGlb, validateGlb, writeGlb } from '../src/glb-inspect.ts';
import { bayRig, incomingBases, inspectBase, snapRestPose } from '../src/import/character.ts';
import { creatorMesh, loadCatalog, loadPeople, pedBodyMesh, pedOutfitMesh } from '../src/people-gen.ts';
import { BONE_REST } from '../src/recipes/rig.ts';
import { writeSkinnedGlb } from '../src/recipes/skinned-glb.ts';
import type { SkinMesh } from '../src/recipes/skin-mesh.ts';

const d = loadPeople(toolsRoot);
const cat = loadCatalog(toolsRoot);
const rig: RigFamily = bayRig(toolsRoot);
const glb = (m: SkinMesh, id = 'character/fixture'): Promise<Uint8Array> => writeSkinnedGlb(m, { ref: id, fidelity: 'hi' }, 'fixture');

describe('inspectBase on the kit', () => {
  it('passes a ped body at its stature: 22 bones, rest pose on BONE_REST, adult proportions', async () => {
    for (const letter of ['a', 'c', 'd', 'h']) {
      const body = d.pedBodySpecs.find((b) => b.id === letter);
      const bytes = await glb(pedBodyMesh(d, letter, 'hi'));
      const r = await inspectBase(`ped.body.${letter}`, bytes, rig, (body?.heightM ?? 1.8) / 1.8);
      expect(r.findings, letter).toEqual([]);
      expect(r.bones).toHaveLength(22);
      expect(r.restMaxErrM).toBeLessThan(1e-6);
      expect(r.maxInfluences).toBeLessThanOrEqual(4);
      expect(r.weightDeviation).toBeLessThan(0.01);
      expect(r.statureM).toBeGreaterThan(1.55);
      expect(r.statureM).toBeLessThan(1.95);
    }
  });

  it('passes the twelve creator bodies with their face on', async () => {
    for (const b of d.bodies) {
      const m = creatorMesh(d, 'body', b.id, 'mid');
      m.append(creatorMesh(d, 'face', 'face-karl', 'mid'));
      const r = await inspectBase(b.id, await glb(m), rig, b.heightM / 1.8);
      expect(r.findings, b.id).toEqual([]);
    }
  });

  it('passes the Khronos glTF validator with no error on a face, a body, an outfit and a hair style', async () => {
    const files = [creatorMesh(d, 'face', 'face-haight', 'mid'), pedBodyMesh(d, 'b', 'mid'), pedOutfitMesh(d, 13, 'mid'), creatorMesh(d, 'hair', 'hair-locs', 'lo')];
    for (const m of files) {
      const v = await validateGlb(await glb(m));
      expect(v.messages).toEqual([]);
      expect(v.errors).toBe(0);
    }
  });
});

describe('inspectBase on a bad base', () => {
  it('rejects a body too short for an adult and a head too big for one (a child proportion)', async () => {
    const bytes = await glb(pedBodyMesh(d, 'a', 'mid'));
    const short = await inspectBase('short', bytes, rig, 0.8);
    expect(short.findings.map((f) => f.rule)).toContain('adult-stature');
    // grow the head about its centre: a 1.8 m figure with a head that is a quarter of it
    const m = pedBodyMesh(d, 'a', 'mid');
    const big = m.mapped((p, i) => (m.joints[i * 4] === 5 && (m.weights[i * 4] as number) > 0.5 ? [p[0] * 2.2, 1.68 + (p[1] - 1.68) * 2.2, p[2] * 2.2] : p));
    const kid = await inspectBase('kid', await glb(big), rig, 1);
    expect(kid.findings.map((f) => f.rule)).toContain('adult-head');
  });

  it('names a bone that moved more than 1 cm, and snaps it back', async () => {
    const bytes = await glb(pedBodyMesh(d, 'e', 'lo'));
    const doc = await readGlb(bytes);
    const knee = doc.getRoot().listNodes().find((n) => n.getName() === 'l_lowerLeg');
    expect(knee).toBeDefined();
    knee?.setTranslation([0.05, -0.41, 0]);
    const off = await inspectBase('off', await writeGlb(doc), rig, 1.75 / 1.8);
    expect(off.findings.map((f) => f.rule)).toContain('rest-pose');
    expect(off.restMaxErrM).toBeGreaterThan(0.04);
    expect(snapRestPose(doc, rig)).toBeGreaterThan(0);
    const snapped = await inspectBase('snapped', await writeGlb(doc), rig, 1.75 / 1.8);
    expect(snapped.findings.map((f) => f.rule)).not.toContain('rest-pose');
    expect(knee?.getTranslation()).toEqual([BONE_REST.l_lowerLeg[0], BONE_REST.l_lowerLeg[1], BONE_REST.l_lowerLeg[2]]);
  });

  it('maps vendor bone names through the alias table and reports one it does not know', async () => {
    const bytes = await glb(pedBodyMesh(d, 'a', 'lo'));
    const doc = await readGlb(bytes);
    const hips = doc.getRoot().listNodes().find((n) => n.getName() === 'hips');
    hips?.setName('Pelvis_vendor');
    const without = await inspectBase('v', await writeGlb(doc), rig, 1);
    expect(without.findings.map((f) => f.rule)).toContain('bone-unmapped');
    expect(without.unmapped).toContain('Pelvis_vendor');
    const withAlias: RigFamily = { ...rig, aliases: { ...rig.aliases, Pelvis_vendor: 'hips' } };
    const ok = await inspectBase('v', await writeGlb(doc), withAlias, 1);
    expect(ok.findings.map((f) => f.rule)).not.toContain('bone-unmapped');
  });
});

describe('the licensed bases folder', () => {
  it('lists nothing when content-incoming/ is absent or empty, so the recipes stand', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'dv-incoming-'));
    try {
      expect(incomingBases(tmp)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    expect(incomingBases(toolsRoot).every((p) => p.startsWith('content-incoming/'))).toBe(true);
  });
});

describe('the committed kit files', () => {
  it('has three variants within the budget rows and an authored record for each part (AC-3)', () => {
    const budgets = JSON.parse(readFileSync(path.join(toolsRoot, 'config/asset-budgets.json'), 'utf8')) as { rows: { id: string; tag: string; fidelity: Record<'hi' | 'mid' | 'lo', { fileBytes: number; tris?: number }> }[] };
    const fid = { desktop: 'hi', mobile: 'mid', 'mobile-low': 'lo' } as const;
    let checked = 0;
    for (const row of (cat.slots['top'] ?? []).filter((r) => !r.tags.includes('coast'))) {
      const dir = `assets/src/character/pc-${row.id}`;
      const spec = JSON.parse(readFileSync(path.join(toolsRoot, dir, 'asset.json'), 'utf8')) as { variants: Record<string, string>; stats: Record<string, { tris: number }>; tags: string[]; likeness: { tier: string } };
      const b = budgets.rows.find((r) => r.tag === spec.tags[0]);
      expect(b?.id).toBe('character-creator');
      expect(Object.keys(spec.variants).sort()).toEqual(['desktop', 'mobile', 'mobile-low']);
      expect(spec.likeness.tier).toBe('original');
      for (const [v, rel] of Object.entries(spec.variants)) {
        const limit = (b as NonNullable<typeof b>).fidelity[fid[v as keyof typeof fid]];
        expect((spec.stats[v] as { tris: number }).tris).toBeLessThanOrEqual(limit.tris as number);
        expect(existsSync(path.join(toolsRoot, rel))).toBe(true);
      }
      checked++;
    }
    expect(checked).toBe(12);
  });
});
