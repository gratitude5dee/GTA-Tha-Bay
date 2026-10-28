/** assets:optimize on the procedural mannequin (M10a1 AC-7). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import rigJson from '../../../packages/shared/src/rig/bay_rig_v1.json';
import { HUMANOID_BONES } from '../../../packages/shared/src/contracts/anim-states.ts';
import type { FidelityLimits, RigFamily } from '../../../packages/shared/src/assets/gates/index.ts';
import { repoRoot } from '../../ci/run.ts';
import { readGlb, jointNodes } from '../src/glb-inspect.ts';
import { FIDELITIES, optimizeCharacter } from '../src/optimize.ts';
import { statsFindings, type BudgetRow } from '../src/verify.ts';
import { buildMannequin } from './helpers/mannequin.ts';

const rig = rigJson as unknown as RigFamily;
const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'config/asset-budgets.json'), 'utf8')) as { rows: (BudgetRow & { fidelity: Record<string, { tris: number; maxTexPx: number; materials: number; gpuTexBytes: number; fileBytes: number }> })[] };
const hero = budgets.rows.find((r) => r.id === 'character-hero');
if (hero === undefined) throw new Error('character-hero budget row is missing');
const limits = { hi: hero.fidelity['hi']! as never as FidelityLimits, mid: hero.fidelity['mid']! as never as FidelityLimits, lo: hero.fidelity['lo']! as never as FidelityLimits };

describe('assets:optimize', () => {
  it('writes hi, mid and lo GLBs inside the Hero row, moves the clips to an animation asset and keeps the canonical bone names', async () => {
    const glb = await buildMannequin({ repeat: 4, clips: [{ name: 'Idle' }, { name: 'Walk', seconds: 1 }] });
    const r = await optimizeCharacter({ glb, slug: 'fixture', rig, limits, ktx: null });
    expect(r.variants.map((v) => v.fidelity)).toEqual([...FIDELITIES]);
    expect(r.findings).toEqual([]);
    for (const v of r.variants) {
      const lim = limits[v.fidelity];
      expect(v.measure.tris).toBeLessThanOrEqual(lim.tris);
      expect(v.measure.fileBytes).toBeLessThanOrEqual(lim.fileBytes);
      expect(v.glb.length).toBe(v.measure.fileBytes);
      expect(v.stats.bones).toBe(HUMANOID_BONES.length);
      expect(statsFindings(hero, 'character/fixture', v.fidelity === 'hi' ? 'desktop' : v.fidelity === 'mid' ? 'mobile' : 'mobile-low', 'x.glb', v.stats)).toEqual([]);
      const doc = await readGlb(v.glb);
      expect(doc.getRoot().listAnimations()).toHaveLength(0);
      expect(doc.getRoot().getExtras()).toMatchObject({ assetId: 'character/fixture' });
      expect(new Set(jointNodes(doc).map((n) => n.getName()))).toEqual(new Set(HUMANOID_BONES));
    }
    expect(r.clips).toEqual(['Idle', 'Walk']);
    expect(r.anim).not.toBeNull();
    const animDoc = await readGlb(r.anim as Uint8Array);
    expect(animDoc.getRoot().listAnimations().map((a) => a.getName())).toEqual(['Idle', 'Walk']);
    expect(animDoc.getRoot().listMeshes()).toHaveLength(0);
    expect(r.notes.some((n) => n.startsWith('SKIP ktx'))).toBe(true);
  });

  it('renames vendor bones through the alias table and caps the texture edge per fidelity', async () => {
    const vendor = (b: string): string => `mixamorig:${b}`;
    const table: RigFamily = { ...rig, aliases: Object.fromEntries(HUMANOID_BONES.map((b) => [vendor(b), b])) };
    const glb = await buildMannequin({ name: vendor, texturePx: 2048 });
    const r = await optimizeCharacter({ glb, slug: 'vendor', rig: table, limits, ktx: null });
    expect(Object.keys(r.renamed)).toHaveLength(HUMANOID_BONES.length);
    const edges = await Promise.all(r.variants.map(async (v) => (await import('../src/glb-inspect.ts')).maxTexturePx(await readGlb(v.glb))));
    expect(edges).toEqual([limits.hi.maxTexPx, limits.mid.maxTexPx, limits.lo.maxTexPx]);
  });

  it('reports a budget finding when a fidelity cannot meet its row', async () => {
    const glb = await buildMannequin({});
    const tight = { ...limits, lo: { ...limits.lo, fileBytes: 100 } };
    const r = await optimizeCharacter({ glb, slug: 'tight', rig, limits: tight, ktx: null });
    expect(r.findings.some((f) => f.gate === 'A6' && f.rule === 'file-bytes')).toBe(true);
  });
});
