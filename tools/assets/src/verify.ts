/**
 * Asset gate rules (spec/domains/05-assets.md section 4.2, 05-assets-pipeline.md section 9) against the specs, the
 * lock file and the provenance records. Offline; shared by `assets:verify`, `assets:publish` and `check:assets`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { AssetError, resolveVariant, type AssetManifest, type AssetVariant, type VariantId } from '../../../packages/shared/src/assets/c07.ts';
import { TIER_FIDELITY } from '../../../packages/shared/src/assets/fidelity.ts';
import { finding, type GateFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import type { QualityTierId } from '../../../packages/shared/src/platform/c13.ts';
import { readJson, toolsRoot } from '../../ci/lib/common.ts';
import { buildCatalogFrom, lockGitStamp, type CatalogBuild, type GitStamp } from './catalog.ts';
import { LOCK_PATH, isReleased, readLock, recordMap, sameHashes, variantHashes, type AssetLock } from './lock.ts';
import { GATE, loadSpecs, type LoadedSpec } from './spec.ts';

const MIB = 1024 * 1024;
export const SHIP_LIMIT = 25 * MIB;
export const PACK_LIMIT = 4 * MIB;
export const TIERS: readonly QualityTierId[] = ['desktop-ultra', 'desktop', 'mobile', 'mobile-low', 'xr-quest', 'xr-visionpro'];
const TIERED_KINDS = new Set(['character', 'vehicle', 'prop', 'texture', 'building']);

export const POINTER_WEB = 'apps/web/public/asset-catalog.json';
export const POINTER_EDGE = 'services/edge/src/generated/asset-catalog.json';

export interface VerifyOptions {
  /** Previous lock for the rev-regression rule. Default: the lock at git HEAD, when `root` is a git work tree. */
  baseline?: AssetLock | null | undefined;
  stamp?: GitStamp | undefined;
}

export function headLock(root: string): AssetLock | null {
  if (!existsSync(path.join(root, '.git'))) return null;
  const res = spawnSync('git', ['show', `HEAD:${LOCK_PATH}`], { cwd: root, encoding: 'utf8' });
  if (res.status !== 0) return null;
  try {
    return JSON.parse(res.stdout) as AssetLock;
  } catch {
    return null;
  }
}

function findCycle(specs: readonly LoadedSpec[]): string[] | null {
  const deps = new Map(specs.map((s) => [s.ref as string, s.spec.deps as string[]]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (r: string): string[] | null => {
    if (state.get(r) === 2) return null;
    if (state.get(r) === 1) return [...stack.slice(stack.indexOf(r)), r];
    state.set(r, 1);
    stack.push(r);
    for (const d of deps.get(r) ?? []) {
      const c = deps.has(d) ? visit(d) : null;
      if (c) return c;
    }
    stack.pop();
    state.set(r, 2);
    return null;
  };
  for (const r of deps.keys()) {
    const c = visit(r);
    if (c) return c;
  }
  return null;
}

interface BudgetRow { id: string; kind: string; tag?: string; fidelity: Record<'hi' | 'mid' | 'lo', { fileBytes: number }> }

function budgetFindings(root: string, specs: readonly LoadedSpec[]): GateFinding[] {
  const out: GateFinding[] = [];
  const file = 'config/asset-budgets.json';
  const abs = path.join(root, file);
  if (!existsSync(abs)) return [finding(GATE, file, 'config-missing', 'file does not exist')];
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(readJson(path.join(toolsRoot, 'tools/ci/schemas/asset-budgets.v1.json')));
  const cfg = readJson<{ rows: BudgetRow[] }>(abs);
  if (!validate(cfg)) {
    for (const e of validate.errors ?? []) out.push(finding(GATE, file, 'schema', `${e.instancePath || '/'} ${e.message ?? 'invalid'}`));
    return out;
  }
  for (const s of specs) {
    for (const row of cfg.rows) {
      if (row.kind !== s.spec.kind || (row.tag && !s.spec.tags.includes(row.tag))) continue;
      for (const f of s.files) {
        if (f.variant === 'default') continue;
        const limit = row.fidelity[TIER_FIDELITY[f.variant]].fileBytes;
        if (f.bytes > limit) out.push(finding(GATE, f.path, 'budget-file-bytes', `${s.ref} ${f.variant}: ${f.bytes} bytes exceeds the ${row.id} budget of ${limit}`));
      }
    }
  }
  return out;
}

export function pointerFindings(root: string): GateFinding[] {
  const web = path.join(root, POINTER_WEB);
  const edge = path.join(root, POINTER_EDGE);
  if (!existsSync(web) || !existsSync(edge)) {
    return [finding(GATE, existsSync(web) ? POINTER_EDGE : POINTER_WEB, 'pointer-missing', 'run pnpm assets:publish -- --pointer-out to write both pointer copies')];
  }
  const a = readFileSync(web);
  const b = readFileSync(edge);
  if (!a.equals(b)) return [finding(GATE, POINTER_EDGE, 'pointer-copies-differ', `${POINTER_WEB} and ${POINTER_EDGE} must be identical`)];
  try {
    const p = JSON.parse(a.toString('utf8')) as Record<string, unknown>;
    const ok = p.schema === 'asset-catalog-pointer/1' && typeof p.sha256 === 'string' && /^[0-9a-f]{64}$/.test(p.sha256) &&
      typeof p.key === 'string' && p.key === `manifests/assets-${p.sha256}.json` && Number.isInteger(p.bytes);
    if (!ok) return [finding(GATE, POINTER_WEB, 'pointer-invalid', 'not an asset-catalog-pointer/1 document')];
  } catch (e) {
    return [finding(GATE, POINTER_WEB, 'pointer-invalid', (e as Error).message)];
  }
  return [];
}

export interface AssetGateResult { findings: GateFinding[]; specs: LoadedSpec[]; lock: AssetLock | null; scanned: number }

export function assetGateFindings(root: string, opts: VerifyOptions = {}): AssetGateResult {
  const { specs, findings } = loadSpecs(root);
  const lock = readLock(root);
  const bySha = recordMap(root);
  const add = (file: string, rule: string, detail: string): void => {
    findings.push(finding(GATE, file, rule, detail));
  };

  if (!lock) add(LOCK_PATH, 'lock-missing', 'assets/assets.lock.json does not exist; run pnpm assets:lock -- --approved-by <handle>');
  const baseline = opts.baseline !== undefined ? opts.baseline : headLock(root);
  const byRef = new Map(specs.map((s) => [s.ref as string, s]));

  for (const s of specs) {
    const entry = lock?.entries[s.ref];
    if (isReleased(s)) {
      if (lock && !entry) add(s.specPath, 'not-in-lock', `${s.ref} is active and public but has no entry in ${LOCK_PATH}`);
      if (entry && !sameHashes(entry.variants, variantHashes(s))) {
        const changed = s.files.filter((f) => entry.variants[f.variant] !== f.sha256).map((f) => f.variant);
        add(s.specPath, 'spec-hash-mismatch', `spec hash ≠ lock for ${s.ref}${changed.length ? ` (${changed.join(', ')})` : ''}; review and run pnpm assets:lock`);
      }
    } else if (entry) {
      add(s.specPath, 'non-public-in-lock', `${s.ref} is ${s.spec.status}/${s.spec.visibility} and must not be in the lock or the public catalog`);
    }

    for (const f of s.files) {
      const rec = bySha.get(f.sha256);
      if (!rec) add(f.path, 'no-record', `no provenance record for sha256 ${f.sha256}`);
      else if (rec.status !== 'active') add(f.path, 'record-not-active', `record ${f.sha256.slice(0, 12)} is ${rec.status}`);
      if (f.bytes > SHIP_LIMIT) add(f.path, 'file-too-large', `${f.bytes} bytes exceeds 25 MiB`);
      if (s.spec.kind === 'world_pack' && f.bytes > PACK_LIMIT) add(f.path, 'pack-too-large', `${f.bytes} bytes exceeds 4 MiB (world_pack)`);
    }

    if (isReleased(s)) {
      const stub: Partial<Record<VariantId, AssetVariant>> = {};
      for (const f of s.files) stub[f.variant] = { key: f.path, sha256: f.sha256, bytes: f.bytes, contentType: '', encoding: 'identity' };
      const manifest = { id: s.spec.id, kind: s.spec.kind, variants: stub } as unknown as AssetManifest;
      for (const tier of TIERS) {
        try {
          resolveVariant(manifest, tier);
        } catch (e) {
          if (e instanceof AssetError) add(s.specPath, 'tier-unresolved', `${s.ref}: no variant resolves for tier ${tier}`);
          else throw e;
        }
      }
      if (TIERED_KINDS.has(s.spec.kind) && !stub.default && !(stub.desktop && stub.mobile && stub['mobile-low'])) {
        add(s.specPath, 'missing-fidelity', `${s.ref}: tiered kind needs desktop, mobile and mobile-low, or a default`);
      }
    }

    for (const d of s.spec.deps) {
      const dep = byRef.get(d);
      if (!dep) add(s.specPath, 'dep-missing', `${s.ref} depends on ${d}, which does not exist`);
      else if (dep.spec.status !== 'active') add(s.specPath, 'dep-inactive', `${s.ref} depends on ${d}, which is ${dep.spec.status}`);
    }
  }

  const cycle = findCycle(specs);
  if (cycle) add(byRef.get(cycle[0] as string)?.specPath ?? LOCK_PATH, 'dep-cycle', cycle.join(' -> '));

  if (lock) {
    for (const ref of Object.keys(lock.entries)) if (!byRef.has(ref)) add(LOCK_PATH, 'lock-orphan', `${ref} is in the lock but has no spec`);
    for (const [ref, e] of Object.entries(lock.entries)) {
      const prev = baseline?.entries[ref];
      if (prev && (e.rev < prev.rev || (e.rev === prev.rev && !sameHashes(e.variants, prev.variants)))) {
        add(LOCK_PATH, 'rev-regression', `${ref}: rev ${e.rev} is not above the previous lock (rev ${prev.rev}) although variants changed or rev fell`);
      }
    }
  }

  findings.push(...budgetFindings(root, specs));
  return { findings, specs, lock, scanned: specs.length };
}

/** `assets:verify`: every gate rule plus an in-memory catalog build. */
export function verifyAssets(root: string, opts: VerifyOptions = {}): AssetGateResult & { build: CatalogBuild | null } {
  const res = assetGateFindings(root, opts);
  let build: CatalogBuild | null = null;
  if (res.findings.length === 0) {
    try {
      build = buildCatalogFrom(res.specs, res.lock, recordMap(root), opts.stamp ?? lockGitStamp(root));
    } catch (e) {
      res.findings.push(finding(GATE, 'assets/src', 'catalog-build', (e as Error).message));
    }
  }
  return { ...res, build };
}
