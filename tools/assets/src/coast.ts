/**
 * The Coast set (M10a2, DL-737, `10-ui-pages.md` section 2.8 rule 6): the published protagonist `character/pc-coast` split into the six creator
 * rows, and the rows bound to their models.
 *
 *   split   `assets/src/character/pc-coast/<variant>.glb` -> `character/pc-<slot>-coast` (three fidelities) and `portrait/pc-<slot>-coast`, with
 *           specs and derived provenance records. A triangle goes to the part of the bone group its vertices are weighted to (shoes, bottom, top,
 *           body); triangles on the head bone go to `hair` above the hairline and behind the face plane, else to `face`. The groups and the
 *           hairline live in `content/characters/pc-coast/split.json`, so the art lead tunes them at the H4 review without code.
 *   link    sets `model` and `portrait` on the six catalog rows from the lock when both assets are locked and resolve on all six tiers.
 *   check   the same rules, read only: a row with a model needs both assets in the lock, and a locked part needs its row.
 *
 * Known limit (BD-M10a2-06): every part file keeps the whole character's texture, so six parts hold six copies of it; a hand-split set with
 * one atlas per part replaces this output without changing a ref.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Document, Node, Primitive } from '@gltf-transform/core';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { resolveVariant, type AssetManifest, type VariantId, type VariantStats } from '../../../packages/shared/src/assets/c07.ts';
import { canonicalBone, checkA6Budget, gpuTexBytes, type FidelityLimits, type RigFamily } from '../../../packages/shared/src/assets/gates/index.ts';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { canonicalize } from '../../../packages/shared/src/json.ts';
import { sha256Hex as sha256String } from '../../../packages/shared/src/hash.ts';
import { VARIANT_FALLBACK } from '../../../packages/shared/src/platform/c13.ts';
import rigJson from '../../../packages/shared/src/rig/bay_rig_v1.json';
import { sha256Hex } from '../../ci/lib/common.ts';
import { CARD_DIR, CARD_FILE, readCards, type SubjectCard } from '../gen/subject-card.ts';
import { jointNodes, maxTexturePx, readGlb, textureEdges, triangleCount, vertexCount, writeGlb } from './glb-inspect.ts';
import { sortedJson } from './moves-asset.ts';
import { encodePng } from './image.ts';
import { frameOf, turntable } from './turntable.ts';

export const COAST = 'pc-coast';
export const SPLIT_FILE = `${CARD_DIR}/${COAST}/split.json`;
export const CATALOG_FILE = 'content/ui/creator/catalog.json';
export const SLOTS = ['body', 'face', 'hair', 'top', 'bottom', 'shoes'] as const;
export type CoastSlot = (typeof SLOTS)[number];
export const partId = (slot: string): string => `pc-${slot}-coast`;
export const modelRef = (slot: string): string => `character/${partId(slot)}`;
export const portraitRef = (slot: string): string => `portrait/${partId(slot)}`;

const VARIANTS = ['desktop', 'mobile', 'mobile-low'] as const;
const FIDELITY_OF: Readonly<Record<(typeof VARIANTS)[number], 'hi' | 'mid' | 'lo'>> = { desktop: 'hi', mobile: 'mid', 'mobile-low': 'lo' };
const rig = rigJson as unknown as RigFamily;

export interface SplitConfig {
  schema: 'coast-split/1';
  /** Bone group of each non-head part, by canonical `bay_rig_v1` bone name. */
  groups: Record<'shoes' | 'bottom' | 'top' | 'body', string[]>;
  /** Bones whose triangles split into hair and face. */
  head: { bones: string[]; hairlineYFrac: number; faceMinZM: number };
}

export function readSplitConfig(root: string): SplitConfig {
  return JSON.parse(readFileSync(path.join(root, SPLIT_FILE), 'utf8')) as SplitConfig;
}

// -- link and check -----------------------------------------------------------------------------------------------------------------

interface LockEntry { variants: Record<string, string> }
interface Row { id: string; model?: string; portrait?: string; [k: string]: unknown }
interface Catalog { slots: Record<string, Row[]>; [k: string]: unknown }

const manifestOf = (ref: string, e: LockEntry): AssetManifest => {
  const [kind, id] = ref.split('/') as [string, string];
  return { schema: 'asset/1', id, kind, rev: 1, variants: Object.fromEntries(Object.entries(e.variants).map(([v, sha]) => [v, { key: sha, sha256: sha }])) } as unknown as AssetManifest;
};

const TIER_IDS: readonly string[] = Object.keys(VARIANT_FALLBACK);

/** True when `ref` is locked and resolves on every quality tier through C07 `resolveVariant`. */
function resolvesEverywhere(lock: Record<string, LockEntry>, ref: string, tierIds: readonly string[]): boolean {
  const e = lock[ref];
  if (e === undefined) return false;
  try {
    for (const t of tierIds) resolveVariant(manifestOf(ref, e), t as never);
    return true;
  } catch {
    return false;
  }
}

export interface LinkResult { set: string[]; unchanged: string[]; pending: string[]; problems: string[] }

export function linkCoast(root: string, o: { write: boolean }): LinkResult {
  const out: LinkResult = { set: [], unchanged: [], pending: [], problems: [] };
  const { cards, problems } = readCards(root);
  const card = cards.find((c) => c.id === COAST);
  if (card === undefined) return { ...out, problems: [...problems.map((p) => `${p.file}: ${p.detail}`), `${CARD_DIR}/${COAST}/${CARD_FILE} is missing or invalid`] };
  const lock = (JSON.parse(readFileSync(path.join(root, 'assets/assets.lock.json'), 'utf8')) as { entries: Record<string, LockEntry> }).entries;
  const catalog = JSON.parse(readFileSync(path.join(root, CATALOG_FILE), 'utf8')) as Catalog;
  for (const p of card.parts) {
    const row = (catalog.slots[p.slot] ?? []).find((r) => r.id === p.row);
    if (row === undefined) { out.problems.push(`${p.row}: not a row of the ${p.slot} slot in ${CATALOG_FILE}`); continue; }
    const m = modelRef(p.slot);
    const pr = portraitRef(p.slot);
    const haveM = lock[m] !== undefined;
    const haveP = lock[pr] !== undefined;
    if (!haveM && !haveP) {
      if (row.model !== undefined || row.portrait !== undefined) out.problems.push(`${p.row} names ${row.model ?? ''} ${row.portrait ?? ''} but neither ${m} nor ${pr} is in the lock`);
      else out.pending.push(p.row);
      continue;
    }
    if (haveM !== haveP) { out.problems.push(`${p.row}: ${haveM ? pr : m} is not in the lock (a part needs its model and its portrait)`); continue; }
    if (!resolvesEverywhere(lock, m, TIER_IDS) || !resolvesEverywhere(lock, pr, TIER_IDS)) { out.problems.push(`${p.row}: ${m} or ${pr} does not resolve on all six tiers`); continue; }
    if (row.model === m && row.portrait === pr) { out.unchanged.push(p.row); continue; }
    row.model = m;
    row.portrait = pr;
    out.set.push(p.row);
  }
  if (o.write && out.set.length > 0 && out.problems.length === 0) writeFileSync(path.join(root, CATALOG_FILE), `${JSON.stringify(catalog, null, 1)}\n`);
  return out;
}

/** Read-only rules of the Coast rows (the same checks `link` runs, plus: a locked part has a row). */
export function checkCoast(root: string): string[] {
  const r = linkCoast(root, { write: false });
  const out = [...r.problems];
  if (r.set.length > 0) out.push(`${r.set.join(', ')}: the part assets are locked but the catalog row has no model yet; run pnpm assets:coast -- link`);
  return out;
}

// -- split --------------------------------------------------------------------------------------------------------------------------

type Part = CoastSlot;

/** The part of each triangle of a primitive; null for a primitive with no skin data. */
function partition(prim: Primitive, joints: readonly Node[], cfg: SplitConfig, topY: number, botY: number, headZ: number): Part[] | null {
  const jo = prim.getAttribute('JOINTS_0');
  const we = prim.getAttribute('WEIGHTS_0');
  const pos = prim.getAttribute('POSITION');
  if (jo === null || we === null || pos === null) return null;
  const groupOf = new Map<string, 'shoes' | 'bottom' | 'top' | 'body' | 'head'>();
  for (const [g, bones] of Object.entries(cfg.groups)) for (const b of bones) groupOf.set(b, g as 'shoes' | 'bottom' | 'top' | 'body');
  for (const b of cfg.head.bones) groupOf.set(b, 'head');
  const jointGroup = joints.map((j) => {
    const c = canonicalBone(rig, j.getName());
    return c === null ? undefined : groupOf.get(c);
  });
  const n = pos.getCount();
  const vGroup: ('shoes' | 'bottom' | 'top' | 'body' | 'head')[] = [];
  const ji = [0, 0, 0, 0];
  const wi = [0, 0, 0, 0];
  for (let v = 0; v < n; v++) {
    jo.getElement(v, ji);
    we.getElement(v, wi);
    const acc = new Map<string, number>();
    for (let k = 0; k < 4; k++) {
      const g = jointGroup[ji[k] as number];
      if (g !== undefined) acc.set(g, (acc.get(g) ?? 0) + (wi[k] as number));
    }
    let best: 'shoes' | 'bottom' | 'top' | 'body' | 'head' = 'body';
    let bw = -1;
    for (const [g, w] of acc) if (w > bw) { bw = w; best = g as typeof best; }
    vGroup.push(best);
  }
  const idx = prim.getIndices();
  const tris = Math.floor((idx !== null ? idx.getCount() : n) / 3);
  const p = [0, 0, 0];
  const hairlineY = botY + cfg.head.hairlineYFrac * (topY - botY);
  const out: Part[] = [];
  for (let t = 0; t < tris; t++) {
    const vs = [0, 1, 2].map((k) => (idx !== null ? idx.getScalar(3 * t + k) : 3 * t + k));
    const counts = new Map<string, number>();
    for (const v of vs) counts.set(vGroup[v] as string, (counts.get(vGroup[v] as string) ?? 0) + 1);
    let g = (vGroup[vs[0] as number] as string);
    let c = 0;
    for (const [k, num] of counts) if (num > c) { c = num; g = k; }
    if (g !== 'head') { out.push(g as Part); continue; }
    let cy = 0;
    let cz = 0;
    for (const v of vs) { pos.getElement(v, p); cy += p[1] as number; cz += p[2] as number; }
    cy /= 3;
    cz /= 3;
    out.push(cy > hairlineY || cz < headZ + cfg.head.faceMinZM ? 'hair' : 'face');
  }
  return out;
}

/** Keeps only the triangles `keep` of a primitive and compacts its vertex arrays. Morph targets are dropped. */
function keepTriangles(doc: Document, prim: Primitive, keep: readonly number[]): void {
  const idx = prim.getIndices();
  const remap = new Map<number, number>();
  const next: number[] = [];
  for (const t of keep) {
    for (let k = 0; k < 3; k++) {
      const v = idx !== null ? idx.getScalar(3 * t + k) : 3 * t + k;
      let m = remap.get(v);
      if (m === undefined) { m = remap.size; remap.set(v, m); }
      next.push(m);
    }
  }
  for (const target of prim.listTargets()) { prim.removeTarget(target); target.dispose(); }
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem);
    if (acc === null) continue;
    const es = acc.getElementSize();
    const src = acc.getArray() as Float32Array;
    const dst = new (src.constructor as new (n: number) => Float32Array)(remap.size * es) as unknown as Parameters<typeof acc.setArray>[0] & Float32Array;
    for (const [from, to] of remap) for (let e = 0; e < es; e++) dst[to * es + e] = src[from * es + e] as number;
    const made = doc.createAccessor().setType(acc.getType()).setArray(dst).setNormalized(acc.getNormalized()).setBuffer(acc.getBuffer() ?? doc.getRoot().listBuffers()[0] ?? doc.createBuffer());
    prim.setAttribute(sem, made);
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(next)).setBuffer(prim.getAttribute('POSITION')?.getBuffer() ?? doc.getRoot().listBuffers()[0] ?? doc.createBuffer()));
}

/** The GLB of one part: the whole character with every other part's triangles removed. Null when the part has no triangle. */
export async function partGlb(source: Uint8Array, slot: Part, cfg: SplitConfig): Promise<Uint8Array | null> {
  const doc = await readGlb(source);
  let ymin = Infinity;
  let ymax = -Infinity;
  const p = [0, 0, 0];
  for (const m of doc.getRoot().listMeshes()) for (const prim of m.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    for (let v = 0; v < (pos?.getCount() ?? 0); v++) { pos?.getElement(v, p); ymin = Math.min(ymin, p[1] as number); ymax = Math.max(ymax, p[1] as number); }
  }
  const headNode = jointNodes(doc).find((j) => canonicalBone(rig, j.getName()) === 'head');
  const headZ = headNode === undefined ? 0 : headNode.getWorldTranslation()[2];
  let kept = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (mesh === null) continue;
    const joints = node.getSkin()?.listJoints() ?? [];
    for (const prim of mesh.listPrimitives()) {
      const parts = partition(prim, joints, cfg, ymax, ymin, headZ);
      const mine = parts === null ? [] : parts.flatMap((g, t) => (g === slot ? [t] : []));
      if (mine.length === 0) { mesh.removePrimitive(prim); prim.dispose(); continue; }
      keepTriangles(doc, prim, mine);
      kept += mine.length;
    }
  }
  if (kept === 0) return null;
  for (const m of doc.getRoot().listMeshes()) if (m.listPrimitives().length === 0) { for (const n of doc.getRoot().listNodes()) if (n.getMesh() === m) n.setMesh(null); m.dispose(); }
  await doc.transform(prune({ keepLeaves: true }));
  doc.getRoot().setExtras({ ...doc.getRoot().getExtras(), assetId: modelRef(slot), part: slot });
  await meshopt({ encoder: MeshoptEncoder, level: 'medium' })(doc);
  return writeGlb(doc);
}

export interface SplitResult { ok: boolean; files: string[]; findings: string[] }

/** Writes the six parts, their portraits, specs and provenance records. Refuses when the source files, their records or the card are missing. */
export async function splitCoast(root: string, o: { by: string; at: string }): Promise<SplitResult> {
  const fail = (m: string): SplitResult => ({ ok: false, files: [], findings: [m] });
  const { cards } = readCards(root);
  const card: SubjectCard | undefined = cards.find((c) => c.id === COAST);
  if (card === undefined) return fail(`${CARD_DIR}/${COAST}/${CARD_FILE} is missing or invalid`);
  if (!existsSync(path.join(root, SPLIT_FILE))) return fail(`${SPLIT_FILE} is missing`);
  const cfg = readSplitConfig(root);
  const specFile = path.join(root, 'assets/src/character', COAST, 'asset.json');
  if (!existsSync(specFile)) return fail(`assets/src/character/${COAST}/asset.json does not exist: publish ${COAST} first (assets:gen run --slug ${COAST} --until publish)`);
  const spec = JSON.parse(readFileSync(specFile, 'utf8')) as { variants: Record<string, string>; tags: string[]; extras: Record<string, unknown>; likeness: unknown; codec?: unknown };
  const budgets = JSON.parse(readFileSync(path.join(root, 'config/asset-budgets.json'), 'utf8')) as { rows: { id: string; fidelity: Record<'hi' | 'mid' | 'lo', FidelityLimits> }[] };
  const limits = budgets.rows.find((r) => r.id === 'character-hero')?.fidelity;
  if (limits === undefined) return fail('config/asset-budgets.json has no character-hero row');
  const files: string[] = [];
  const findings: string[] = [];
  const write = (rel: string, data: string | Uint8Array): void => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), data);
    files.push(rel);
  };
  const sources: { variant: (typeof VARIANTS)[number]; bytes: Uint8Array; sha: string; record: ProvenanceRecord }[] = [];
  for (const variant of VARIANTS) {
    const rel = spec.variants[variant];
    if (rel === undefined || !existsSync(path.join(root, rel))) return fail(`${COAST} has no ${variant} file (${rel ?? 'not in its spec'})`);
    const bytes = new Uint8Array(readFileSync(path.join(root, rel)));
    const sha = sha256Hex(bytes);
    const recFile = path.join(root, 'assets/provenance', sha.slice(0, 2), `${sha}.json`);
    if (!existsSync(recFile)) return fail(`${rel} has no provenance record`);
    sources.push({ variant, bytes, sha, record: JSON.parse(readFileSync(recFile, 'utf8')) as ProvenanceRecord });
  }
  for (const p of card.parts) {
    const slot = p.slot as Part;
    const variants: Partial<Record<VariantId, string>> = {};
    const stats: Partial<Record<VariantId, VariantStats>> = {};
    let desktopSha = '';
    let desktopBytes: Uint8Array | null = null;
    for (const s of sources) {
      const glb = await partGlb(s.bytes, slot, cfg);
      if (glb === null) { findings.push(`${p.row}: the ${s.variant} file has no triangle for the ${slot} part (check ${SPLIT_FILE})`); continue; }
      const rel = `assets/src/character/${partId(slot)}/${s.variant}.glb`;
      write(rel, glb);
      variants[s.variant] = rel;
      const doc = await readGlb(glb);
      const tris = triangleCount(doc);
      const measure = { tris, maxTexPx: maxTexturePx(doc), materials: doc.getRoot().listMaterials().length, gpuTexBytes: gpuTexBytes(textureEdges(doc)), fileBytes: glb.length };
      for (const f of checkA6Budget(`${partId(slot)}/${s.variant}.glb`, FIDELITY_OF[s.variant], measure, limits[FIDELITY_OF[s.variant]])) findings.push(`${f.file} ${f.rule}: ${f.detail}`);
      stats[s.variant] = { tris, verts: vertexCount(doc), bones: jointNodes(doc).length, materials: measure.materials, texMaxPx: measure.maxTexPx, texGpuBytes: measure.gpuTexBytes };
      write(`assets/provenance/${sha256Hex(glb).slice(0, 2)}/${sha256Hex(glb)}.json`, sortedJson(derivedRecord(s.record, glb, rel, s.sha, o, { slot, variant: s.variant })));
      if (s.variant === 'desktop') { desktopSha = sha256Hex(glb); desktopBytes = glb; }
    }
    if (desktopBytes === null) continue;
    // the portrait: the front view of the desktop part, 512 px
    const doc = await readGlb(desktopBytes);
    const front = turntable(doc, frameOf(doc))[0];
    if (front === undefined) { findings.push(`${p.row}: the turntable rendered no view`); continue; }
    const png = encodePng(front);
    const prel = `assets/src/portrait/${partId(slot)}/default.png`;
    write(prel, png);
    write(`assets/provenance/${sha256Hex(png).slice(0, 2)}/${sha256Hex(png)}.json`, sortedJson({ ...derivedRecord(sources[0]!.record, png, prel, desktopSha, o, { slot, view: 'front' }), kind: 'portrait' }));
    const tags = [...new Set([...spec.tags.filter((t) => t.startsWith('char:') || t.startsWith('class:')), 'creator-part'])];
    write(`assets/src/character/${partId(slot)}/asset.json`, sortedJson({
      kind: 'character', id: partId(slot), variants, deps: [], tags, extras: { ...spec.extras, animSets: [], portrait: portraitRef(slot) }, likeness: spec.likeness, stats, codec: spec.codec ?? { mesh: 'meshopt' },
      status: 'active', visibility: 'public',
    }));
    write(`assets/src/portrait/${partId(slot)}/asset.json`, sortedJson({ kind: 'portrait', id: partId(slot), variants: { default: prel }, deps: [], tags, likeness: spec.likeness, status: 'active', visibility: 'public' }));
  }
  return { ok: findings.length === 0, files, findings };
}

/** A derived record for a part file: the source record's review, likeness and checks carry over; the origin chain ends in the generated root. */
function derivedRecord(src: ProvenanceRecord, bytes: Uint8Array, rel: string, parentSha: string, o: { by: string; at: string }, args: Record<string, string>): ProvenanceRecord {
  return {
    schema: 'provenance/1.0', sha256: sha256Hex(bytes), paths: [rel], kind: 'character', origin: 'derived', license: src.license, authors: [`profile:${o.by}`],
    derived_from: [parentSha], tool: { name: 'assets:coast', version: '1.0.0', args_sha256: sha256String(canonicalize(args as never)) },
    ...(src.likeness !== undefined ? { likeness: src.likeness } : {}), review: src.review, ip_checks: src.ip_checks, ai_generated: src.ai_generated, ...(src.c2pa !== undefined ? { c2pa: src.c2pa } : {}),
    status: 'active', created_at: o.at,
  };
}
