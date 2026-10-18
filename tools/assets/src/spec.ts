/**
 * Asset specs (tool-internal, not a contract): one `assets/src/<kind>/<id>/asset.json` per asset.
 * The loader hashes every variant file with node:crypto and reports problems as findings instead of throwing.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { AssetId, AssetKind, AssetRef, KindExtras, LikenessSummary, VariantId } from '../../../packages/shared/src/assets/c07.ts';
import { finding, type GateFinding } from '../../../packages/shared/src/assets/gates/types.ts';

export const GATE = 'check:assets';

export const ASSET_KINDS: readonly AssetKind[] = [
  'character', 'character_sheet', 'rig', 'anim', 'portrait', 'mouth_atlas', 'vehicle', 'prop', 'building', 'terrain',
  'texture', 'ui', 'font', 'audio_music', 'audio_sfx', 'audio_bark', 'voice', 'cutscene', 'map_data', 'world_pack', 'data',
];
export const VARIANT_IDS: readonly VariantId[] = ['default', 'desktop-ultra', 'desktop', 'mobile', 'mobile-low', 'xr-quest', 'xr-visionpro'];
export const ASSET_ID_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/;

export interface AssetSpec {
  kind: AssetKind;
  id: AssetId;
  variants: Partial<Record<VariantId, string>>; // repo-relative path
  deps: AssetRef[];
  tags: string[];
  extras?: KindExtras;
  likeness?: LikenessSummary;
  status: 'active' | 'quarantined' | 'killed';
  visibility: 'public' | 'private';
}

export interface VariantFile {
  variant: VariantId;
  path: string; // repo-relative POSIX
  abs: string;
  sha256: string;
  bytes: number;
  ext: string;
}

export interface LoadedSpec {
  ref: AssetRef;
  specPath: string; // repo-relative path of asset.json
  spec: AssetSpec;
  files: VariantFile[]; // sorted by variant id
}

export function sha256File(abs: string): string {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function dirs(abs: string): string[] {
  return existsSync(abs) ? readdirSync(abs).filter((n) => statSync(path.join(abs, n)).isDirectory()).sort() : [];
}

export function loadSpecs(root: string): { specs: LoadedSpec[]; findings: GateFinding[] } {
  const findings: GateFinding[] = [];
  const specs: LoadedSpec[] = [];
  const base = path.join(root, 'assets', 'src');
  for (const kind of dirs(base)) {
    for (const id of dirs(path.join(base, kind))) {
      const specPath = `assets/src/${kind}/${id}/asset.json`;
      const abs = path.join(root, specPath);
      if (!existsSync(abs)) continue;
      const bad = (rule: string, detail: string): void => {
        findings.push(finding(GATE, specPath, rule, detail));
      };
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(abs, 'utf8'));
      } catch (e) {
        bad('spec-invalid', (e as Error).message);
        continue;
      }
      const o = raw as Record<string, unknown>;
      if (typeof o !== 'object' || o === null) {
        bad('spec-invalid', 'not an object');
        continue;
      }
      if (o.kind !== kind || !ASSET_KINDS.includes(o.kind as AssetKind)) bad('spec-invalid', `kind must be ${kind}`);
      if (o.id !== id || !ASSET_ID_RE.test(id)) bad('spec-invalid', `id must be ${id} and match ${ASSET_ID_RE}`);
      const variants = o.variants as Record<string, unknown> | undefined;
      if (!variants || typeof variants !== 'object' || Object.keys(variants).length === 0) {
        bad('spec-invalid', 'variants must be a non-empty object');
        continue;
      }
      if (o.status !== 'active' && o.status !== 'quarantined' && o.status !== 'killed') bad('spec-invalid', 'status');
      if (o.visibility !== 'public' && o.visibility !== 'private') bad('spec-invalid', 'visibility');
      if (!Array.isArray(o.deps) || !Array.isArray(o.tags)) bad('spec-invalid', 'deps and tags must be arrays');
      const files: VariantFile[] = [];
      for (const v of Object.keys(variants).sort()) {
        const rel = variants[v];
        if (!VARIANT_IDS.includes(v as VariantId)) {
          bad('spec-invalid', `unknown variant id ${v}`);
          continue;
        }
        if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split('/').includes('..')) {
          bad('spec-invalid', `variant ${v}: path must be repo-relative`);
          continue;
        }
        const fabs = path.join(root, rel);
        if (!existsSync(fabs) || !statSync(fabs).isFile()) {
          bad('variant-file-missing', `${v}: ${rel} does not exist`);
          continue;
        }
        const ext = path.extname(rel).replace(/^\./, '').toLowerCase();
        files.push({ variant: v as VariantId, path: rel, abs: fabs, sha256: sha256File(fabs), bytes: statSync(fabs).size, ext });
      }
      specs.push({ ref: `${kind}/${id}` as AssetRef, specPath, spec: raw as AssetSpec, files });
    }
  }
  return { specs, findings };
}
