/**
 * assets:optimize (M10a1; spec/domains/05-assets-pipeline.md section 3): one rigged GLB in, three fidelities and an animation asset out.
 *
 *   load -> bay_rig_v1 bone names -> dedup, prune, weld -> animations to `anim/<slug>.base` -> per fidelity: simplify to the triangle
 *   budget, cap the texture edge, optional KTX2, meshopt -> `extras.assetId` -> hash -> gate A6 against the budget row.
 *
 * Pins: @gltf-transform 4.5.1, meshoptimizer 1.3.0 (spec section 3). KTX2 needs the `ktx` tool of KTX-Software; without it the textures stay
 * PNG and the result says so (the file-byte budget then decides at A6). No Draco.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Document } from '@gltf-transform/core';
import { KHRTextureBasisu } from '@gltf-transform/extensions';
import { cloneDocument, dedup, meshopt, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import {
  canonicalBone, checkA6Budget, gpuTexBytes, type FidelityLimits, type FidelityMeasure, type RigFamily,
} from '../../../packages/shared/src/assets/gates/index.ts';
import type { GateFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import type { VariantStats } from '../../../packages/shared/src/assets/c07.ts';
import { decodePng, encodePng, limitEdge } from './image.ts';
import { jointNodes, maxTexturePx, readGlb, textureEdges, triangleCount, vertexCount, writeGlb } from './glb-inspect.ts';

export type Fidelity = 'hi' | 'mid' | 'lo';
export const FIDELITIES: readonly Fidelity[] = ['hi', 'mid', 'lo'];
export const TOOL_NAME = 'assets:optimize';
export const TOOL_VERSION = '1.0.0';

/** The C13 tier ids each fidelity ships as (spec section 3): `desktop`, `mobile` and `mobile-low` are the three files; the rest fall back (A§4.2). */
export const FIDELITY_VARIANT: Readonly<Record<Fidelity, 'desktop' | 'mobile' | 'mobile-low'>> = { hi: 'desktop', mid: 'mobile', lo: 'mobile-low' };

export interface KtxPort {
  /** KTX2 bytes for a PNG, or null when the tool fails. `srgb` for base colour, false for data maps. */
  encode(png: Uint8Array, opts: { srgb: boolean; uastc: boolean }): Uint8Array | null;
}

/** `ktx create` of KTX-Software 4.4.2 through a temporary directory; null when the binary is not installed. */
export function ktxTool(): KtxPort | null {
  const probe = spawnSync('ktx', ['--version'], { encoding: 'utf8' });
  if (probe.error !== undefined || probe.status !== 0) return null;
  return {
    encode(png, o) {
      const dir = mkdtempSync(path.join(tmpdir(), 'dv-ktx-'));
      try {
        const input = path.join(dir, 'in.png');
        const output = path.join(dir, 'out.ktx2');
        writeFileSync(input, png);
        const args = ['create', '--format', o.srgb ? 'R8G8B8A8_SRGB' : 'R8G8B8A8_UNORM', '--encode', o.uastc ? 'uastc' : 'basis-lz', '--generate-mipmap', input, output];
        const r = spawnSync('ktx', args, { encoding: 'utf8' });
        return r.status === 0 ? new Uint8Array(readFileSync(output)) : null;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

export interface OptimizeInput {
  glb: Uint8Array;
  slug: string;
  rig: RigFamily;
  limits: Readonly<Record<Fidelity, FidelityLimits>>;
  ktx?: KtxPort | null;
}

export interface FidelityOutput {
  fidelity: Fidelity;
  glb: Uint8Array;
  sha256: string;
  measure: FidelityMeasure;
  stats: VariantStats;
  findings: GateFinding[];
}

export interface OptimizeResult {
  variants: FidelityOutput[];
  /** The animation-only GLB `anim/<slug>.base`, or null when the model had no clips. */
  anim: Uint8Array | null;
  clips: string[];
  /** The bone renames applied (vendor name to canonical). */
  renamed: Record<string, string>;
  findings: GateFinding[];
  notes: string[];
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

function renameBones(doc: Document, rig: RigFamily): Record<string, string> {
  const renamed: Record<string, string> = {};
  for (const n of jointNodes(doc)) {
    const c = canonicalBone(rig, n.getName());
    if (c !== null && c !== n.getName()) {
      renamed[n.getName()] = c;
      n.setName(c);
    }
  }
  return renamed;
}

async function capTextures(doc: Document, maxEdge: number, ktx: KtxPort | null | undefined, notes: string[], fidelity: Fidelity): Promise<void> {
  const ktxUsed = new Set<string>();
  for (const t of doc.getRoot().listTextures()) {
    const img = t.getImage();
    if (img === null) continue;
    if (t.getMimeType() !== 'image/png') {
      notes.push(`${fidelity}: texture ${t.getName() || '(unnamed)'} is ${t.getMimeType()}, not resized (only PNG is decoded)`);
      continue;
    }
    const raster = limitEdge(decodePng(img), maxEdge);
    const png = encodePng(raster);
    t.setImage(png);
    if (ktx !== null && ktx !== undefined) {
      // Base colour is UASTC and sRGB; ORM and normal maps are linear (spec section 3).
      const isColor = doc.getRoot().listMaterials().some((m) => m.getBaseColorTexture() === t || m.getEmissiveTexture() === t);
      const ktx2 = ktx.encode(png, { srgb: isColor, uastc: fidelity === 'hi' || !isColor });
      if (ktx2 !== null) {
        t.setImage(ktx2).setMimeType('image/ktx2');
        ktxUsed.add(t.getName());
      } else notes.push(`${fidelity}: ktx failed for texture ${t.getName() || '(unnamed)'}; it stays PNG`);
    }
  }
  if (ktxUsed.size > 0) doc.createExtension(KHRTextureBasisu).setRequired(true);
}

export async function optimizeCharacter(i: OptimizeInput): Promise<OptimizeResult> {
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  const notes: string[] = [];
  if (i.ktx === null || i.ktx === undefined) notes.push('SKIP ktx: the KTX-Software tool is not installed; textures stay PNG (install KTX-Software 4.4.2 and re-run before publishing)');
  const base = await readGlb(i.glb);
  const renamed = renameBones(base, i.rig);
  await base.transform(dedup(), prune(), weld());

  // Animations leave the model: they ship as `anim/<slug>.base` (an animation-only GLB on the same bone names).
  const clips = base.getRoot().listAnimations().map((a) => a.getName());
  let anim: Uint8Array | null = null;
  if (clips.length > 0) {
    const animDoc = cloneDocument(base);
    for (const n of animDoc.getRoot().listNodes()) n.setMesh(null).setSkin(null);
    for (const m of animDoc.getRoot().listMeshes()) m.dispose();
    for (const s of animDoc.getRoot().listSkins()) s.dispose();
    for (const m of animDoc.getRoot().listMaterials()) m.dispose();
    for (const t of animDoc.getRoot().listTextures()) t.dispose();
    await animDoc.transform(prune({ keepLeaves: true }));
    animDoc.getRoot().setExtras({ ...animDoc.getRoot().getExtras(), assetId: `anim/${i.slug}.base`, clips });
    await animDoc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    anim = await writeGlb(animDoc);
  }
  for (const a of base.getRoot().listAnimations()) a.dispose();

  const variants: FidelityOutput[] = [];
  const findings: GateFinding[] = [];
  for (const fidelity of FIDELITIES) {
    const limits = i.limits[fidelity];
    const d = cloneDocument(base);
    const tris0 = triangleCount(d);
    if (tris0 > limits.tris) {
      await d.transform(simplify({ simplifier: MeshoptSimplifier, ratio: limits.tris / tris0, error: 0.02 }));
    }
    await capTextures(d, limits.maxTexPx, i.ktx, notes, fidelity);
    d.getRoot().setExtras({ ...d.getRoot().getExtras(), assetId: `character/${i.slug}`, fidelity });
    const tris = triangleCount(d);
    const verts = vertexCount(d);
    const measureBase = {
      tris,
      maxTexPx: maxTexturePx(d),
      materials: d.getRoot().listMaterials().length,
      gpuTexBytes: gpuTexBytes(textureEdges(d)),
    };
    const primitives = d.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0);
    const bones = jointNodes(d).length;
    await d.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const glb = await writeGlb(d);
    const measure: FidelityMeasure = { ...measureBase, fileBytes: glb.length };
    const f = checkA6Budget(`${i.slug}/${fidelity}.glb`, fidelity, measure, limits);
    findings.push(...f);
    variants.push({
      fidelity,
      glb,
      sha256: sha256(glb),
      measure,
      findings: f,
      stats: { tris, verts, bones, materials: measure.materials, primitives, texMaxPx: measure.maxTexPx, texGpuBytes: measure.gpuTexBytes },
    });
  }
  return { variants, anim, clips, renamed, findings, notes };
}
