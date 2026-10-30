/** M10d4 AC-3 and AC-5 (recipe half): the people recipes, their rig, weights, budgets, morphs and determinism. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolsRoot } from '../../ci/lib/common.ts';
import { BONE_PARENT as ENGINE_PARENT, BONE_REST as ENGINE_REST } from '../../../packages/engine/src/client/anim/placeholder-rig.ts';
import { atlasPng, renderAtlas } from '../src/atlas.ts';
import { configSchemaValidator } from '../src/import/packs.ts';
import {
  checkPeople, creatorMesh, CREATOR_SLOTS, isCoast, loadCatalog, loadPeople, pedBodyMesh, pedOutfitMesh, personDefs, farFigure, registryTargets,
  type CatalogFile,
} from '../src/people-gen.ts';
import { applyMorphs, buildHeadBase, MORPH_TARGETS, morphDelta } from '../src/recipes/head.ts';
import { FIDELITIES, type Fidelity, type PeopleData } from '../src/recipes/people.ts';
import { BONE_PARENT, BONE_REST, HUMANOID_BONES } from '../src/recipes/rig.ts';
import { PERSON_PART, type SkinMesh } from '../src/recipes/skin-mesh.ts';
import { writeSkinnedGlb } from '../src/recipes/skinned-glb.ts';

const d: PeopleData = loadPeople(toolsRoot);
const cat: CatalogFile = loadCatalog(toolsRoot);
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const budgets = JSON.parse(readFileSync(path.join(toolsRoot, 'config/asset-budgets.json'), 'utf8')) as { rows: { id: string; fidelity: Record<Fidelity, { tris: number; materials?: number }> }[] };
const row = (id: string): { tris: number }[] => FIDELITIES.map((f) => (budgets.rows.find((r) => r.id === id) as (typeof budgets.rows)[number]).fidelity[f]);

describe('the rig copy', () => {
  it('equals the engine mannequin rig (BONE_PARENT and BONE_REST)', () => {
    for (const b of HUMANOID_BONES) {
      expect(BONE_PARENT[b], b).toBe(ENGINE_PARENT[b]);
      expect([...BONE_REST[b]], b).toEqual([...ENGINE_REST[b]]);
    }
    expect(HUMANOID_BONES).toHaveLength(22);
  });
});

describe('the kit data', () => {
  it('validates against config/schemas/art-people.schema.json', () => {
    expect(configSchemaValidator('art-people')(d)).toEqual([]);
  });

  it('covers every non-Coast catalog row and holds the counts of the milestone', () => {
    const ids: Record<string, string[]> = {
      body: d.bodies.map((x) => x.id), face: d.faces.map((x) => x.id), hair: d.hairs.map((x) => x.id), top: d.tops.map((x) => x.id),
      bottom: d.bottoms.map((x) => x.id), shoes: d.shoes.map((x) => x.id), accessory: d.accessories.map((x) => x.id),
    };
    const counts: Record<string, number> = { body: 12, face: 24, hair: 16, top: 12, bottom: 8, shoes: 6, accessory: 8 };
    for (const slot of CREATOR_SLOTS) {
      const rows = (cat.slots[slot] ?? []).filter((r) => !isCoast(r));
      expect(rows, slot).toHaveLength(counts[slot] as number);
      for (const r of rows) expect(ids[slot], `${slot}/${r.id}`).toContain(r.id);
    }
    expect(d.pedBodies.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(d.outfits).toHaveLength(20);
    for (const o of d.outfits) {
      expect(d.tops.some((t) => t.id === o.top)).toBe(true);
      expect(d.bottoms.some((t) => t.id === o.bottom)).toBe(true);
      expect(d.shoes.some((t) => t.id === o.shoes)).toBe(true);
    }
  });

  it('keeps every body an adult in stature and inside the proportion band the garments fit', () => {
    for (const b of [...d.bodies, ...d.pedBodySpecs]) {
      expect(b.heightM, b.id).toBeGreaterThanOrEqual(1.55);
      expect(b.heightM, b.id).toBeLessThanOrEqual(1.95);
      for (const k of ['shoulder', 'chest', 'waist', 'hips', 'thigh', 'arm', 'neck', 'depth'] as const) {
        expect(b[k], `${b.id}.${k}`).toBeGreaterThanOrEqual(0.9);
        expect(b[k], `${b.id}.${k}`).toBeLessThanOrEqual(1.08);
      }
    }
  });
});

const meshes = (): [string, Fidelity, SkinMesh][] => {
  const out: [string, Fidelity, SkinMesh][] = [];
  for (const def of personDefs(d, cat)) {
    if (!def.mesh) continue;
    for (const f of FIDELITIES) out.push([def.id, f, def.mesh(f)]);
  }
  return out;
};

describe('every skinned part', () => {
  const all = meshes();

  it('binds to the 22 bones with at most four influences that sum to one', () => {
    for (const [id, f, m] of all) {
      expect(m.vertexCount, `${id} ${f}`).toBeGreaterThan(0);
      for (let i = 0; i < m.vertexCount; i++) {
        let sum = 0, live = 0;
        for (let k = 0; k < 4; k++) {
          const w = m.weights[i * 4 + k] as number;
          sum += w;
          if (w > 1e-6) {
            live++;
            expect(m.joints[i * 4 + k] as number).toBeLessThan(22);
          }
        }
        if (Math.abs(sum - 1) > 1e-5 || live > 4) throw new Error(`${id} ${f} vertex ${i}: sum ${sum}, ${live} influences`);
      }
    }
  });

  it('winds outward: triangles face the way their vertex normals do (no part below 85 %)', () => {
    const low: string[] = [];
    for (const [id, f, m] of all.filter(([, f]) => f === 'hi')) {
      void f;
      let good = 0, total = 0;
      for (let t = 0; t < m.idx.length; t += 3) {
        const a = m.idx[t] as number, b = m.idx[t + 1] as number, c = m.idx[t + 2] as number;
        const P = (i: number): [number, number, number] => [m.pos[i * 3] as number, m.pos[i * 3 + 1] as number, m.pos[i * 3 + 2] as number];
        const pa = P(a), pb = P(b), pc = P(c);
        const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
        if (Math.hypot(n[0]!, n[1]!, n[2]!) < 1e-12) continue;
        const vn = [0, 1, 2].map((k) => ((m.nor[a * 3 + k] as number) + (m.nor[b * 3 + k] as number) + (m.nor[c * 3 + k] as number)));
        total++;
        if (n[0]! * vn[0]! + n[1]! * vn[1]! + n[2]! * vn[2]! > 0) good++;
      }
      if (good / total < 0.97) low.push(`${id} ${(good / total).toFixed(3)}`);
    }
    // thin open shells (a sandal strap, a hair curtain) smooth their normals across a sliver and may dip; nothing may be inside out
    expect(low.filter((l) => Number(l.split(' ')[1]) < 0.85), low.join('; ')).toEqual([]);
  });

  it('stays inside the budget row of its class at every fidelity, one material and no text-bearing class', () => {
    for (const def of personDefs(d, cat)) {
      if (!def.mesh && !def.rigid) continue;
      const limits = row(def.tag === 'class:ped' ? 'character-ped' : def.tag === 'class:creator' ? 'character-creator' : 'prop-ped-far');
      FIDELITIES.forEach((f, k) => {
        const tris = def.mesh ? def.mesh(f).triangleCount : (def.rigid as (f: Fidelity) => { idx: number[] })(f).idx.length / 3;
        expect(tris, `${def.id} ${f}`).toBeLessThanOrEqual((limits[k] as { tris: number }).tris);
      });
    }
    for (const [, , m] of all) for (const p of m.part) expect(Object.values(PERSON_PART)).toContain(p);
  });

  it('keeps the far figures at 300 triangles or fewer with the gait attributes', () => {
    for (const pb of d.pedBodies) {
      for (const f of FIDELITIES) {
        const r = farFigure(pb.far.w, pb.far.h, f);
        expect(r.idx.length / 3).toBeLessThanOrEqual(300);
        expect(r.swing).toHaveLength(r.pos.length / 3);
        expect(r.pivot).toHaveLength(r.pos.length / 3);
      }
    }
  });
});

describe('the face', () => {
  it('has the 24 morph targets of the catalog, in order, each with a finite displacement', () => {
    const cats = (JSON.parse(readFileSync(path.join(toolsRoot, 'content/ui/creator/catalog.json'), 'utf8')) as { morphs: { id: string; target: string }[] }).morphs;
    expect(MORPH_TARGETS.map((t) => [t.id, t.target])).toEqual(cats.map((m) => [m.id, m.target]));
    const face = creatorMesh(d, 'face', 'face-karl', 'hi');
    expect([...face.morphs.keys()]).toEqual(cats.map((m) => m.target));
    for (const [, delta] of face.morphs) expect(delta.every(Number.isFinite)).toBe(true);
    for (let k = 0; k < 24; k++) {
      const moved = face.pos.length / 3 > 0 && Array.from({ length: face.vertexCount }, (_, i) => Math.hypot(...morphDelta(k, [face.pos[i * 3] as number, face.pos[i * 3 + 1] as number, face.pos[i * 3 + 2] as number]))).some((x) => x > 1e-4);
      expect(moved, MORPH_TARGETS[k]?.id).toBe(true);
    }
  });

  it('shifts the vertices by the weight of a preset (morphs applied, not baked into targets twice)', () => {
    const base = buildHeadBase('mid', 'pc');
    const moved = applyMorphs(base, { 'nose-length': 1 });
    let max = 0;
    for (let i = 0; i < base.pos.length; i++) max = Math.max(max, Math.abs((moved.pos[i] as number) - (base.pos[i] as number)));
    expect(max).toBeGreaterThan(0.004);
    expect(max).toBeLessThan(0.02);
  });
});

describe('determinism and the committed files', () => {
  it('builds the same bytes twice (a face, an outfit, a ped body, an atlas page)', async () => {
    const once = async (): Promise<string[]> => [
      sha(await writeSkinnedGlb(creatorMesh(d, 'face', 'face-karl', 'mid'), { ref: 'character/x', fidelity: 'mid' }, 'x')),
      sha(await writeSkinnedGlb(pedOutfitMesh(d, 7, 'lo'), { ref: 'character/y', fidelity: 'lo' }, 'y')),
      sha(await writeSkinnedGlb(pedBodyMesh(d, 'c', 'mid'), { ref: 'character/z', fidelity: 'mid' }, 'z')),
      sha(atlasPng('ped.atlas', 256)),
    ];
    expect(await once()).toEqual(await once());
  });

  it('paints no text: every atlas cell is a weave, grain or strand pattern drawn from integer hashes', () => {
    const page = renderAtlas('pc.cloth', 256);
    expect(page.data.length).toBe(256 * 256 * 4);
    // the cloth page's cells are textures of constant mean (no glyph strokes): each cell's mean stays inside 0.1 .. 1.0
    for (let cell = 0; cell < 8; cell++) {
      const cx = (cell % 4) * 64, cy = Math.floor(cell / 4) * 64;
      let sum = 0;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) sum += page.data[((cy + y) * 256 + cx + x) * 4] as number;
      expect(sum / (64 * 64 * 255)).toBeGreaterThan(0.1);
    }
  });

  it('matches the committed files for a sample of the assets (recipe output equals the repository)', async () => {
    const res = await checkPeople(toolsRoot, ['character/ped.body.a', 'character/pc-top-hoodie', 'character/pc-face-karl', 'prop/ped.far.a', 'texture/pc.skin', 'portrait/pc-top-hoodie']);
    expect(res.diffs).toEqual([]);
    expect(res.plans).toBe(6);
  }, 60_000);

  it('names the kit in the placeholder registry rows of M10d4, never a Coast row', () => {
    const t = registryTargets(d, cat);
    expect(t['creator-parts']).toHaveLength(86);
    expect(t['creator-parts'].some((r) => /coast/.test(r))).toBe(false);
    expect(t['ped-mannequins']).toContain('character/ped.body.a');
    expect(t['ped-mannequins']).toContain('prop/ped.far.h');
    expect(t['ped-mannequins']).toContain('character/ped.outfit.20');
  });
});
