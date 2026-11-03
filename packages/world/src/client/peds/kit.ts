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
import type { PedJobArgs, PedJobResult, PedStopArgs } from './ped-job.ts';
import { OPEN_GATE, type KitGate } from './art-gate.ts';

// for the world view's one `art-hook:peds` import line: it counts its unsettled streaming units with this for the kit's gate
export { unsettledUnits } from './art-gate.ts';

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
  /** The bytes of one ref; rejects when `signal` aborts first. */
  bytes(ref: string, signal?: AbortSignal): Promise<ArrayBuffer | Uint8Array>;
  /**
   * The bytes of a group of refs, in order, read one after another in one request. Once `signal` aborts the read stops before its next
   * file and answers the files it has: a prefix of `refs`, possibly empty. Absent: `bytes` per ref, one after another.
   */
  group?(refs: string[], signal?: AbortSignal): Promise<(ArrayBuffer | Uint8Array)[]>;
  /** The ped atlas page as a decoded image; null when it cannot be had (the ped draws untextured); rejects when `signal` aborts first. */
  image?(ref: string, signal?: AbortSignal): Promise<{ width: number; height: number; source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas } | null>;
}

const stopped = (): Error => Object.assign(new Error('the pedestrian kit step was stopped'), { name: 'AbortError' });

/** Read tokens of `world.ped`, unique in the page (every kit shares the one asset worker). */
let readSeq = 0;

/**
 * The kit's asset port backed by the asset worker (`world.ped`, `ped-job.ts`): the bytes of the tier's variant, a group per job. When the
 * step's signal aborts (the world got busy) the port sends `{ stop: token }`, so the worker stops before its next file and answers what it
 * has read. The atlas page is decoded on this thread (`createImageBitmap`). A ref the catalog lacks rejects, so `loadPedKit` resolves
 * `null` and the mannequin stays; an atlas that cannot be had draws the kit untextured.
 */
export function pedKitAssets(client: { job(name: string, args: unknown): Promise<unknown> }, variant: PedJobArgs['variant']): PedKitAssets {
  const group = async (refs: string[], signal?: AbortSignal): Promise<ArrayBuffer[]> => {
    if (signal?.aborted) return [];
    const token = `ped-${++readSeq}`;
    const stop = (): void => void client.job('world.ped', { stop: token } satisfies PedStopArgs).catch(() => undefined);
    signal?.addEventListener('abort', stop, { once: true });
    try {
      const r = (await client.job('world.ped', { refs, variant, token } satisfies PedJobArgs)) as PedJobResult;
      if ('missing' in r) throw new Error(`${refs.join(', ')}: not in the asset catalog`);
      if (!('files' in r)) throw new Error('world.ped: no files');
      return r.files;
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  };
  const read = async (ref: string, signal?: AbortSignal): Promise<ArrayBuffer> => {
    const [b] = await group([ref], signal);
    if (!b) throw stopped();
    return b;
  };
  return {
    bytes: read,
    group,
    image: async (ref, signal) => {
      // a stopped read rejects (the loader asks again after the next quiet window); a file that does not decode draws untextured
      const bytes = await read(ref, signal);
      try {
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        return { width: bitmap.width, height: bitmap.height, source: bitmap };
      } catch {
        return null;
      }
    },
  };
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
/** The far figure's hair shade: the tint times this (red and green channels of its vertex colour). */
const FAR_HAIR = 0.22;

/** The files of `refs` one after another, stopping before the next once `signal` aborts (the port without `group`). */
async function oneByOne(assets: PedKitAssets, refs: string[], signal: AbortSignal): Promise<(ArrayBuffer | Uint8Array)[]> {
  const out: (ArrayBuffer | Uint8Array)[] = [];
  for (const ref of refs) {
    if (signal.aborted) break;
    try {
      out.push(await assets.bytes(ref, signal));
    } catch (e) {
      if (signal.aborted) break;
      throw e;
    }
  }
  return out;
}

/**
 * The files of one group, parsed. Each request starts only while the gate is open and carries its signal: when the world gets busy the
 * worker stops before its next file and answers the files it has, and the rest is asked for after the next quiet window. Each file is
 * parsed (main-thread work) only while the gate is open.
 */
async function readGroup(assets: PedKitAssets, refs: string[], gate: KitGate): Promise<PersonMesh[]> {
  const out: PersonMesh[] = [];
  while (out.length < refs.length) {
    await gate.wait();
    const rest = refs.slice(out.length);
    const signal = gate.signal();
    const got = assets.group ? await assets.group(rest, signal) : await oneByOne(assets, rest, signal);
    if (got.length === 0 && !signal.aborted) throw new Error(`${rest[0] ?? ''}: no bytes`);
    for (const b of got.slice(0, rest.length)) {
      if (!gate.open) await gate.wait();
      out.push(parsePersonGlb(toBytes(b)));
    }
  }
  return out;
}

/** The atlas page, asked for while the gate is open and again after the next quiet window when the world stops it. */
async function readImage(assets: PedKitAssets, ref: string, gate: KitGate): Promise<{ width: number; height: number; source: unknown } | null> {
  if (!assets.image) return null;
  for (;;) {
    await gate.wait();
    const signal = gate.signal();
    try {
      return await assets.image(ref, signal);
    } catch (e) {
      if (!signal.aborted) throw e;
    }
  }
}

/**
 * Loads every asset of the kit in four steps (the bodies, the far figures, the outfits, the atlas) and builds it; resolves `null` when any
 * file fails or the gate is disposed (the mannequin then stays, nothing half-built is kept). The files of a step are read one after
 * another (`PedKitAssets.group`, one asset-worker job), so the kit holds at most one of the two `idle` fetch slots. Every request, every
 * parse and the build wait for `gate` (`art-gate.ts`): with the renderer's gate the kit takes the asset worker, the fetch lanes and the
 * main thread only while the world is quiet, and a request in flight stops at its next file when the world gets busy
 * (BD-REPAIR-M10d4-03). The default gate is always open.
 */
export async function loadPedKit(assets: PedKitAssets, cfg: PedArtConfig = PED_ART, gate: KitGate = OPEN_GATE): Promise<PedKit | null> {
  const keys = Object.keys(cfg.bodies);
  try {
    const bodies = await readGroup(assets, keys.map((k) => (cfg.bodies[k] as { body: string }).body), gate);
    const fars = await readGroup(assets, keys.map((k) => (cfg.bodies[k] as { far: string }).far), gate);
    const outfits = await readGroup(assets, cfg.outfits, gate);
    const image = await readImage(assets, cfg.atlas, gate);
    await gate.wait();
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
      // skin vertices carry blue 0 (the marker the far material reads), garments white (they take the tint), hair a dark grey that
      // the far material multiplies into the tint (red channel), so a far figure's hair is never the colour of its top
      const n = f.position.length / 3;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const cls = (f.part as Float32Array)[i] as number;
        if (cls === 0 || cls === 5) col.set([1, 1, 0], i * 3);
        else if (cls === 3) col.set([FAR_HAIR, FAR_HAIR, 1], i * 3);
        else col.set([1, 1, 1], i * 3);
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
