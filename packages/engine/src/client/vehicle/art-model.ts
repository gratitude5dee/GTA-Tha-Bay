/**
 * The decoded model of a vehicle or prop asset (M10d1): a tree of named nodes whose primitives carry positions, normals, colours and a
 * part id per vertex. The reader that makes it from a `.glb` lives with the world's asset jobs (`packages/world/src/client/vehicles`);
 * the engine draws it (`gltf-thing.ts`). Pure data and helpers: no `three`, no wasm.
 */
export interface ArtPrimitive {
  /** The glTF material name: `paint`, `glass`, `detail`, `lamp`, `all` or `collider`. */
  material: string;
  positions: Float32Array;
  normals: Float32Array;
  /** Linear RGB, 3 floats per vertex. */
  colors: Float32Array;
  /** The part id of each vertex (`packages/shared/src/assets/art-parts.ts`). */
  parts: Float32Array;
  indices: Uint16Array | Uint32Array;
}

export interface ArtNode {
  name: string;
  /** Metres, in the node's parent frame (turned to -Z forward by the reader). */
  translation: [number, number, number];
  primitives: ArtPrimitive[];
  children: ArtNode[];
}

export interface ArtModelData {
  /** `vehicle/traffic.sedan` and so on. */
  ref: string;
  fidelity: string;
  /** `fictionalMake`, `wheelRadiusM` and the like, from the scene extras. */
  extras: Record<string, unknown>;
  roots: ArtNode[];
  /** Triangles and vertices over every node but the collider. */
  triangles: number;
  vertices: number;
  /** minX, minY, minZ, maxX, maxY, maxZ of the rendered meshes (collider excluded) in the model's own frame. */
  bounds: [number, number, number, number, number, number];
}

/** The asset refs the engine draws from a model rather than from the gray-box kit (the targets of the M10d1 placeholder rows). */
export const ART_REFS: readonly string[] = [
  'vehicle/traffic.compact', 'vehicle/traffic.sedan', 'vehicle/traffic.rideshare', 'vehicle/traffic.van', 'vehicle/traffic.truck',
  'vehicle/traffic.pickup', 'vehicle/robotaxi.default', 'vehicle/police.cruiser', 'vehicle/police.suv', 'vehicle/transit.bus',
  'vehicle/transit.cablecar', 'prop/police.heli', 'prop/transit.ferry', 'prop/transit.airliner', 'prop/cone', 'prop/barrier',
  'prop/county-barrier', 'prop/spikestrip', 'prop/crate', 'prop/transit-entrance', 'prop/portal-closure', 'prop/pickup-cash',
  'prop/pickup-item', 'prop/marker.beam',
];

const ART_SET = new Set(ART_REFS);

/** True for the asset keys that have a final model. */
export const isArtKey = (key: string): boolean => ART_SET.has(key);

/** Every buffer of a model, for the transfer list of a worker reply. */
export function artTransferList(m: ArtModelData): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const visit = (n: ArtNode): void => {
    for (const p of n.primitives) for (const a of [p.positions, p.normals, p.colors, p.parts, p.indices]) if (a.buffer instanceof ArrayBuffer) out.add(a.buffer);
    n.children.forEach(visit);
  };
  m.roots.forEach(visit);
  return [...out];
}

/** Finds a node by name (depth first). */
export function findArtNode(m: ArtModelData, name: string): ArtNode | undefined {
  const visit = (n: ArtNode): ArtNode | undefined => {
    if (n.name === name) return n;
    for (const c of n.children) {
      const f = visit(c);
      if (f) return f;
    }
    return undefined;
  };
  for (const r of m.roots) {
    const f = visit(r);
    if (f) return f;
  }
  return undefined;
}

/** The node's world translation (the sum along its parents), or null when absent. */
export function artNodeWorld(m: ArtModelData, name: string): [number, number, number] | null {
  const visit = (n: ArtNode, base: [number, number, number]): [number, number, number] | null => {
    const w: [number, number, number] = [base[0] + n.translation[0], base[1] + n.translation[1], base[2] + n.translation[2]];
    if (n.name === name) return w;
    for (const c of n.children) {
      const f = visit(c, w);
      if (f) return f;
    }
    return null;
  };
  for (const r of m.roots) {
    const f = visit(r, [0, 0, 0]);
    if (f) return f;
  }
  return null;
}

/** Visits every node with its world translation. */
export function walkArt(m: ArtModelData, f: (n: ArtNode, world: [number, number, number]) => void): void {
  const visit = (n: ArtNode, base: [number, number, number]): void => {
    const w: [number, number, number] = [base[0] + n.translation[0], base[1] + n.translation[1], base[2] + n.translation[2]];
    f(n, w);
    n.children.forEach((c) => visit(c, w));
  };
  m.roots.forEach((r) => visit(r, [0, 0, 0]));
}
