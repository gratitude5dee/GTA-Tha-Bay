/**
 * The files `assets:retarget --spec` writes beside a baked `anim/<slug>.moves` (M10a2): the A5 report `retarget.json`, the asset spec
 * `asset.json` and the provenance record (origin `derived` from the authored mannequin clip file, which must have its own record). Nothing here
 * calls a vendor; the clip file is first-party work of the art lead (Q-24) or the library set.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LikenessTier } from '../../../packages/shared/src/assets/c07.ts';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { canonicalize } from '../../../packages/shared/src/json.ts';
import { sha256Hex } from '../../../packages/shared/src/hash.ts';
import { sha256Hex as sha256Bytes } from '../../ci/lib/common.ts';
import type { Retarget5 } from './moves-check.ts';
import type { RetargetResult } from './retarget.ts';

export const RETARGET_TOOL = { name: 'assets:retarget', version: '1.0.0' } as const;

export function retargetReport(slug: string, rig: string, fps: number, r: RetargetResult): Retarget5 {
  return {
    schema: 'retarget-report/1', slug, rig, fps, a5: r.findings.length === 0 ? 'pass' : 'fail',
    clips: r.clips.map((c) => ({ name: c.name, frames: c.frames, hipDriftM: Math.round(c.stats.hipDriftM * 1e5) / 1e5, endPoseDistM: Math.round(c.stats.endPoseDistM * 1e5) / 1e5, status: c.findings.length === 0 ? 'pass' : 'fail' })),
  };
}

/** Recursively key-sorted JSON with a trailing newline, the layout of the committed specs and records. */
export function sortedJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x !== null && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v2]) => [k, sort(v2)]));
    return x;
  };
  return `${JSON.stringify(sort(v), null, 2)}\n`;
}

export interface MovesAssetInput {
  root: string;
  slug: string;
  /** Repo-relative path of the baked file (`assets/src/anim/<slug>.moves/default.glb`). */
  outRel: string;
  glb: Uint8Array;
  /** The authored mannequin clip file the clips came from. */
  clipsBytes: Uint8Array;
  report: Retarget5;
  by: string;
  at: string;
}

export type MovesAssetResult = { ok: true; files: string[] } | { ok: false; detail: string };

/** Writes `retarget.json`, `asset.json` and the provenance record. Refuses when the source clip file has no provenance record. */
export function writeMovesAsset(i: MovesAssetInput): MovesAssetResult {
  const dir = path.posix.dirname(i.outRel);
  const id = `${i.slug}.moves`;
  if (path.posix.basename(dir) !== id) return { ok: false, detail: `--spec needs the output to sit in assets/src/anim/${id}/ (got ${i.outRel})` };
  const srcSha = sha256Bytes(i.clipsBytes);
  const srcRecord = path.join(i.root, 'assets/provenance', srcSha.slice(0, 2), `${srcSha}.json`);
  if (!existsSync(srcRecord)) return { ok: false, detail: `the clip file (sha256 ${srcSha.slice(0, 12)}) has no provenance record: run provenance:new for it (origin authored) before --spec` };
  const charSpecFile = path.join(i.root, 'assets/src/character', i.slug, 'asset.json');
  if (!existsSync(charSpecFile)) return { ok: false, detail: `assets/src/character/${i.slug}/asset.json does not exist: the moves take the likeness block and the tags of the published character` };
  const charSpec = JSON.parse(readFileSync(charSpecFile, 'utf8')) as { likeness: { tier: LikenessTier; subjectId: string | null; photoreal: boolean }; tags?: string[] };
  const lk = charSpec.likeness;
  const sha = sha256Bytes(i.glb);
  const record: ProvenanceRecord = {
    schema: 'provenance/1.0', sha256: sha, paths: [i.outRel], kind: 'anim', origin: 'derived', license: 'LicenseRef-DeeVerse-Owned', authors: [`profile:${i.by}`],
    derived_from: [srcSha], tool: { ...RETARGET_TOOL, args_sha256: sha256Hex(canonicalize({ slug: i.slug, rig: i.report.rig, fps: i.report.fps } as never)) },
    likeness: { subject_id: lk.subjectId, tier: lk.tier, face_reference_used: false, voice_mode: 'none', photoreal: lk.photoreal },
    review: [], ip_checks: { signatures: 'n/a', strings: 'n/a', similarity: 'n/a' }, ai_generated: false, status: 'active', created_at: i.at,
  };
  const spec = {
    kind: 'anim', id, variants: { default: i.outRel }, deps: [], tags: ['fighter', ...(charSpec.tags ?? []).filter((t) => t.startsWith('char:'))],
    likeness: charSpec.likeness, status: 'active', visibility: 'public',
  };
  const out: Record<string, string> = {
    [`${dir}/retarget.json`]: sortedJson(i.report),
    [`${dir}/asset.json`]: sortedJson(spec),
    [`assets/provenance/${sha.slice(0, 2)}/${sha}.json`]: sortedJson(record),
  };
  for (const [rel, text] of Object.entries(out)) {
    mkdirSync(path.dirname(path.join(i.root, rel)), { recursive: true });
    writeFileSync(path.join(i.root, rel), text);
  }
  return { ok: true, files: Object.keys(out) };
}
