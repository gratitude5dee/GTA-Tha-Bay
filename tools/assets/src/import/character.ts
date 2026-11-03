/**
 * Intake of a licensed character base (M10d4, `assets:import -- characters`): the checks a vetted CC0 human (Quaternius, DL-OWN-06) must
 * pass before its geometry enters the people kit. A base is read with `@gltf-transform/core`, its bones are mapped to the 22
 * `HUMANOID_BONES` through the alias table, the rest pose is snapped to `BONE_REST` (a bone further than 1 cm off is a finding, so a
 * wrong skeleton is not hidden by the snap), the weights are checked (at most four influences, sums within 0.01) and the body must be an
 * adult: stature 1.55 to 1.95 m and a head no taller than 1/6.5 of the stature. A child-proportioned base (a "teen" body) fails here.
 *
 * While no licensed base is in `content-incoming/` the people kit is built from the authored recipes (BD-M10d4-01); the checks run on
 * the recipes' own output in the unit tests, so a base that arrives later meets the same gate. Pure apart from the file reads.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Document, Node } from '@gltf-transform/core';
import { canonicalBone, type RigFamily } from '../../../../packages/shared/src/assets/gates/index.ts';
import { finding, type GateFinding } from '../../../../packages/shared/src/assets/gates/types.ts';
import { jointNodes, readGlb, weightStats } from '../glb-inspect.ts';
import { BONE_PARENT, BONE_REST, HUMANOID_BONES, type Bone } from '../recipes/rig.ts';

export const GATE = 'assets:import characters';
export const STATURE_MIN_M = 1.55;
export const STATURE_MAX_M = 1.95;
/** The head is at most this fraction of the stature (a head of one sixth and a half of the body is the adult limit). */
export const HEAD_FRACTION_MAX = 1 / 6.5;
export const REST_TOLERANCE_M = 0.01;

export function bayRig(root: string): RigFamily {
  const j = JSON.parse(readFileSync(path.join(root, 'packages/shared/src/rig/bay_rig_v1.json'), 'utf8')) as { family: string; required: string[]; aliases?: Record<string, string> };
  return { family: j.family, required: j.required, aliases: j.aliases ?? {} };
}

export interface BaseReport {
  /** Canonical bones found, in `HUMANOID_BONES` order. */
  bones: Bone[];
  unmapped: string[];
  /** Largest distance of a bone's local rest offset from `BONE_REST`, metres (bones in the file only). */
  restMaxErrM: number;
  maxInfluences: number;
  weightDeviation: number;
  statureM: number;
  headM: number;
  findings: GateFinding[];
}

function bounds(doc: Document): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const v = [0, 0, 0];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        for (let k = 0; k < 3; k++) {
          if ((v[k] as number) < (min[k] as number)) min[k] = v[k] as number;
          if ((v[k] as number) > (max[k] as number)) max[k] = v[k] as number;
        }
      }
    }
  }
  return { min, max };
}

/** Height of the vertices whose heaviest joint is the head bone. */
function headHeight(doc: Document, joints: Node[], headIdx: number): number {
  let lo = Infinity, hi = -Infinity;
  const p = [0, 0, 0];
  const j = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), ja = prim.getAttribute('JOINTS_0'), wa = prim.getAttribute('WEIGHTS_0');
      if (!pos || !ja || !wa) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        ja.getElement(i, j);
        wa.getElement(i, w);
        let best = 0;
        for (let k = 1; k < 4; k++) if ((w[k] as number) > (w[best] as number)) best = k;
        if (j[best] === headIdx && (w[best] as number) > 0.5) {
          pos.getElement(i, p);
          lo = Math.min(lo, p[1] as number);
          hi = Math.max(hi, p[1] as number);
        }
      }
    }
  }
  void joints;
  return hi > lo ? hi - lo : 0;
}

/** Inspects a base (or one of this kit's own parts) against the intake rules; `heightScale` is the root scale the stature takes. */
export async function inspectBase(file: string, bytes: Uint8Array, rig: RigFamily, heightScale = 1): Promise<BaseReport> {
  const doc = await readGlb(bytes);
  const findings: GateFinding[] = [];
  const bad = (rule: string, detail: string): void => {
    findings.push(finding(GATE, file, rule, detail));
  };
  const joints = jointNodes(doc);
  const byBone = new Map<Bone, Node>();
  const unmapped: string[] = [];
  for (const n of joints) {
    const c = canonicalBone(rig, n.getName());
    if (c === null) unmapped.push(n.getName());
    else byBone.set(c as Bone, n);
  }
  const missing = HUMANOID_BONES.filter((b) => !byBone.has(b));
  if (missing.length > 0) bad('bone-unmapped', `no bone maps to ${missing.join(', ')} through the ${rig.family} alias table`);
  let restMax = 0;
  for (const [b, n] of byBone) {
    const t = n.getTranslation();
    const r = BONE_REST[b];
    const e = Math.hypot(t[0] - r[0], t[1] - r[1], t[2] - r[2]);
    if (BONE_PARENT[b] === 'hips' || b !== 'hips') restMax = Math.max(restMax, e);
  }
  if (restMax > REST_TOLERANCE_M) bad('rest-pose', `a bone's rest offset is ${(restMax * 100).toFixed(1)} cm from BONE_REST (limit ${REST_TOLERANCE_M * 100} cm)`);
  const ws = weightStats(doc);
  if (ws.maxInfluences > 4) bad('influences', `${ws.maxInfluences} influences on a vertex (limit 4)`);
  if (ws.maxSumDeviation > 0.01) bad('weights', `vertex weights deviate from 1 by ${ws.maxSumDeviation} (limit 0.01)`);
  const b = bounds(doc);
  const statureM = (b.max[1] - b.min[1]) * heightScale;
  const headIdx = joints.findIndex((n) => canonicalBone(rig, n.getName()) === 'head');
  const headM = headIdx < 0 ? 0 : headHeight(doc, joints, headIdx) * heightScale;
  if (statureM < STATURE_MIN_M || statureM > STATURE_MAX_M) bad('adult-stature', `stature ${statureM.toFixed(2)} m is outside ${STATURE_MIN_M} to ${STATURE_MAX_M} m`);
  if (headM > statureM * HEAD_FRACTION_MAX) bad('adult-head', `the head is ${(statureM / Math.max(headM, 1e-6)).toFixed(2)} heads tall (a head above 1/6.5 of the stature reads as a child)`);
  return { bones: HUMANOID_BONES.filter((x) => byBone.has(x)), unmapped, restMaxErrM: restMax, maxInfluences: ws.maxInfluences, weightDeviation: ws.maxSumDeviation, statureM, headM, findings };
}

/** Renames the bones to the canonical names and snaps their local offsets to `BONE_REST`; returns how many bones changed. */
export function snapRestPose(doc: Document, rig: RigFamily): number {
  let n = 0;
  for (const node of jointNodes(doc)) {
    const c = canonicalBone(rig, node.getName());
    if (c === null) continue;
    if (node.getName() !== c) {
      node.setName(c);
      n++;
    }
    const r = BONE_REST[c as Bone];
    const t = node.getTranslation();
    if (Math.hypot(t[0] - r[0], t[1] - r[1], t[2] - r[2]) > 1e-6) {
      node.setTranslation([r[0], r[1], r[2]]);
      n++;
    }
  }
  return n;
}

/** The licensed bases waiting in `content-incoming/<pack>/` (git-ignored); empty when there are none. */
export function incomingBases(root: string): string[] {
  const dir = path.join(root, 'content-incoming');
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const pack of readdirSync(dir)) {
    const sub = path.join(dir, pack);
    for (const name of existsSync(sub) && readdirSync(sub, { withFileTypes: true }).some(() => true) ? readdirSync(sub) : []) {
      if (/\.(glb|gltf)$/i.test(name)) out.push(path.posix.join('content-incoming', pack, name));
    }
  }
  return out.sort();
}
