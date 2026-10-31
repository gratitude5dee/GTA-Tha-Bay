/**
 * The geometry of the instanced traffic's families (M10d1): the typed `config/world/traffic-art.json`, a decoded model merged into one
 * static geometry (wheels included, nothing spins) with a part id per vertex, and the gray-box stand-in a family draws until its model
 * has arrived. The geometries are laid out for the instance matrix: ground at y = 0, the model's bounds centred on x and z, forward -Z.
 */
import { BoxGeometry, BufferAttribute, BufferGeometry } from 'three/webgpu';
import { walkArt, type ArtModelData } from '@dv/engine/client/vehicle/art-model';
import { PART } from '@dv/shared';
import artJson from '../../../../../config/world/traffic-art.json';
import type { LookProfile } from '../look/config.ts';

export interface TrafficArtMember {
  base: string;
  /** Overall [width, height, length], metres. */
  size: readonly [number, number, number];
  tint: boolean;
  /** sRGB hex of the fixed paint when `tint` is false. */
  paint?: string;
  liveryShare: number;
}

export interface TrafficArtProfile {
  variant: 'desktop' | 'mobile' | 'mobile-low';
  splitGlass: boolean;
  /** Family (named by the base model it draws) to the member bases it hosts. */
  families: Readonly<Record<string, readonly string[]>>;
}

export interface TrafficArtFile {
  schema: 'traffic-art/1';
  bases: Readonly<Record<string, string>>;
  members: Readonly<Record<string, TrafficArtMember>>;
  profiles: Readonly<Record<LookProfile, TrafficArtProfile>>;
}

export const TRAFFIC_ART: TrafficArtFile = artJson as unknown as TrafficArtFile;

/** The family (its base name) that draws a member under a profile, or undefined when the profile hosts none for it. */
export function familyOf(cfg: TrafficArtFile, profile: LookProfile, assetRef: string): string | undefined {
  const m = cfg.members[assetRef];
  if (!m) return undefined;
  const p = cfg.profiles[profile];
  for (const [family, hosts] of Object.entries(p.families)) if (hosts.includes(m.base)) return family;
  return undefined;
}

/** Family names of a profile, in config order. */
export const familiesOf = (cfg: TrafficArtFile, profile: LookProfile): string[] => Object.keys(cfg.profiles[profile].families);

export interface FamilyGeometry {
  opaque: BufferGeometry;
  /** The glass primitives, when the profile splits them off and the model has any. */
  glass: BufferGeometry | null;
  /** Bounds size [width, height, length] of what was merged: the instance scale is the member size over this. */
  size: readonly [number, number, number];
  triangles: number;
}

interface Acc {
  pos: number[];
  nor: number[];
  col: number[];
  part: number[];
  idx: number[];
}

const acc = (): Acc => ({ pos: [], nor: [], col: [], part: [], idx: [] });

function toGeometry(a: Acc): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(Float32Array.from(a.pos), 3));
  g.setAttribute('normal', new BufferAttribute(Float32Array.from(a.nor), 3));
  g.setAttribute('color', new BufferAttribute(Float32Array.from(a.col), 3));
  g.setAttribute('aPart', new BufferAttribute(Float32Array.from(a.part), 1));
  g.setIndex(a.idx.length > 65535 ? new BufferAttribute(Uint32Array.from(a.idx), 1) : new BufferAttribute(Uint16Array.from(a.idx), 1));
  return g;
}

/**
 * Merges a model's rendered nodes (the collider is left out) into one geometry. The paint and livery parts take a white vertex colour, so
 * the instance tint is the colour; the other parts keep theirs. `splitGlass` puts the primitives named `glass` in a second geometry.
 */
export interface MergeOptions {
  /** Colours (linear) of the paint and the livery parts instead of white (the transit liveries). */
  paint?: readonly [number, number, number];
  livery?: readonly [number, number, number];
  /** Move the model so that the bottom of its bounds lies at this y (a prefab box's floor); default: as authored (ground at 0). */
  bottomTo?: number;
}

export function mergeModel(model: ArtModelData, splitGlass: boolean, opts: MergeOptions = {}): FamilyGeometry {
  const opaque = acc();
  const glass = acc();
  const b = model.bounds;
  const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2;
  const dy = opts.bottomTo !== undefined ? opts.bottomTo - b[1] : 0;
  let triangles = 0;
  walkArt(model, (node, w) => {
    if (node.name === 'collider_hull') return;
    for (const p of node.primitives) {
      const into = splitGlass && p.material === 'glass' ? glass : opaque;
      const base = into.pos.length / 3;
      for (let i = 0; i < p.positions.length; i += 3) {
        into.pos.push((p.positions[i] as number) + w[0] - cx, (p.positions[i + 1] as number) + w[1] + dy, (p.positions[i + 2] as number) + w[2] - cz);
        into.nor.push(p.normals[i] as number, p.normals[i + 1] as number, p.normals[i + 2] as number);
      }
      for (let v = 0; v < p.parts.length; v++) {
        const part = p.parts[v] as number;
        into.part.push(part);
        const fixed = part === PART.paint ? (opts.paint ?? [1, 1, 1]) : part === PART.livery ? (opts.livery ?? [1, 1, 1]) : null;
        into.col.push(fixed ? fixed[0] : (p.colors[v * 3] as number), fixed ? fixed[1] : (p.colors[v * 3 + 1] as number), fixed ? fixed[2] : (p.colors[v * 3 + 2] as number));
      }
      for (const i of p.indices) into.idx.push(i + base);
      triangles += p.indices.length / 3;
    }
  });
  return {
    opaque: toGeometry(opaque),
    glass: glass.idx.length > 0 ? toGeometry(glass) : null,
    size: [b[3] - b[0], b[4] - b[1], b[5] - b[2]],
    triangles,
  };
}

/** The gray-box car a family draws until its model arrives: a body box and a glass cabin, sized like a sedan, on the new materials. */
export function placeholderGeometry(): FamilyGeometry {
  const o = acc();
  const add = (w: number, h: number, l: number, x: number, y: number, z: number, part: number, c: readonly [number, number, number]): void => {
    const g = new BoxGeometry(w, h, l);
    const gp = g.getAttribute('position'), gn = g.getAttribute('normal');
    const base = o.pos.length / 3;
    for (let i = 0; i < gp.count; i++) {
      o.pos.push(gp.getX(i) + x, gp.getY(i) + y, gp.getZ(i) + z);
      o.nor.push(gn.getX(i), gn.getY(i), gn.getZ(i));
      o.col.push(c[0], c[1], c[2]);
      o.part.push(part);
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) o.idx.push(gi.getX(i) + base);
    g.dispose();
  };
  add(1.85, 0.12, 4.5, 0, 0.2, 0, PART.trim, [0.1, 0.1, 0.11]);
  add(1.85, 0.7, 4.7, 0, 0.62, 0, PART.paint, [1, 1, 1]);
  add(1.6, 0.55, 2.4, 0, 1.22, 0.3, PART.glass, [0.02, 0.03, 0.05]);
  return { opaque: toGeometry(o), glass: null, size: [1.85, 1.5, 4.7], triangles: o.idx.length / 3 };
}
