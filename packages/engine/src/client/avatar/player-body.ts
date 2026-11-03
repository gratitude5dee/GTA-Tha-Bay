/**
 * The on-foot bodies of the object pool (M10d5): the player wears the parts of the profile's `PlayerAvatar` (M10d4's creator kit) and a
 * mission actor without its own prefab (`ped.actor`) wears a ped-kit body, instead of the gray-box capsule's procedural mannequin.
 *
 *  - ONE `SkinnedMesh` with ONE material per body: the parts are merged on the 22 `bay_rig_v1` bones; the player's material picks one of
 *    the three creator atlas pages (skin, cloth, hair) by a vertex page id (`aPage`), the actor's reads the ped atlas. Colours are vertex
 *    colours from the vertex class (`classColor` of `assemble.ts`), so one page serves every tint. The face's morphs are baked into the
 *    positions once (the in-game face does not animate), so the mesh carries no morph target.
 *  - `mid` parts (the `mobile` variant) on `desktop` and `mobile`, `lo` (`mobile-low`) on `mobile-low` and the XR tiers.
 *  - A catalog row without `model` draws its `fallbackPart` (Coast's rows until M10a2 has modelled them); a failed load leaves the
 *    mannequin, which the pool draws until the body is ready.
 *  - The body binds the same bone names as the mannequin and is driven by the same `MannequinAnimator` with the clips M10d4's
 *    `clip-source.ts` picks (the placeholder clips while no `anim/*.moves` file exists), so every locomotion state plays a clip.
 *
 * Render only: the sim, the state hashes and `AppearanceV1` are untouched. No loader of its own: the bytes come through `BodyAssets`, which
 * the app backs with the asset worker and the tests with fixture files.
 */
import {
  Bone, BufferAttribute, BufferGeometry, DoubleSide, Group, MeshStandardNodeMaterial, SRGBColorSpace, Skeleton, SkinnedMesh, Texture,
  type Node,
} from 'three/webgpu';
import { attribute, mix, step, texture, uv, vec4 } from 'three/tsl';
import { HUMANOID_BONES, type QualityTierId } from '@dv/shared';
import catalogJson from '../../../../../content/ui/creator/catalog.json';
import pedArtJson from '../../../../../config/world/ped-art.json';
import { pickClips } from '../anim/clip-source.ts';
import { BONE_PARENT, BONE_REST, buildPlaceholderClips, type HumanoidBone, type PlaceholderRig } from '../anim/placeholder-rig.ts';
import { classColor, type AssemblyColors, type AssemblySlot } from './assemble.ts';
import { parsePersonGlb, type PersonMesh } from './person-glb.ts';

/** The variant of a part a tier draws: `mid` (the `mobile` files) on the flat desktop and mobile tiers, `lo` on `mobile-low` and XR. */
export type BodyVariant = 'mobile' | 'mobile-low';
export const bodyVariantOf = (tier: QualityTierId): BodyVariant =>
  tier === 'mobile-low' || tier === 'xr-quest' || tier === 'xr-visionpro' ? 'mobile-low' : 'mobile';

/** The render keys of the on-foot bodies: the player's (`character/pc-body-*`) and the mission actors' (`character/ped.body.*`). */
export const isPlayerBodyKey = (key: string): boolean => key.startsWith('character/pc-body-');
export const isActorBodyKey = (key: string): boolean => key.startsWith('character/ped.body.');
export const isBodyKey = (key: string): boolean => isPlayerBodyKey(key) || isActorBodyKey(key);

// ---- the catalog (content/ui/creator/catalog.json, read only; the UI's `normalizeAvatar` owns the rules this mirrors) -----------------

interface CatalogRow {
  id: string;
  model?: string;
  fallbackPart?: string;
  tint?: number;
  color?: string;
  retired?: boolean;
}
export interface BodyCatalog {
  slots: Record<string, CatalogRow[]>;
  palettes: { skin: string[]; hair: string[] };
  defaults: {
    body: { preset: string; height: number; build: number };
    face: { preset: string };
    skinTone: number;
    hair: { style: string; color: number };
    outfit: { top: string; bottom: string; shoes: string; accessory?: string };
  };
}
export const BODY_CATALOG = catalogJson as unknown as BodyCatalog;

export interface BodyPart {
  slot: AssemblySlot;
  /** The catalog row the avatar chose. */
  part: string;
  /** The model drawn: the row's own (`path: 'model'`) or its `fallbackPart`'s (`'fallback'`). */
  ref: string;
  path: 'model' | 'fallback';
}

/** What the player's body is made of: the parts, their colours, the face morphs and the slider scales. Pure data. */
export interface BodySpec {
  parts: BodyPart[];
  colors: AssemblyColors;
  morphs: Record<string, number>;
  heightScale: number;
  buildScale: number;
  /** Slots whose row had neither a model nor a modelled fallback (drawn without that part). */
  missing: AssemblySlot[];
}

const SLOTS: readonly AssemblySlot[] = ['body', 'face', 'hair', 'top', 'bottom', 'shoes', 'accessory'];
const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const hex = (s: string): number => Number.parseInt(s.replace('#', ''), 16);

/** HSL to 0xRRGGBB (hue 0..1): the mannequin tint rule of the creator (`tintColor` of `@dv/ui`; the engine imports no UI code). */
export function tintColor(h: number, s: number, l: number): number {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const to = (x: number): number => Math.round(x * 255);
  return (to(f(0)) << 16) | (to(f(8)) << 8) | to(f(4));
}

const rowOf = (cat: BodyCatalog, slot: AssemblySlot, id: unknown): CatalogRow | undefined =>
  typeof id === 'string' ? cat.slots[slot]?.find((r) => r.id === id && r.retired !== true) : undefined;

/**
 * The body of a stored `PlayerAvatar` (C05 1.1 `CoreSlice.avatar`, any JSON): every slot the avatar names, an unknown or missing id taking
 * the catalog default as the creator's `normalizeAvatar` does; a row without `model` draws its `fallbackPart`'s model (10-ui-pages.md 2.8
 * rule 6, the body and face included here: in the world the realistic default stands in for an unmodelled Coast part).
 */
export function resolveBody(raw: unknown, cat: BodyCatalog = BODY_CATALOG): BodySpec {
  const r = obj(raw);
  const d = cat.defaults;
  const body = obj(r['body']);
  const face = obj(r['face']);
  const hair = obj(r['hair']);
  const outfit = obj(r['outfit']);
  const ids: Record<AssemblySlot, unknown> = {
    body: body['preset'], face: face['preset'], hair: hair['style'], top: outfit['top'], bottom: outfit['bottom'], shoes: outfit['shoes'], accessory: outfit['accessory'],
  };
  const defaults: Record<AssemblySlot, string | undefined> = {
    body: d.body.preset, face: d.face.preset, hair: d.hair.style, top: d.outfit.top, bottom: d.outfit.bottom, shoes: d.outfit.shoes, accessory: d.outfit.accessory,
  };
  const parts: BodyPart[] = [];
  const missing: AssemblySlot[] = [];
  const chosen: Partial<Record<AssemblySlot, CatalogRow>> = {};
  for (const slot of SLOTS) {
    if (slot === 'accessory' && (ids.accessory === undefined || ids.accessory === null)) continue;
    const row = rowOf(cat, slot, ids[slot]) ?? (slot === 'accessory' ? undefined : rowOf(cat, slot, defaults[slot]));
    if (!row) continue;
    chosen[slot] = row;
    if (row.model) {
      parts.push({ slot, part: row.id, ref: row.model, path: 'model' });
      continue;
    }
    const fb = row.fallbackPart ? rowOf(cat, slot, row.fallbackPart) : undefined;
    if (fb?.model) parts.push({ slot, part: row.id, ref: fb.model, path: 'fallback' });
    else missing.push(slot);
  }
  // the garment colours: the row's own colour, else its tint at the creator's saturation and lightness (`mannequinParams` of `@dv/ui`)
  const tint = (slot: AssemblySlot, s: number, l: number): number => {
    const row = chosen[slot];
    return row?.color !== undefined ? hex(row.color) : tintColor(row?.tint ?? 0, s, l);
  };
  const skinTone = Math.round(num(r['skinTone'], 0, cat.palettes.skin.length - 1, d.skinTone));
  const hairColor = Math.round(num(hair['color'], 0, cat.palettes.hair.length - 1, d.hair.color));
  const morphs: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(face['morphs']))) if (typeof v === 'number' && Number.isFinite(v)) morphs[k] = Math.min(1, Math.max(-1, v));
  return {
    parts,
    colors: {
      skin: hex(cat.palettes.skin[skinTone] ?? cat.palettes.skin[0] ?? '#cccccc'),
      hair: hex(cat.palettes.hair[hairColor] ?? cat.palettes.hair[0] ?? '#222222'),
      top: tint('top', 0.55, 0.5),
      bottom: tint('bottom', 0.4, 0.32),
      shoes: tint('shoes', 0.2, 0.75),
      accessory: tint('accessory', 0.5, 0.5),
    },
    morphs,
    heightScale: 0.92 + 0.16 * num(body['height'], 0, 1, d.body.height),
    buildScale: 0.9 + 0.28 * num(body['build'], 0, 1, d.body.build),
    missing,
  };
}

/** A stable key of what a spec draws (a new key is a new body). */
export const bodySpecKey = (s: BodySpec): string =>
  JSON.stringify([s.parts.map((p) => p.ref), s.colors, Object.entries(s.morphs).sort(), s.heightScale.toFixed(3), s.buildScale.toFixed(3)]);

// ---- the ped kit of the mission actors (config/world/ped-art.json, read only) ---------------------------------------------------------

interface PedArt {
  bodies: Record<string, { body: string; hair: string }>;
  outfits: string[];
  atlas: string;
  skinTones: string[];
}
const PED_ART = pedArtJson as unknown as PedArt;
/** The actor's body and outfit (the milestone's pair) and the ped atlas. */
export const ACTOR_BODY = 'character/ped.body.a';
export const ACTOR_OUTFIT = 'character/ped.outfit.01';
export const ACTOR_ATLAS = PED_ART.atlas;
/** Garment colours an actor's seed picks from (sRGB): muted street colours, as the ambient crowd's. */
export const ACTOR_PALETTE: readonly number[] = [0x3b4a5c, 0x6b3a2e, 0x2f4f3a, 0x5a5a62, 0x7a6a4a, 0x2a2a30, 0x4a3a5a, 0x8a4a3a];

/** The colours of an actor from its seed (the entity handle): a garment colour and a skin tone of the ped kit. Pure. */
export function actorColors(seed: number): AssemblyColors {
  // an integer mix so neighbouring handles get different colours
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  const u = h >>> 0;
  const top = ACTOR_PALETTE[u % ACTOR_PALETTE.length] as number;
  const skin = hex(PED_ART.skinTones[(u >>> 8) % PED_ART.skinTones.length] ?? '#c58c5f');
  const hair = hex(PED_ART.bodies['character/ped.ambient.a']?.hair ?? '#2a1c14');
  return { skin, hair, top, bottom: top, shoes: 0x2a2a2e, accessory: top };
}

// ---- the merged figure --------------------------------------------------------------------------------------------------------------

/** Atlas page of each slot: 0 skin (body, face), 1 cloth (garments), 2 hair. */
const PAGE_OF: Readonly<Record<AssemblySlot, number>> = { body: 0, face: 0, top: 1, bottom: 1, shoes: 1, accessory: 1, hair: 2 };

export interface BodyFigure extends PlaceholderRig {
  /** The one skinned mesh of the body. */
  mesh: SkinnedMesh;
  material: MeshStandardNodeMaterial;
  skeleton: Skeleton;
  triangles: number;
  /** `file` / `mixed` when a baked clip file drove a state, `placeholder` otherwise (M10d4 `clip-source.ts`). */
  clipSource: 'file' | 'placeholder' | 'mixed';
}

export interface BodyInput {
  parts: readonly { slot: AssemblySlot; mesh: PersonMesh }[];
  colors: AssemblyColors;
  morphs?: Readonly<Record<string, number>>;
  /** The player's three creator pages, picked per vertex. */
  pages?: Partial<Record<'skin' | 'cloth' | 'hair', Texture>>;
  /** One page for every vertex (the ped atlas of an actor). */
  atlas?: Texture;
  /** Every slot as this one for the vertex colours (the ped kit paints garments with `top`). */
  colorSlot?: AssemblySlot;
}

const morphName = (id: string): string => `morph_${id.replace(/-/g, '_')}`;

/** Builds one body: the parts merged into one skinned mesh with one material on a fresh `bay_rig_v1` skeleton, feet on the origin, facing -Z. */
export function buildBody(input: BodyInput): BodyFigure {
  const parts = input.parts;
  const verts = parts.reduce((a, p) => a + p.mesh.position.length / 3, 0);
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const uvs = new Float32Array(verts * 2);
  const page = new Float32Array(verts);
  const col = new Float32Array(verts * 3);
  const skinIndex = new Uint16Array(verts * 4);
  const skinWeight = new Float32Array(verts * 4);
  const idx = new Uint32Array(parts.reduce((a, p) => a + p.mesh.index.length, 0));
  let base = 0;
  let at = 0;
  const cache = new Map<string, [number, number, number]>();
  const weights = new Map(Object.entries(input.morphs ?? {}).map(([id, w]) => [morphName(id), w]));
  for (const p of parts) {
    const m = p.mesh;
    const n = m.position.length / 3;
    pos.set(m.position, base * 3);
    // the face's morphs, baked: position plus weight times delta (no morph target on the in-game mesh)
    for (const t of m.targets) {
      const w = weights.get(t.name) ?? 0;
      if (w === 0) continue;
      for (let i = 0; i < n * 3; i++) pos[base * 3 + i] = (pos[base * 3 + i] as number) + w * (t.position[i] as number);
    }
    if (m.normal) nor.set(m.normal, base * 3);
    if (m.uv) uvs.set(m.uv, base * 2);
    if (m.joints) skinIndex.set(m.joints, base * 4);
    if (m.weights) skinWeight.set(m.weights, base * 4);
    page.fill(PAGE_OF[p.slot], base, base + n);
    const slot = input.colorSlot ?? p.slot;
    for (let i = 0; i < n; i++) {
      const cls = m.part?.[i] ?? 0;
      const key = `${slot}:${cls}`;
      let c = cache.get(key);
      if (!c) {
        c = classColor(cls, slot, input.colors);
        cache.set(key, c);
      }
      const shade = m.ao?.[i] ?? 1;
      col[(base + i) * 3] = c[0] * shade;
      col[(base + i) * 3 + 1] = c[1] * shade;
      col[(base + i) * 3 + 2] = c[2] * shade;
    }
    for (let i = 0; i < m.index.length; i++) idx[at + i] = (m.index[i] as number) + base;
    at += m.index.length;
    base += n;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nor, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setAttribute('aPage', new BufferAttribute(page, 1));
  geo.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  geo.setIndex(new BufferAttribute(idx, 1));

  // one material: the vertex colour times the page the vertex reads (none: the vertex colour alone). Hair cards need both sides.
  const material = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.02, transparent: true, side: DoubleSide });
  material.name = 'dv:body';
  const pages = input.pages;
  if (input.atlas) material.map = input.atlas;
  else if (pages && (pages.skin || pages.cloth || pages.hair)) {
    // three's static node types reject a texture sample beside a constant in one `mix`; the shapes agree (vec4), so the calls go untyped
    type AnyNode = Node<'vec4'>;
    const mixN = mix as unknown as (a: AnyNode, b: AnyNode, t: AnyNode) => AnyNode;
    const stepN = step as unknown as (edge: number, x: AnyNode) => AnyNode;
    const sample = (t: Texture | undefined): AnyNode => (t ? texture(t, uv()) : vec4(1, 1, 1, 1)) as unknown as AnyNode;
    const p = attribute('aPage', 'float') as unknown as AnyNode;
    material.colorNode = mixN(mixN(sample(pages.skin), sample(pages.cloth), stepN(0.5, p)), sample(pages.hair), stepN(1.5, p));
  }

  const root = new Group();
  root.name = 'dv:body';
  const bones = new Map<HumanoidBone, Bone>();
  const list: Bone[] = [];
  for (const name of HUMANOID_BONES) {
    const bone = new Bone();
    bone.name = name;
    bone.position.set(...(BONE_REST[name] as [number, number, number]));
    bones.set(name, bone);
    list.push(bone);
  }
  for (const name of HUMANOID_BONES) {
    const parent = BONE_PARENT[name];
    (parent ? (bones.get(parent) as Bone) : root).add(bones.get(name) as Bone);
  }
  const mesh = new SkinnedMesh(geo, material);
  mesh.name = 'dv:body.mesh';
  mesh.frustumCulled = false;
  root.add(mesh);
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(list);
  mesh.bind(skeleton);
  // the clips: the baked file's states when one exists (none yet: every state plays its placeholder clip, M10d4 AC-6's fallback)
  const picked = pickClips(buildPlaceholderClips(), null);
  return {
    root, bones, clips: picked.clips, mesh, material, skeleton,
    triangles: idx.length / 3,
    clipSource: picked.source,
    setOpacity: (o) => {
      material.opacity = o;
      root.visible = o > 0.01;
    },
    dispose: () => {
      geo.dispose();
      material.dispose();
      skeleton.dispose();
    },
  };
}

// ---- loading ------------------------------------------------------------------------------------------------------------------------

/** The bytes and images the bodies need; the app backs it with the asset worker (the variant's files), the tests with fixtures. */
export interface BodyAssets {
  /** The bytes of `refs` at `variant`, in order; rejects when one is not in the catalog or fails. */
  group(refs: string[], variant: BodyVariant): Promise<(ArrayBuffer | Uint8Array)[]>;
  /** An atlas page as a decoded image at `variant`; null when it cannot be had (the body draws untextured). */
  image?(ref: string, variant: BodyVariant): Promise<{ source: unknown } | null>;
}

/** The creator's three atlas pages. */
export const PLAYER_PAGES = { skin: 'texture/pc.skin', cloth: 'texture/pc.cloth', hair: 'texture/pc.hair' } as const;

export type BodyState = 'loading' | 'ready' | 'failed';

/**
 * Loads and keeps the parsed parts and the atlas pages of one variant (one read per ref; a failure is kept so the pool keeps the mannequin
 * and does not ask again). `version` counts arrivals, so the pool swaps a mannequin for its body on the next frame.
 */
export class BodyLoader {
  private readonly meshes = new Map<string, PersonMesh>();
  private readonly images = new Map<string, Texture | null>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly failedRefs = new Map<string, string>();
  version = 0;

  constructor(private readonly assets: BodyAssets, readonly variant: BodyVariant) {}

  /** The parsed parts of `refs` when all have arrived; starts their read otherwise. Null while loading or when one failed (`failure`). */
  parts(refs: readonly string[]): PersonMesh[] | null {
    const missing = refs.filter((r) => !this.meshes.has(r) && !this.failedRefs.has(r));
    if (missing.length > 0) this.read(missing);
    if (refs.some((r) => !this.meshes.has(r))) return null;
    return refs.map((r) => this.meshes.get(r) as PersonMesh);
  }

  /** An atlas page once read (null when it could not be had); undefined while it loads. */
  image(ref: string): Texture | null | undefined {
    if (this.images.has(ref)) return this.images.get(ref) as Texture | null;
    if (!this.inflight.has(`img:${ref}`)) {
      const p = (this.assets.image ? this.assets.image(ref, this.variant) : Promise.resolve(null))
        .then((img) => {
          let t: Texture | null = null;
          if (img) {
            t = new Texture(img.source as ImageBitmap);
            t.colorSpace = SRGBColorSpace;
            t.flipY = false;
            t.needsUpdate = true;
          }
          this.images.set(ref, t);
        })
        .catch(() => void this.images.set(ref, null))
        .finally(() => {
          this.inflight.delete(`img:${ref}`);
          this.version++;
        });
      this.inflight.set(`img:${ref}`, p);
    }
    return undefined;
  }

  /** The first of `refs` that failed to load, and why; null when none did. */
  failure(refs: readonly string[]): { ref: string; reason: string } | null {
    for (const r of refs) {
      const reason = this.failedRefs.get(r);
      if (reason !== undefined) return { ref: r, reason };
    }
    return null;
  }

  /** Resolves when nothing is in flight (tests). */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight.values()]);
  }

  dispose(): void {
    for (const t of this.images.values()) t?.dispose();
    this.images.clear();
    this.meshes.clear();
  }

  private read(refs: string[]): void {
    const want = refs.filter((r) => !this.inflight.has(r));
    if (want.length === 0) return;
    const take = (ref: string, b: ArrayBuffer | Uint8Array | undefined): void => {
      if (!b) {
        this.failedRefs.set(ref, 'no bytes');
        return;
      }
      try {
        this.meshes.set(ref, parsePersonGlb(b instanceof Uint8Array ? b : new Uint8Array(b)));
      } catch (e) {
        this.failedRefs.set(ref, e instanceof Error ? e.message : String(e));
      }
    };
    const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));
    const p = this.assets
      .group(want, this.variant)
      .then((files) => want.forEach((ref, i) => take(ref, files[i])))
      // a group that fails is read again one file at a time, so the report names the part that failed (only on a failure)
      .catch(async () => {
        for (const ref of want) {
          try {
            take(ref, (await this.assets.group([ref], this.variant))[0]);
          } catch (e) {
            this.failedRefs.set(ref, why(e));
          }
        }
      })
      .finally(() => {
        for (const ref of want) this.inflight.delete(ref);
        this.version++;
      });
    for (const ref of want) this.inflight.set(ref, p);
  }
}

/** What one body is waiting for, or how it is drawn. */
export type BodyBuild = { state: 'loading' } | { state: 'failed'; ref: string; reason: string } | { state: 'ready'; figure: BodyFigure };

/** The player's body of `spec` from `loader`: loading until the parts and the three pages are in, then built. */
export function playerBody(loader: BodyLoader, spec: BodySpec): BodyBuild {
  const refs = spec.parts.map((p) => p.ref);
  const fail = loader.failure(refs);
  if (fail) return { state: 'failed', ...fail };
  const meshes = loader.parts(refs);
  const skin = loader.image(PLAYER_PAGES.skin);
  const cloth = loader.image(PLAYER_PAGES.cloth);
  const hair = loader.image(PLAYER_PAGES.hair);
  if (!meshes || skin === undefined || cloth === undefined || hair === undefined) return { state: 'loading' };
  const pages: Partial<Record<'skin' | 'cloth' | 'hair', Texture>> = {};
  if (skin) pages.skin = skin;
  if (cloth) pages.cloth = cloth;
  if (hair) pages.hair = hair;
  const figure = buildBody({ parts: spec.parts.map((p, i) => ({ slot: p.slot, mesh: meshes[i] as PersonMesh })), colors: spec.colors, morphs: spec.morphs, pages });
  const heightM = typeof meshes[spec.parts.findIndex((p) => p.slot === 'body')]?.extras['heightM'] === 'number'
    ? (meshes[spec.parts.findIndex((p) => p.slot === 'body')]?.extras['heightM'] as number)
    : 1.8;
  figure.root.scale.set(spec.buildScale, (spec.heightScale * heightM) / 1.8, spec.buildScale);
  return { state: 'ready', figure };
}

/** A mission actor's ped-kit body (`ACTOR_BODY` with `ACTOR_OUTFIT` on the ped atlas), tinted by its seed. */
export function actorBody(loader: BodyLoader, seed: number): BodyBuild {
  const refs = [ACTOR_BODY, ACTOR_OUTFIT];
  const fail = loader.failure(refs);
  if (fail) return { state: 'failed', ...fail };
  const meshes = loader.parts(refs);
  const atlas = loader.image(ACTOR_ATLAS);
  if (!meshes || atlas === undefined) return { state: 'loading' };
  const figure = buildBody({
    parts: [{ slot: 'body', mesh: meshes[0] as PersonMesh }, { slot: 'top', mesh: meshes[1] as PersonMesh }],
    colors: actorColors(seed),
    colorSlot: 'top',
    ...(atlas ? { atlas } : {}),
  });
  return { state: 'ready', figure };
}
