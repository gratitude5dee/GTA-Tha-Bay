/**
 * Level of detail for the vehicle and prop models (M10d1): `meshoptimizer@1.3.0` simplification of the large primitives of a model so
 * that the `mid` and `lo` variants fit their budget row, and the material grouping per fidelity (`hi`: paint, glass, detail, lamp;
 * `mid`: lamps join the detail primitive; `lo`: one primitive per node). The simplifier keeps original vertices, so every attribute
 * (normal, colour, part id) survives untouched. Deterministic: the same mesh and the same target give the same indices.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import { Mesh, MeshSet } from './recipes/mesh.ts';
import type { Fidelity, ModelDoc, ModelNode } from './recipes/model.ts';

/** Primitives with at most this many triangles are never simplified. */
export const KEEP_TRIANGLES = 120;

let ready: Promise<void> | null = null;
export const simplifierReady = (): Promise<void> => (ready ??= MeshoptSimplifier.ready);

/**
 * Simplifies one primitive to about `targetTriangles`, with the border locked (the primitives of one body meet along their borders) and
 * the normals and colours as weighted attributes. Returns a new compacted `Mesh`; the input is untouched.
 */
export function simplifyMesh(m: Mesh, targetTriangles: number, maxError = 0.15): Mesh {
  if (m.triangleCount <= Math.max(KEEP_TRIANGLES, targetTriangles)) return m;
  const n = m.vertexCount;
  const positions = Float32Array.from(m.pos);
  const attrs = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      attrs[i * 6 + k] = m.nor[i * 3 + k] as number;
      attrs[i * 6 + 3 + k] = m.col[i * 3 + k] as number;
    }
  }
  const [out] = MeshoptSimplifier.simplifyWithAttributes(
    Uint32Array.from(m.idx), positions, 3, attrs, 6, [0.4, 0.4, 0.4, 0.8, 0.8, 0.8], null,
    Math.max(3, Math.floor(targetTriangles) * 3), maxError, ['LockBorder'],
  );
  // compact: keep the vertices in first-use order
  const remap = new Map<number, number>();
  const res = new Mesh(m.material);
  const order: number[] = [];
  for (const i of out) {
    if (!remap.has(i)) {
      remap.set(i, order.length);
      order.push(i);
    }
  }
  for (const i of order) {
    res.vertex(
      [m.pos[i * 3] as number, m.pos[i * 3 + 1] as number, m.pos[i * 3 + 2] as number],
      [m.nor[i * 3] as number, m.nor[i * 3 + 1] as number, m.nor[i * 3 + 2] as number],
      [m.col[i * 3] as number, m.col[i * 3 + 1] as number, m.col[i * 3 + 2] as number],
      m.part[i] as number,
    );
  }
  for (const i of out) res.idx.push(remap.get(i) as number);
  return res;
}

export const trianglesOf = (set: MeshSet): number => set.list().reduce((a, m) => a + m.triangleCount, 0);

/** The primitives of a set simplified so that the whole comes to about `targetTriangles` (small ones are kept as they are). */
export function simplifySet(set: MeshSet, targetTriangles: number, maxError = 0.15): MeshSet {
  const out = new MeshSet();
  const all = set.list();
  const total = all.reduce((a, m) => a + m.triangleCount, 0);
  const keep = all.filter((m) => m.triangleCount <= KEEP_TRIANGLES).reduce((a, m) => a + m.triangleCount, 0);
  const big = total - keep;
  const budget = Math.max(0, targetTriangles - keep);
  for (const m of all) {
    if (m.triangleCount <= KEEP_TRIANGLES || big === 0) out.get(m.material).append(m);
    else out.get(m.material).append(simplifyMesh(m, Math.max(KEEP_TRIANGLES, (m.triangleCount / big) * budget), maxError));
  }
  return out;
}

/** The budget profile of a model: road vehicles keep paint, glass, detail and lamps; street props only detail and lamps; backdrop pieces paint and glass. */
export type MaterialProfile = 'vehicle' | 'street' | 'backdrop';

/** The material (primitive) name a primitive takes at a fidelity: the budget rows count 4/3/1, 2/1/1 and 2/2/1 materials. */
export function materialAt(material: string, f: Fidelity, profile: MaterialProfile = 'vehicle'): string {
  if (material === 'collider') return material;
  if (f === 'lo') return 'all';
  if (profile === 'backdrop') return material === 'glass' ? 'glass' : 'paint';
  if (profile === 'street') return f === 'hi' ? (material === 'lamp' ? 'lamp' : 'detail') : 'detail';
  if (f === 'mid' && material === 'lamp') return 'detail';
  return material;
}

/**
 * The body of a model at a fidelity: `hi` as built; `mid` simplified per primitive; `lo` merged into one primitive first (the `lo` variant
 * has a single material, so the seams between paint, glass and detail are not borders any more) and then simplified.
 */
export function bodyAt(set: MeshSet, f: Fidelity, targets: Readonly<Record<'mid' | 'lo', number>>): MeshSet {
  if (f === 'hi') return set;
  if (f === 'mid') return simplifySet(set, targets.mid);
  const merged = new MeshSet();
  for (const m of set.list()) merged.get('paint').append(m);
  return simplifySet(merged, targets.lo);
}

/** Regroups every node's primitives by the material names of the fidelity (primitives that now share a name are merged). */
export function regroup(doc: ModelDoc, f: Fidelity, profile: MaterialProfile = 'vehicle'): ModelDoc {
  const visit = (n: ModelNode): ModelNode => {
    const out: ModelNode = { name: n.name };
    if (n.translation) out.translation = n.translation;
    if (n.meshes && n.meshes.length > 0) {
      const set = new MeshSet();
      for (const m of n.meshes) {
        const name = materialAt(m.material, f, profile);
        set.get(name).append(m);
      }
      out.meshes = set.list();
    }
    if (n.children) out.children = n.children.map(visit);
    return out;
  };
  return { ...doc, fidelity: f, roots: doc.roots.map(visit) };
}
