/**
 * The people kit of M10d4 as assets: every recipe output with its files, spec and provenance (`assets:import -- characters`).
 *
 *   character/pc-<part id>      the creator part rows (Body, Face, Hair, top, bottom, shoes, accessory), the six Coast rows left to M10a2
 *   portrait/pc-<part id>       the 256 px cards, rendered by the software rasteriser from the part itself
 *   character/ped.body.{a..h}   a body with its face and hair, for the near pedestrians
 *   character/ped.outfit.NN     twenty outfits from the same recipes
 *   prop/ped.far.{a..h}         rigid far figures, at most 300 triangles, with the gait attributes
 *   texture/{pc.skin,pc.cloth,pc.hair,ped.atlas}   the atlas pages at 1,024 / 512 / 256 px
 *
 * Every file is `authored` (licence LicenseRef-DeeVerse-Owned): no licensed base is imported while none is in `content-incoming/`
 * (BD-M10d4-01). Deterministic: two runs give the same bytes. The file names and ids carry no real name, no mark, no franchise string.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalize } from '../../../packages/shared/src/json.ts';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { diffPlan, type AssetPlan } from '../../map/src/landmarks/kit/build.ts';
import { atlasPng, ATLAS_IDS, ATLAS_SIZES, type AtlasId } from './atlas.ts';
import { applyMorphs, buildFace, buildHair, buildHeadBase } from './recipes/head.ts';
import {
  buildBodySkin, FIDELITIES, VARIANT_OF, type BodySpec, type Fidelity, type PeopleData,
} from './recipes/people.ts';
import { FRONT_VIEW, renderCard, THREE_QUARTER, DEFAULT_TINTS, type Tints } from './recipes/people-preview.ts';
import { lin } from './recipes/mesh.ts';
import { RIG_HEIGHT_M } from './recipes/rig.ts';
import { writeRigidGlb, writeSkinnedGlb, type RigidMesh, type SkinnedExtras } from './recipes/skinned-glb.ts';
import { PERSON_PART, SkinMesh, smoothNormals, tube, type Ring } from './recipes/skin-mesh.ts';
import { buildAccessory, buildBottom, buildShoes, buildTop } from './recipes/wear.ts';
import { encodePng } from './image.ts';
import { cellOf } from './recipes/people.ts';

export const PEOPLE_GEN_VERSION = '1.0.0';
export const PEOPLE_GEN_TOOL = 'tools/assets people';
/** Fixed so records are reproducible: the recipes are repo content, not a download. */
export const PEOPLE_GEN_CREATED_AT = '2026-10-30T00:00:00Z';
export const PEOPLE_FILE = 'content/art/people.json';
export const CATALOG_FILE = 'content/ui/creator/catalog.json';

const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

export type CreatorSlot = 'body' | 'face' | 'hair' | 'top' | 'bottom' | 'shoes' | 'accessory';
export const CREATOR_SLOTS: readonly CreatorSlot[] = ['body', 'face', 'hair', 'top', 'bottom', 'shoes', 'accessory'];

export interface CatalogRow { id: string; index: number; tags: string[]; tint?: number; color?: string }
export interface CatalogFile { slots: Record<string, CatalogRow[]>; palettes: { skin: string[]; hair: string[] } }

export const isCoast = (r: CatalogRow): boolean => r.tags.includes('coast');

export function loadPeople(root: string): PeopleData {
  return JSON.parse(readFileSync(path.join(root, PEOPLE_FILE), 'utf8')) as PeopleData;
}

export function loadCatalog(root: string): CatalogFile {
  return JSON.parse(readFileSync(path.join(root, CATALOG_FILE), 'utf8')) as CatalogFile;
}

// ---- tints of the cards (the same rule as the creator's mannequin path, packages/ui/src/creator/stage.ts) --------------------------

function hsl(h: number, s: number, l: number): number {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const to = (x: number): number => Math.round(x * 255);
  return (to(f(0)) << 16) | (to(f(8)) << 8) | to(f(4));
}

export function rowColor(slot: CreatorSlot, r: CatalogRow): number {
  if (r.color !== undefined) return Number.parseInt(r.color.replace('#', ''), 16);
  const t = r.tint ?? 0;
  switch (slot) {
    case 'top': return hsl(t, 0.55, 0.5);
    case 'bottom': return hsl(t, 0.4, 0.32);
    case 'shoes': return hsl(t, 0.2, 0.75);
    default: return hsl(t, 0.45, 0.5);
  }
}

// ---- the definitions -------------------------------------------------------------------------------------------------------------

export type PersonKind = 'character' | 'prop' | 'texture' | 'portrait';

export interface PersonDef {
  kind: PersonKind;
  /** `pc-top-hoodie`, `ped.body.a`, `ped.far.a`, `pc.skin`. */
  id: string;
  tag: string;
  /** The creator slot of a `pc-` part. */
  slot?: CreatorSlot;
  /** Catalog row of a `pc-` part. */
  row?: CatalogRow;
  /** The mesh at one fidelity (characters and props). */
  mesh?(f: Fidelity): SkinMesh;
  rigid?(f: Fidelity): RigidMesh;
  heightM?: number;
  atlas?: AtlasId;
}

const bodyById = (d: PeopleData, id: string): BodySpec => (d.bodies.find((b) => b.id === id) ?? d.pedBodySpecs.find((b) => b.id === id)) as BodySpec;

/** The skinned mesh of a creator part. */
export function creatorMesh(d: PeopleData, slot: CreatorSlot, id: string, f: Fidelity): SkinMesh {
  switch (slot) {
    case 'body': return buildBodySkin(bodyById(d, id), f, 'pc');
    case 'face': return buildFace(d.faces.find((x) => x.id === id) ?? null, f, 'pc', true);
    case 'hair': return buildHair(d.hairs.find((x) => x.id === id) as never, f, 'pc');
    case 'top': return buildTop(d.tops.find((x) => x.id === id) as never, f, 'pc');
    case 'bottom': return buildBottom(d.bottoms.find((x) => x.id === id) as never, f, 'pc');
    case 'shoes': return buildShoes(d.shoes.find((x) => x.id === id) as never, f, 'pc');
    case 'accessory': return buildAccessory(d.accessories.find((x) => x.id === id) as never, f, 'pc');
  }
}

function merged(parts: readonly SkinMesh[]): SkinMesh {
  const m = new SkinMesh();
  for (const p of parts) m.append(p);
  return m;
}

/** A near pedestrian's body: bare body, the face with its morphs baked in, and its hair, on the ped atlas. */
export function pedBodyMesh(d: PeopleData, letter: string, f: Fidelity): SkinMesh {
  const pb = d.pedBodies.find((b) => b.id === letter) as PeopleData['pedBodies'][number];
  const face = d.faces.find((x) => x.id === pb.face) as PeopleData['faces'][number];
  const hair = d.hairs.find((x) => x.id === pb.hair) as PeopleData['hairs'][number];
  return merged([buildBodySkin(bodyById(d, pb.body), f, 'ped'), applyMorphs(buildHeadBase(f, 'ped'), face.morphs), buildHair(hair, f, 'ped')]);
}

export function pedOutfitMesh(d: PeopleData, n: number, f: Fidelity): SkinMesh {
  const o = d.outfits[n - 1] as PeopleData['outfits'][number];
  const parts = [
    buildTop(d.tops.find((x) => x.id === o.top) as never, f, 'ped'),
    buildBottom(d.bottoms.find((x) => x.id === o.bottom) as never, f, 'ped'),
    buildShoes(d.shoes.find((x) => x.id === o.shoes) as never, f, 'ped'),
  ];
  if (o.accessory) parts.push(buildAccessory(d.accessories.find((x) => x.id === o.accessory) as never, f, 'ped'));
  return merged(parts);
}

/** The far figure: tapered prisms for trunk, head, legs and arms; `_SWING` is the swing direction of a limb, `_PIVOT` its pivot height. */
export function farFigure(w: number, h: number, f: Fidelity): RigidMesh {
  const seg = f === 'hi' ? 7 : f === 'mid' ? 6 : 5;
  const cell = cellOf('ped', 'skin', 0);
  const m = new SkinMesh();
  const swing: number[] = [];
  const pivot: number[] = [];
  const add = (rings: Ring[], part: number, sw: number, pv: number, caps: [boolean, boolean] = [true, true]): void => {
    const t = tube(rings, { seg, cell, part, weights: () => [[0, 1]], capStart: caps[0], capEnd: caps[1] });
    for (let i = 0; i < t.vertexCount; i++) {
      swing.push(sw);
      pivot.push(pv);
    }
    m.append(t);
  };
  const sw = w;
  // trunk (hips to shoulders), head, legs, arms
  add([{ c: [0, 0.92, 0], ru: 0.16 * sw, rv: 0.1 }, { c: [0, 1.15, 0], ru: 0.145 * sw, rv: 0.09 }, { c: [0, 1.4, 0], ru: 0.17 * sw, rv: 0.1 }, { c: [0, 1.5, 0], ru: 0.09, rv: 0.07 }], PERSON_PART.cloth, 0, 0.9);
  add([{ c: [0, 1.5, 0], ru: 0.05, rv: 0.05 }, { c: [0, 1.58, -0.004], ru: 0.07, rv: 0.08 }, { c: [0, 1.7, 0], ru: 0.085, rv: 0.1 }, { c: [0, 1.79, 0], ru: 0.05, rv: 0.06 }], PERSON_PART.skin, 0, 0.9);
  for (const [sd, dir] of [[1, 1], [-1, -1]] as [number, number][]) {
    add([{ c: [sd * 0.09, 0.95, 0], ru: 0.085, rv: 0.09 }, { c: [sd * 0.09, 0.5, 0.002], ru: 0.058, rv: 0.06 }, { c: [sd * 0.09, 0.08, 0], ru: 0.04, rv: 0.05 }], PERSON_PART.cloth2, dir, 0.9);
    add([{ c: [sd * (0.19 * sw), 1.43, 0], ru: 0.05, rv: 0.05 }, { c: [sd * (0.19 * sw), 1.16, 0], ru: 0.04, rv: 0.04 }, { c: [sd * (0.19 * sw), 0.88, 0], ru: 0.03, rv: 0.025 }], PERSON_PART.skin, -dir, 1.45);
  }
  smoothNormals(m);
  const s = h;
  const out: RigidMesh = { pos: [], nor: [], col: [], part: [], swing, pivot, idx: m.idx.slice() };
  for (let i = 0; i < m.vertexCount; i++) {
    out.pos.push((m.pos[i * 3] as number) * 1, (m.pos[i * 3 + 1] as number) * s, m.pos[i * 3 + 2] as number);
    out.nor.push(m.nor[i * 3] as number, m.nor[i * 3 + 1] as number, m.nor[i * 3 + 2] as number);
    out.col.push(m.ao[i] as number, m.ao[i] as number, m.ao[i] as number);
    out.part.push(m.part[i] as number);
  }
  out.pivot = pivot.map((p) => p * s);
  return out;
}

/** Every asset of the kit, in a stable order: atlases, creator parts (portraits after their parts), ped bodies, outfits, far figures. */
export function personDefs(d: PeopleData, cat: CatalogFile): PersonDef[] {
  const out: PersonDef[] = [];
  for (const a of ATLAS_IDS) out.push({ kind: 'texture', id: a, tag: 'art:m10d4', atlas: a });
  for (const slot of CREATOR_SLOTS) {
    for (const row of cat.slots[slot] ?? []) {
      if (isCoast(row)) continue;
      const id = `pc-${row.id}`;
      const spec = slot === 'body' ? bodyById(d, row.id) : undefined;
      out.push({ kind: 'character', id, tag: 'class:creator', slot, row, mesh: (f) => creatorMesh(d, slot, row.id, f), heightM: spec?.heightM ?? RIG_HEIGHT_M });
    }
  }
  for (const pb of d.pedBodies) {
    const spec = bodyById(d, pb.body);
    out.push({ kind: 'character', id: `ped.body.${pb.id}`, tag: 'class:ped', mesh: (f) => pedBodyMesh(d, pb.id, f), heightM: spec.heightM });
  }
  for (const o of d.outfits) out.push({ kind: 'character', id: `ped.outfit.${String(o.n).padStart(2, '0')}`, tag: 'class:ped', mesh: (f) => pedOutfitMesh(d, o.n, f), heightM: RIG_HEIGHT_M });
  for (const pb of d.pedBodies) out.push({ kind: 'prop', id: `ped.far.${pb.id}`, tag: 'prop:ped-far', rigid: (f) => farFigure(pb.far.w, pb.far.h, f), heightM: bodyById(d, pb.body).heightM });
  return out;
}

export const refOfDef = (def: PersonDef): string => `${def.kind}/${def.id}`;

const LIKENESS = { tier: 'original', subjectId: null, faceReferenceUsed: false, voiceMode: 'none', photoreal: false, disclaimer: 'none' } as const;

// ---- portraits --------------------------------------------------------------------------------------------------------------------

const SKIN_TONE = 0xc58c5f;
const hexLin = (h: number): [number, number, number] => lin(h) as [number, number, number];

/** The card of a creator part: the part drawn with a little context (the head for hair, the legs for shoes) at 256 px. */
export function portraitPng(d: PeopleData, cat: CatalogFile, def: PersonDef): Uint8Array {
  const slot = def.slot as CreatorSlot;
  const row = def.row as CatalogRow;
  const f: Fidelity = 'hi';
  const body = buildBodySkin(null, f, 'pc');
  const head = applyMorphs(buildHeadBase(f, 'pc'), (d.faces[3] as PeopleData['faces'][number]).morphs);
  const inRange = (m: SkinMesh, lo: number, hi: number): SkinMesh => m.filtered((i) => (m.pos[i * 3 + 1] as number) >= lo && (m.pos[i * 3 + 1] as number) <= hi);
  const armOf = (m: SkinMesh): SkinMesh => m.filtered((i) => (m.pos[i * 3] as number) > 0.12);
  const colour = hexLin(rowColor(slot, row));
  const tints: Tints = {
    skin: hexLin(slot === 'body' ? SKIN_TONE : SKIN_TONE),
    cloth: colour,
    cloth2: [colour[0] * 0.55, colour[1] * 0.55, colour[2] * 0.55],
    hair: hexLin(0x2a1c14),
  };
  const part = creatorMesh(d, slot, row.id, f);
  const skinTints: Tints = { ...DEFAULT_TINTS, skin: hexLin(SKIN_TONE), hair: hexLin(0x2a1c14) };
  let context: SkinMesh[] = [];
  let view = FRONT_VIEW;
  let partTints = tints;
  let lowCut = -1;
  switch (slot) {
    case 'body':
      context = [head, buildHair(d.hairs[1] as PeopleData['hairs'][number], f, 'pc')];
      partTints = skinTints;
      lowCut = 0.78;
      break;
    case 'face':
      context = [buildHair(d.hairs[1] as PeopleData['hairs'][number], f, 'pc')];
      partTints = skinTints;
      view = THREE_QUARTER;
      break;
    case 'hair':
      context = [head, inRange(body, 1.45, 1.7)];
      view = THREE_QUARTER;
      partTints = { ...skinTints, hair: hexLin(Number.parseInt((cat.palettes.hair[(row.index - 1) % cat.palettes.hair.length] ?? '#2a1c14').replace('#', ''), 16)) };
      break;
    case 'top':
      context = [head, inRange(body, 0.9, 1.7)];
      break;
    case 'bottom':
      context = [inRange(body, 0.0, 1.2)];
      break;
    case 'shoes':
      context = [inRange(body, 0.0, 0.6)];
      view = { azimuthDeg: 140, elevationDeg: 16 };
      break;
    case 'accessory': {
      const a = d.accessories.find((x) => x.id === row.id);
      const upper = a?.kind === 'backpack';
      context = upper ? [head, inRange(body, 0.9, 1.7)] : a?.kind === 'watch' ? [armOf(inRange(body, 0.78, 1.45))] : [head, inRange(body, 1.4, 1.7)];
      view = a?.kind === 'backpack' ? { azimuthDeg: 20, elevationDeg: 8 } : a?.kind === 'watch' ? { azimuthDeg: 120, elevationDeg: 10 } : THREE_QUARTER;
      break;
    }
  }
  const cut = (m: SkinMesh): SkinMesh => (lowCut > 0 ? inRange(m, lowCut, 9) : m);
  return encodePng(renderCard(context, [cut(part)], view, 256, partTints, skinTints));
}

// ---- plans ------------------------------------------------------------------------------------------------------------------------

export interface PersonPlan extends AssetPlan {
  def: PersonDef;
  /** Sha256 of each variant file (the portraits derive from the desktop one). */
  variantSha: Record<string, string>;
}

function record(path_: string, kind: string, sha: string, argsSha: string, derivedFrom: string[]): { path: string; text: string; sha256: string } {
  const rec: ProvenanceRecord = {
    schema: 'provenance/1.0',
    sha256: sha,
    paths: [path_],
    kind: kind as ProvenanceRecord['kind'],
    origin: derivedFrom.length > 0 ? 'derived' : 'authored',
    license: 'LicenseRef-DeeVerse-Owned',
    authors: ['studio:dee-verse'],
    derived_from: derivedFrom,
    tool: { name: PEOPLE_GEN_TOOL, version: PEOPLE_GEN_VERSION, args_sha256: argsSha },
    ...(kind === 'character' || kind === 'portrait'
      ? { likeness: { subject_id: null, tier: 'original' as const, face_reference_used: false, voice_mode: 'none' as const, photoreal: false } }
      : {}),
    review: [],
    ip_checks: { signatures: derivedFrom.length > 0 ? 'n/a' : 'pass', strings: 'n/a', similarity: 'n/a' },
    ai_generated: false,
    status: 'active',
    created_at: PEOPLE_GEN_CREATED_AT,
  };
  return { path: `assets/provenance/${sha.slice(0, 2)}/${sha}.json`, text: `${JSON.stringify(rec, null, 2)}\n`, sha256: sha };
}

export interface ModelStat { tris: number; verts: number; materials: number; primitives: number; bones?: number; texMaxPx?: number }

/** The atlas page edge each fidelity draws with. */
const PAGE_PX: Readonly<Record<Fidelity, number>> = { hi: 1024, mid: 512, lo: 256 };

const specText = (o: unknown): string => `${JSON.stringify(o, null, 2)}\n`;

export async function planPerson(d: PeopleData, cat: CatalogFile, def: PersonDef, parts?: Map<string, string>): Promise<PersonPlan> {
  const dir = `assets/src/${def.kind}/${def.id}`;
  const files: AssetPlan['files'] = [];
  const records: AssetPlan['records'] = [];
  const variants: Record<string, string> = {};
  const variantSha: Record<string, string> = {};
  const stats: Record<string, ModelStat> = {};
  const argsSha = sha256(canonicalize({ id: `${def.kind}/${def.id}`, version: PEOPLE_GEN_VERSION }));
  const put = (v: string, ext: string, bytes: Uint8Array, st?: ModelStat, derived: string[] = []): void => {
    const rel = `${dir}/${v}.${ext}`;
    files.push({ path: rel, bytes });
    variants[v] = rel;
    const sha = sha256(bytes);
    variantSha[v] = sha;
    if (st) stats[v] = st;
    records.push(record(rel, def.kind, sha, argsSha, derived));
  };
  if (def.kind === 'texture') {
    for (const [v, px] of Object.entries(ATLAS_SIZES)) put(v, 'png', atlasPng(def.atlas as AtlasId, px));
  } else if (def.kind === 'portrait') {
    const partSha = parts?.get(def.id.replace(/^pc-/, '')) ?? '';
    put('default', 'png', portraitPng(d, cat, def.row ? def : (def as PersonDef)), undefined, partSha ? [partSha] : []);
  } else if (def.kind === 'prop') {
    for (const f of FIDELITIES) {
      const r = (def.rigid as (f: Fidelity) => RigidMesh)(f);
      const ex: SkinnedExtras = { ref: refOfDef(def), fidelity: f, heightM: def.heightM ?? RIG_HEIGHT_M, far: true };
      const bytes = await writeRigidGlb(r, ex, def.id);
      put(VARIANT_OF[f], 'glb', bytes, { tris: r.idx.length / 3, verts: r.pos.length / 3, materials: 1, primitives: 1 });
    }
  } else {
    for (const f of FIDELITIES) {
      const m = (def.mesh as (f: Fidelity) => SkinMesh)(f);
      const ex: SkinnedExtras = {
        ref: refOfDef(def), fidelity: f, heightM: def.heightM ?? RIG_HEIGHT_M, rig: 'bay_rig_v1', facing: '-z',
        ...(def.slot ? { slot: def.slot, part: (def.row as CatalogRow).id } : {}),
        morphs: [...m.morphs.keys()],
      };
      const bytes = await writeSkinnedGlb(m, ex, def.id, def.slot === 'hair');
      put(VARIANT_OF[f], 'glb', bytes, { tris: m.triangleCount, verts: m.vertexCount, materials: 1, primitives: 1, bones: 22, texMaxPx: PAGE_PX[f] });
    }
  }
  const portrait = def.slot ? `portrait/${def.id}` : undefined;
  const spec: Record<string, unknown> = {
    kind: def.kind,
    id: def.id,
    variants,
    ...(Object.keys(stats).length > 0 ? { stats } : {}),
    deps: [] as string[],
    tags: [def.tag, 'art:m10d4', ...(def.kind === 'portrait' ? [] : [])],
    ...(def.kind === 'character'
      ? {
          extras: {
            t: 'character',
            npcId: 'people-kit',
            rigFamily: 'bay_rig_v1',
            heightM: def.heightM ?? RIG_HEIGHT_M,
            bones: { jaw: false, fingers: false },
            animSets: [] as string[],
            ...(portrait ? { portrait } : {}),
          },
        }
      : {}),
    ...(def.kind === 'character' || def.kind === 'portrait' ? { likeness: LIKENESS } : {}),
    status: 'active',
    visibility: 'public',
  };
  return { id: def.id, dir, files, spec: specText(spec), records, stats: stats as never, def, variantSha };
}

export type PeopleScope = 'characters' | 'portraits' | 'all';

/** Plans the assets of a scope. The portraits are planned from their part, so the parts' hashes are known first (the parts are built either way). */
export async function planAllPeople(root: string, only?: readonly string[], scope: PeopleScope = 'all'): Promise<PersonPlan[]> {
  const d = loadPeople(root);
  const cat = loadCatalog(root);
  const defs = personDefs(d, cat);
  const out: PersonPlan[] = [];
  const partSha = new Map<string, string>();
  for (const def of defs) {
    if (only && !only.includes(def.id) && !only.includes(refOfDef(def))) continue;
    const plan = await planPerson(d, cat, def);
    if (scope !== 'portraits') out.push(plan);
    if (def.slot) partSha.set((def.row as CatalogRow).id, plan.variantSha['desktop'] as string);
  }
  if (scope === 'characters') return out;
  for (const def of defs) {
    if (!def.slot) continue;
    if (only && !only.includes(def.id) && !only.includes(`portrait/${def.id}`)) continue;
    const pdef: PersonDef = { ...def, kind: 'portrait', tag: 'class:creator-portrait' };
    out.push(await planPerson(d, cat, pdef, partSha));
  }
  return out;
}

export async function checkPeople(root: string, only?: readonly string[], scope: PeopleScope = 'all'): Promise<{ plans: number; diffs: { path: string; why: string }[] }> {
  const plans = await planAllPeople(root, only, scope);
  const diffs: { path: string; why: string }[] = [];
  for (const p of plans) for (const x of diffPlan(root, p)) diffs.push({ path: x.path, why: x.why });
  if (scope !== 'portraits' && !only && readFileSync(path.join(root, REGISTRY_FILE), 'utf8') !== registryText(root)) diffs.push({ path: REGISTRY_FILE, why: 'differs' });
  return { plans: plans.length, diffs };
}

// ---- the placeholder registry rows of M10d4 (DL-741) -------------------------------------------------------------------------------

export const REGISTRY_FILE = 'config/art-placeholders.json';

/** The refs each M10d4 row names as its replacement: the ped kit for the mannequins, the non-Coast creator parts for the creator rows. */
export function registryTargets(d: PeopleData, cat: CatalogFile): Record<'ped-mannequins' | 'creator-parts', string[]> {
  const defs = personDefs(d, cat);
  const ped = defs.filter((x) => x.id.startsWith('ped.') || x.id === 'ped.atlas').map(refOfDef);
  const creator = defs.filter((x) => x.slot !== undefined).map(refOfDef);
  return { 'ped-mannequins': [...ped, 'texture/ped.atlas'], 'creator-parts': creator };
}

type Registry = { rows: { id: string; replacedBy: string[] }[] };

export function registryText(root: string): string {
  const reg = JSON.parse(readFileSync(path.join(root, REGISTRY_FILE), 'utf8')) as Registry;
  const t = registryTargets(loadPeople(root), loadCatalog(root));
  for (const row of reg.rows) {
    if (row.id === 'ped-mannequins' || row.id === 'creator-parts') row.replacedBy = [...new Set(t[row.id])];
  }
  return `${JSON.stringify(reg, null, 2)}\n`;
}

export function applyRegistry(root: string): boolean {
  const next = registryText(root);
  const file = path.join(root, REGISTRY_FILE);
  const have = readFileSync(file, 'utf8');
  if (have === next) return false;
  writeFileSync(file, next);
  return true;
}
