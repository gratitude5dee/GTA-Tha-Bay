/**
 * The look materials (M02e): one TSL `MeshStandardNodeMaterial` per object kind and profile, so the pipelines stay few.
 *
 *  - L0 `terrain` and `roads`: the ground material (asphalt, paving, grass and the rest by surface id; water cells swap in the water
 *    nodes);
 *  - L0 `buildings`: walls (façade), roofs and rooftop equipment in one material, branched on the surface id;
 *  - L0 `vegetation`: the shared tree, a little colour variation;
 *  - L1/L2 `terrain`, `roads`: the ground material with the cover mask (and the dithered fade); `massing` keeps M02b1's world-space
 *    night mask (`windowEmissive`) with the new palettes.
 *
 * Profiles: `full` (desktop tiers: noise detail, glass that reflects the environment, four waves), `lite` (mobile: lighter noise,
 * a Fresnel glass tint, two waves), `min` (mobile-low: the vertex colour with the class roughness by day and the window grid only as
 * the night emissive mask; no waves). `legacy` is the M02b1/M02b2 material set and is built by chunks/materials.ts.
 */
import { DoubleSide, FrontSide, MeshStandardNodeMaterial } from 'three/webgpu';
import { windowEmissive } from '../sky/night.ts';
import {
  attribute, clamp, float, fract, mix, normalLocal, normalView, normalWorld, normalize, positionLocal, positionWorld, select, smoothstep, vec2, vec3, vertexColor, asNode, loose, step, type L,
} from '../sky/tsl.ts';
import { COARSE_BACK, plus, roadBias, type DepthRules } from '../chunks/depth.ts';
import { MESHER } from '../chunks/mesher.ts';
import type { ObjectKind } from '../chunks/mesh-types.ts';
import { baseAttributes, coverMask, facadeNodes, fadeShown, surfNodes, type LookNodes } from './common.ts';
import { FACADE_KEYS, type LookFile } from './config.ts';
import { wallNodes } from './facade.ts';
import { groundNodes } from './ground.ts';
import { paintNodes } from './markings.ts';
import { around1, bumpNormal, pickFloat, vnoise } from './noise.ts';
import { roofNodes } from './roof.ts';
import { SURF_SCALE, Surf } from './surfaces.ts';
import { waterNodes } from './water.ts';
// art-hook:textures begin (M10d0): the one import of the surface textures
import { withSurfaceTextures } from '../textures/surface-textures.ts';
// art-hook:textures end

export type MaterialProfile = 'full' | 'lite' | 'min';

export interface LookMaterialSet {
  l0: Partial<Record<ObjectKind, MeshStandardNodeMaterial>>;
  coarse: Partial<Record<ObjectKind, MeshStandardNodeMaterial>>;
  dispose(): void;
}

export interface LookMaterialOptions {
  profile: MaterialProfile;
  look: LookFile;
  nodes: LookNodes;
  foundationM: number;
  parapetM: number;
  /** The polygon offsets (M02g2): the coarse levels sit behind L0, a road ribbon in front of the terrain under it. */
  depth: DepthRules;
}

const set = <K extends string>(m: MeshStandardNodeMaterial, k: K, v: unknown): void => void ((m as unknown as Record<string, unknown>)[k] = v);

export function createLookMaterials(o: LookMaterialOptions): LookMaterialSet {
  const { profile, look, nodes: n, depth } = o;
  const a = baseAttributes();
  const shown = fadeShown(n, a.aBirth);
  const covered = coverMask(a.aCover, a.aCell);
  const shade = a.aAO.mul(0.3).add(0.7);
  const detail = profile === 'full' ? 'full' : 'lite';
  const all: MeshStandardNodeMaterial[] = [];

  const make = (side: typeof FrontSide | typeof DoubleSide, coarse: boolean): MeshStandardNodeMaterial => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, side });
    m.alphaTest = 0.5;
    m.opacityNode = asNode(coarse ? select(covered.greaterThan(0.5), float(0), shown) : shown) as never;
    all.push(m);
    return m;
  };

  // ---- ground -------------------------------------------------------------------------------------------------------------
  // The terrain and the roads are the same node graph in two instances: a road ribbon lies 0.12 m over the terrain, which a coarse
  // depth buffer cannot tell apart at a distance, so the roads' instance has its own polygon offset (M02g2).
  const ground = (coarse: boolean, roads = false): MeshStandardNodeMaterial => {
    const m = make(coarse ? DoubleSide : FrontSide, coarse);
    const s = surfNodes();
    const vc = vertexColor(0);
    const g = groundNodes(look, n, s.id, vc, normalWorld.y, detail);
    // art-hook:textures begin (M10d0): the bound PBR sets over the procedural ground (L0 only; the coarse levels keep the look as it is)
    const plain = { color: profile === 'min' ? vc : g.color, roughness: g.roughness, normal: profile === 'min' ? null : normalView };
    const tx = coarse ? plain : withSurfaceTextures({ id: s.id, normal: normalWorld }, plain);
    // art-hook:textures end
    // M02h1: the street paint over the L0 roads' asphalt (the `markings` layer); the coarse levels have no `road` attribute
    const paint = roads && !coarse ? paintNodes({ look: look.markings, nodes: n, mode: profile === 'min' ? 'flat' : 'worn', id: s.id, color: tx.color, roughness: tx.roughness }) : null;
    const baseColor = paint ? paint.color : tx.color;
    const baseRough = paint ? paint.roughness : tx.roughness;
    // M02h2: the `curbs` layer off puts the sidewalk ribbons back on the road plane: each vertex's raise over the road (centimetres in the
    // `surf` code byte, chunks/sidewalks.ts) comes off its height (L0 roads only; the gutter turns back into road in groundNodes)
    if (roads && !coarse) {
      const raise = (attribute('surf', 'vec4') as L).z.mul(SURF_SCALE).round().mul(0.01);
      m.positionNode = asNode(positionLocal.sub(vec3(0, raise.mul(float(1).sub(n.uCurbs)), 0)));
    }
    if (profile === 'min') {
      // Vertex colour with the class roughness; the sea a flat colour.
      m.colorNode = asNode(baseColor.mul(shade));
      m.roughnessNode = asNode(baseRough) as never;
      return m;
    }
    const w = waterNodes(profile, look, n, g.deep, vc);
    m.colorNode = asNode(mix(baseColor, w.color, g.water).mul(shade));
    m.roughnessNode = asNode(mix(baseRough, w.roughness, g.water)) as never;
    m.metalnessNode = asNode(float(0)) as never;
    // M02h2: the bump of the ground detail (`full` and `lite`; `look.bump`), off with the `bump` layer; the coarse levels have none
    const strength = look.bump[profile] ?? 0;
    const surface = !coarse && strength > 0 ? bumpNormal(g.height, n.uBump.mul(strength), tx.normal ?? normalView) : (tx.normal ?? normalView);
    set(m, 'normalNode', normalize(mix(surface, w.normal, g.water)));
    return m;
  };

  // ---- buildings ----------------------------------------------------------------------------------------------------------
  const buildings = (): MeshStandardNodeMaterial => {
    const m = make(FrontSide, false);
    const s = surfNodes();
    const fac = facadeNodes();
    const vc = vertexColor(0);
    const isWall = step(Surf.WallBase - 0.5, s.id).mul(step(s.id, Surf.WallBase + 5.5));
    const wall = wallNodes({ profile, look, n, kind: s.kind, pal: s.pal, flags: s.flags, fac, foundationM: o.foundationM, parapetM: o.parapetM });
    let col: L;
    let rough: L;
    let metal: L = float(0);
    let emis: L;
    if (profile === 'min') {
      const classRough = pickFloat(s.kind, FACADE_KEYS.map((k) => look.facade[k].wallRoughness));
      col = vc.mul(shade);
      rough = mix(float(0.9), classRough, isWall);
      emis = wall.emissive.mul(isWall);
    } else {
      const roof = roofNodes(look, s.id, fac.seed, profile === 'full');
      col = mix(roof.color, wall.color, isWall);
      rough = mix(roof.roughness, wall.roughness, isWall);
      metal = mix(roof.metalness, wall.metalness, isWall);
      emis = wall.emissive.mul(isWall);
      // Rain darkens the surfaces; the roofs also gloss over where the tier has the form for it.
      const wetRoof = n.sky.uWet.mul(smoothstep(0.6, 0.9, normalWorld.y));
      col = col.mul(float(1).sub(n.sky.uWet.mul(0.1))).mul(float(1).sub(wetRoof.mul(0.25))).mul(shade);
      rough = mix(rough, float(0.2), wetRoof.mul(n.sky.uWetRough).mul(0.7));
    }
    m.colorNode = asNode(col);
    m.roughnessNode = asNode(rough) as never;
    m.metalnessNode = asNode(metal) as never;
    m.emissiveNode = asNode(emis);
    return m;
  };

  // ---- coarse massing (L1, L2) --------------------------------------------------------------------------------------------
  const massing = (): MeshStandardNodeMaterial => {
    const m = make(DoubleSide, true);
    const vc = vertexColor(0);
    const wallMask = float(1).sub(clamp(normalLocal.y.abs().mul(3), 0, 1));
    const windows = select(fract(positionWorld.y.mul(0.28)).greaterThan(0.45), float(1), float(0)).mul(
      select(fract(positionWorld.x.add(positionWorld.z).mul(0.3)).greaterThan(0.4), float(1), float(0)),
    );
    const tone = around1(vnoise(vec2(positionWorld.x, positionWorld.z).mul(0.08)), 0.08);
    m.colorNode = asNode(vc.mul(tone).mul(shade));
    m.roughnessNode = asNode(float(0.85)) as never;
    m.emissiveNode = asNode(windowEmissive(n.sky, loose(wallMask), loose(windows)));
    return m;
  };

  // ---- vegetation ---------------------------------------------------------------------------------------------------------
  const trees = (): MeshStandardNodeMaterial => {
    const m = make(FrontSide, false);
    const vc = vertexColor(0);
    const wp = vec2(positionWorld.x, positionWorld.z);
    const leafVar = around1(vnoise(wp.mul(1.7).add(positionWorld.y.mul(0.6))), 0.16);
    m.colorNode = asNode(vc.mul(leafVar).mul(shade));
    m.roughnessNode = asNode(float(0.88)) as never;
    return m;
  };

  const l0: LookMaterialSet['l0'] = {};
  l0.terrain = ground(false);
  l0.roads = depth.set(ground(false, true), roadBias(MESHER.depth.roadFactor, MESHER.depth.roadUnits));
  l0.buildings = buildings();
  l0.vegetation = trees();
  const coarse: LookMaterialSet['coarse'] = {};
  coarse.terrain = ground(true);
  coarse.roads = ground(true);
  coarse.massing = massing();
  // A coarse wall and a detailed L0 wall can stand in the same place (a building whose footprint crosses a cell that is not masked
  // yet, or a tile the L0 chunk of which is missing): the coarse surfaces are pushed back in depth so the detailed one always wins.
  for (const m of new Set(Object.values(coarse))) depth.set(m, COARSE_BACK);
  // The coarse roads keep their place in front of the coarse terrain.
  depth.set(coarse.roads, plus(COARSE_BACK, roadBias(MESHER.depth.roadFactor, MESHER.depth.roadUnits)));
  return {
    l0,
    coarse,
    dispose: () => {
      for (const m of new Set(all)) m.dispose();
    },
  };
}

export type { L };
