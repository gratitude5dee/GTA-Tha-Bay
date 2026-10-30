/**
 * Remodelling of a licensed vehicle base (M10d1): a vetted CC0 or CC-BY car, bus or prop enters as a model document, leaves with
 * realistic proportions and without the faces that name a real make, and carries a `changes` list that the intake record, the
 * provenance record and the credits line quote (CC-BY needs it, DL-OWN-06). The operations are the ones the milestone names: scales,
 * roof and hood offsets, dropped badge, grille, logo and plate nodes. Pure and deterministic; `V-SIL` (the silhouette check against
 * the denylisted makes) stays the reviewer's answer in the intake record, `vet.ts` rejects an unanswered one.
 *
 * No licensed base is imported by this milestone's recipes (the packs are snapshot-only or not downloaded offline); this module is
 * what a base would pass through, and the recipes stand at the same AssetIds until one does.
 */
import { type Mesh, type V3 } from '../recipes/mesh.ts';
import { modelBounds, type ModelDoc, type ModelNode } from '../recipes/model.ts';

export interface RemodelSpec {
  /** Overall [width, height, length] metres the base is scaled to (each axis on its own). */
  size?: readonly [number, number, number];
  /** Heights above `roofFromY` move by this many metres (raise or lower the roof; the hood keeps its line). */
  roofOffsetM?: number;
  roofFromY?: number;
  /** The nose, beyond `hoodFromZ` toward +Z (the model's front), drops or rises by this many metres above `hoodAboveY`. */
  hoodOffsetM?: number;
  hoodFromZ?: number;
  hoodAboveY?: number;
  /** Nodes whose name matches are dropped (default: badges, grilles, logos, emblems, plates). */
  dropNodes?: RegExp;
}

export const DEFAULT_DROP = /badge|grille|grill|logo|emblem|plate|brand|decal|text/i;

export interface RemodelResult {
  doc: ModelDoc;
  /** One line per operation, for `changes:` of the intake record and the attribution. */
  changes: string[];
}

const fmt = (n: number): string => n.toFixed(2);

function mapMeshes(n: ModelNode, f: (m: Mesh, world: V3) => Mesh, base: V3): ModelNode {
  const t = n.translation ?? [0, 0, 0];
  const w: V3 = [base[0] + t[0], base[1] + t[1], base[2] + t[2]];
  const out: ModelNode = { name: n.name };
  if (n.translation) out.translation = n.translation;
  if (n.meshes) out.meshes = n.meshes.map((m) => f(m, w));
  if (n.children) out.children = n.children.map((c) => mapMeshes(c, f, w));
  return out;
}

function dropNodes(n: ModelNode, re: RegExp, dropped: string[]): ModelNode | null {
  if (re.test(n.name)) {
    dropped.push(n.name);
    return null;
  }
  const out: ModelNode = { name: n.name };
  if (n.translation) out.translation = n.translation;
  if (n.meshes) out.meshes = n.meshes;
  if (n.children) out.children = n.children.map((c) => dropNodes(c, re, dropped)).filter((c): c is ModelNode => c !== null);
  return out;
}

function scaleNode(n: ModelNode, s: V3): ModelNode {
  const out: ModelNode = { name: n.name };
  if (n.translation) out.translation = [n.translation[0] * s[0], n.translation[1] * s[1], n.translation[2] * s[2]];
  if (n.meshes) out.meshes = n.meshes.map((m) => m.scaled(s[0], s[1], s[2]));
  if (n.children) out.children = n.children.map((c) => scaleNode(c, s));
  return out;
}

/** Applies the spec to a model; the input is untouched. */
export function remodelVehicle(doc: ModelDoc, spec: RemodelSpec): RemodelResult {
  const changes: string[] = [];
  let roots = doc.roots;
  const dropped: string[] = [];
  const re = spec.dropNodes ?? DEFAULT_DROP;
  roots = roots.map((r) => dropNodes(r, re, dropped)).filter((r): r is ModelNode => r !== null);
  if (dropped.length > 0) changes.push(`removed ${dropped.length} node${dropped.length === 1 ? '' : 's'} that name a make or carry text: ${dropped.sort().join(', ')}`);
  let cur: ModelDoc = { ...doc, roots };
  if (spec.size) {
    const b = modelBounds(cur);
    const have: V3 = [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
    const s: V3 = [spec.size[0] / (have[0] || 1), spec.size[1] / (have[1] || 1), spec.size[2] / (have[2] || 1)];
    cur = { ...cur, roots: cur.roots.map((r) => scaleNode(r, s)) };
    changes.push(`scaled to ${fmt(spec.size[0])} x ${fmt(spec.size[1])} x ${fmt(spec.size[2])} m (width x height x length)`);
  }
  if (spec.roofOffsetM) {
    const from = spec.roofFromY ?? 0.9;
    const d = spec.roofOffsetM;
    cur = {
      ...cur,
      roots: cur.roots.map((r) => mapMeshes(r, (m, w) => {
        const out = m.moved([0, 0, 0]);
        for (let i = 1; i < out.pos.length; i += 3) if ((out.pos[i] as number) + w[1] > from) out.pos[i] = (out.pos[i] as number) + d;
        return out;
      }, [0, 0, 0])),
    };
    changes.push(`${d > 0 ? 'raised' : 'lowered'} the roof by ${fmt(Math.abs(d))} m above ${fmt(from)} m`);
  }
  if (spec.hoodOffsetM) {
    const z0 = spec.hoodFromZ ?? 1;
    const above = spec.hoodAboveY ?? 0.5;
    const d = spec.hoodOffsetM;
    cur = {
      ...cur,
      roots: cur.roots.map((r) => mapMeshes(r, (m, w) => {
        const out = m.moved([0, 0, 0]);
        for (let i = 0; i < out.pos.length; i += 3) {
          if ((out.pos[i + 2] as number) + w[2] > z0 && (out.pos[i + 1] as number) + w[1] > above && (out.pos[i + 1] as number) + w[1] < (spec.roofFromY ?? 0.9) + 0.4) out.pos[i + 1] = (out.pos[i + 1] as number) + d;
        }
        return out;
      }, [0, 0, 0])),
    };
    changes.push(`${d > 0 ? 'raised' : 'lowered'} the nose line by ${fmt(Math.abs(d))} m`);
  }
  return { doc: cur, changes };
}

/** The `changes:` text of a CC-BY attribution line: the operations, joined with semicolons; empty without any. */
export const changesText = (changes: readonly string[]): string => changes.join('; ');
