/**
 * The pedestrian kit (02-world-living.md 4.5; M10d4): the final bodies and outfits of the ambient crowd, built from the `character/ped.body.*`,
 * `character/ped.outfit.*` and `prop/ped.far.*` assets of `config/world/ped-art.json`.
 *
 *  - a near ped is ONE `SkinnedMesh` with ONE material: the body (skin, face, hair) and its outfit (top, bottom, shoes, accessory) are merged
 *    on the same 22 `bay_rig_v1` bones, the palette colour of the ped goes into the garment vertices, its skin tone into the skin vertices
 *    and the ped atlas is the one texture;
 *  - the far figure of a body is a rigid mesh of at most 300 triangles with the gait attributes `aSwing` and `aPivot` the renderer's TSL
 *    gait reads, and the same skin marker (blue channel 0) as the old far figure;
 *  - a load that fails leaves the kit unbuilt (`null`), and the renderer keeps the mannequin of `mannequin.ts`.
 *
 * The sim, the caps and `CrowdLimits` are not touched. The kit is built behind an asset port, so the unit tests run it on mock bytes.
 */
import {
  Bone, BufferAttribute, BufferGeometry, Group, MeshStandardNodeMaterial, SRGBColorSpace, Skeleton, SkinnedMesh, Texture, type Object3D,
} from 'three/webgpu';
import { HUMANOID_BONES } from '@dv/shared';
import { BONE_PARENT, BONE_REST, buildPlaceholderClips } from '@dv/engine/client/anim';
import { classColor, type AssemblyColors, type AssemblySlot } from '@dv/engine/client/avatar/assemble';
import { parsePersonGlb, type PersonMesh } from '@dv/engine/client/avatar/person-glb';
import pedArtJson from '../../../../../config/world/ped-art.json';
import type { NearFigure } from './mannequin.ts';

export interface PedArtConfig {
  schema: 'ped-art/1';
  bodies: Record<string, { body: string; far: string; hair: string }>;
  outfits: string[];
  atlas: string;
  clips: string;
  skinTones: string[];
  limits: { textureMegabytes: { full: number; lite: number; min: number; legacy: number }; farMeshes: number };
}

export const PED_ART: PedArtConfig = pedArtJson as unknown as PedArtConfig;

/** The bytes and textures the kit needs; the app backs it with the asset client, the tests with fixtures. */
export interface PedKitAssets {
  bytes(ref: string): Promise<ArrayBuffer | Uint8Array>;
  /** The ped atlas page as a decoded image; null when it cannot be had (the ped draws untextured). */
  image?(ref: string): Promise<{ width: number; height: number; source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas } | null>;
}

/** What `world.peds().art` reports (the QA bridge block of the art-hook fence in world-bridge.ts). */
export interface PedArtInfo {
  /** Bodies of the kit that loaded. */
  bodies: number;
  near: 'kit' | 'mannequin';
  far: 'kit' | 'mannequin';
  clips: 'anim/ped.moves' | 'placeholder';
  textureBytes: number;
}

export interface PedKit {
  /** The sim key to its body letter index (0 to 7). */
  readonly keys: readonly string[];
  info(): PedArtInfo;
  /** A new near figure: the body of the sim key with outfit `outfit` (0 to 19), garments in the palette colour, skin of the tone. */
  near(key: string, outfit: number, tint: number, skinTone: number): NearFigure;
  /** The far figure geometry of a sim key: position, normal, colour (skin marker), `aSwing`, `aPivot`. */
  far(key: string): BufferGeometry;
  dispose(): void;
}

const toHex = (s: string): number => Number.parseInt(s.replace('#', ''), 16);

function merge(a: PersonMesh, b: PersonMesh): PersonMesh {
  const cat = <T extends Float32Array | Uint16Array>(x: T | null, y: T | null, na: number, nb: number, size: number, make: (n: number) => T): T | null => {
    if (!x && !y) return null;
    const out = make((na + nb) * size);
    if (x) out.set(x as never, 0);
    if (y) out.set(y as never, na * size);
    return out;
  };
  const na = a.position.length / 3, nb = b.position.length / 3;
  const f = (n: number): Float32Array => new Float32Array(n);
  const index = new Uint32Array(a.index.length + b.index.length);
  index.set(a.index, 0);
  for (let i = 0; i < b.index.length; i++) index[a.index.length + i] = (b.index[i] as number) + na;
  return {
    extras: a.extras,
    position: cat(a.position, b.position, na, nb, 3, f) as Float32Array,
    normal: cat(a.normal, b.normal, na, nb, 3, f),
    uv: cat(a.uv, b.uv, na, nb, 2, f),
    ao: cat(a.ao, b.ao, na, nb, 1, f),
    part: cat(a.part, b.part, na, nb, 1, f),
    joints: cat(a.joints, b.joints, na, nb, 4, (n) => new Uint16Array(n)),
    weights: cat(a.weights, b.weights, na, nb, 4, f),
    swing: null,
    pivot: null,
    index,
    targets: [],
  };
}

const SLOT_OF_CLASS: AssemblySlot = 'top';

/** Loads every asset of the kit; resolves `null` when any of them fails (the mannequin then stays, nothing half-built is kept). */
export async function loadPedKit(assets: PedKitAssets, cfg: PedArtConfig = PED_ART): Promise<PedKit | null> {
  const keys = Object.keys(cfg.bodies);
  try {
    const bodies = await Promise.all(keys.map(async (k) => parsePersonGlb(toBytes(await assets.bytes((cfg.bodies[k] as { body: string }).body)))));
    const fars = await Promise.all(keys.map(async (k) => parsePersonGlb(toBytes(await assets.bytes((cfg.bodies[k] as { far: string }).far)))));
    const outfits = await Promise.all(cfg.outfits.map(async (ref) => parsePersonGlb(toBytes(await assets.bytes(ref)))));
    const image = (await assets.image?.(cfg.atlas)) ?? null;
    return buildKit(cfg, keys, bodies, fars, outfits, image);
  } catch {
    return null;
  }
}

const toBytes = (b: ArrayBuffer | Uint8Array): Uint8Array => (b instanceof Uint8Array ? b : new Uint8Array(b));

function buildKit(
  cfg: PedArtConfig, keys: string[], bodies: PersonMesh[], fars: PersonMesh[], outfits: PersonMesh[],
  image: { width: number; height: number; source: unknown } | null,
): PedKit {
  let texture: Texture | null = null;
  if (image) {
    texture = new Texture(image.source as ImageBitmap);
    texture.colorSpace = SRGBColorSpace;
    texture.flipY = false;
    texture.needsUpdate = true;
  }
  const textureBytes = image ? Math.ceil((image.width * image.height * 4 * 4) / 3) : 0;
  const pairs = new Map<string, PersonMesh>();
  const pair = (b: number, o: number): PersonMesh => {
    const key = `${b}:${o}`;
    let m = pairs.get(key);
    if (!m) {
      m = merge(bodies[b] as PersonMesh, outfits[o] as PersonMesh);
      pairs.set(key, m);
    }
    return m;
  };
  const material = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });
  if (texture) material.map = texture;
  const skinTones = cfg.skinTones.map(toHex);
  const farGeos = new Map<string, BufferGeometry>();
  let disposed = false;
  const kit: PedKit = {
    keys,
    info: () => ({ bodies: bodies.length, near: 'kit', far: 'kit', clips: 'placeholder', textureBytes }),
    near(key, outfit, tint, skinTone) {
      const b = keys.indexOf(key);
      if (b < 0) throw new Error(`no kit body for ${key}`);
      const m = pair(b, ((outfit % cfg.outfits.length) + cfg.outfits.length) % cfg.outfits.length);
      const root = new Group();
      root.name = 'ped.near';
      const bones = new Map<(typeof HUMANOID_BONES)[number], Bone>();
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
      const n = m.position.length / 3;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(m.position, 3));
      geo.setAttribute('normal', new BufferAttribute(m.normal as Float32Array, 3));
      geo.setAttribute('uv', new BufferAttribute(m.uv as Float32Array, 2));
      geo.setAttribute('skinIndex', new BufferAttribute(m.joints as Uint16Array, 4));
      geo.setAttribute('skinWeight', new BufferAttribute(m.weights as Float32Array, 4));
      geo.setIndex(new BufferAttribute(m.index, 1));
      const colour = new BufferAttribute(new Float32Array(n * 3), 3);
      geo.setAttribute('color', colour);
      const paint = (palette: number, skin: number): void => {
        const c: AssemblyColors = { skin, hair: toHex((cfg.bodies[key] as { hair: string }).hair), top: palette, bottom: palette, shoes: 0x2a2a2e, accessory: palette };
        const cache = new Map<number, [number, number, number]>();
        for (let i = 0; i < n; i++) {
          const cls = (m.part as Float32Array)[i] as number;
          let v = cache.get(cls);
          if (!v) {
            v = classColor(cls, SLOT_OF_CLASS, c);
            cache.set(cls, v);
          }
          const shade = (m.ao as Float32Array)[i] as number;
          colour.setXYZ(i, v[0] * shade, v[1] * shade, v[2] * shade);
        }
        colour.needsUpdate = true;
      };
      paint(tint, skinTones[skinTone % skinTones.length] as number);
      const mesh = new SkinnedMesh(geo, material);
      mesh.name = 'ped.near.mesh';
      mesh.frustumCulled = false;
      root.add(mesh);
      root.updateMatrixWorld(true);
      const skeleton = new Skeleton(list);
      mesh.bind(skeleton);
      const figure: NearFigure = {
        root, bones, clips: buildPlaceholderClips(), mesh,
        setTint: (hex) => paint(hex, skinTones[skinTone % skinTones.length] as number),
        setOpacity: (o) => {
          root.visible = o > 0.01;
        },
        dispose: () => {
          geo.dispose();
          skeleton.dispose();
        },
      };
      return figure;
    },
    far(key) {
      const have = farGeos.get(key);
      if (have) return have;
      const b = keys.indexOf(key);
      const f = fars[b] as PersonMesh;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(f.position, 3));
      geo.setAttribute('normal', new BufferAttribute(f.normal as Float32Array, 3));
      // skin vertices carry blue 0 (the marker the far material reads), garments white
      const n = f.position.length / 3;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const skin = ((f.part as Float32Array)[i] as number) === 0;
        col.set([1, 1, skin ? 0 : 1], i * 3);
      }
      geo.setAttribute('color', new BufferAttribute(col, 3));
      geo.setAttribute('aSwing', new BufferAttribute(f.swing as Float32Array, 1));
      geo.setAttribute('aPivot', new BufferAttribute(f.pivot as Float32Array, 1));
      geo.setIndex(new BufferAttribute(f.index, 1));
      farGeos.set(key, geo);
      return geo;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const g of farGeos.values()) g.dispose();
      material.dispose();
      texture?.dispose();
    },
  };
  return kit;
}

export type { Object3D };
