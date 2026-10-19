/**
 * provenance:check. Walks the ship set (every file under apps/web/dist except code, `_headers`, the manifest and
 * `credits.json`), joins each SHA-256 to a record under assets/provenance/, validates records against
 * provenance-1.0.schema.json and applies the semantic rules of the pure core.
 *
 *   tsx tools/ci/provenance-check.ts [--root <dir>] [--dist <dir>] [--emit-credits] [--release]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  checkCredits,
  checkDerivation,
  checkRecord,
  collectAttributions,
} from '../../packages/shared/src/assets/gates/provenance.ts';
import { finding, type GateFinding } from '../../packages/shared/src/assets/gates/types.ts';
import type { ProvenanceRecord } from '../../packages/shared/src/assets/provenance.ts';
import { args } from './run.ts';
import {
  defaultDist,
  isMain,
  listDist,
  loadConfigs,
  loadRecords,
  report,
  schemaValidator,
  sha256Hex,
  toolsRoot,
} from './lib/common.ts';

const GATE = 'provenance:check';

/** Files that are code or delivery metadata: covered by license:scan, not by provenance (M00b "Ship set"). */
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.map']);
// asset-catalog.json is the catalog pointer: metadata validated by check:assets, not a media file (M01d).
const NON_SHIP_NAMES = new Set(['sw.js', 'manifest.webmanifest', '_headers', 'credits.json', 'asset-catalog.json']);

/**
 * `media-local/` is the QA-only same-origin copy of the M01d mirror (M01e). Production builds never ship it (M01e AC-10,
 * `verify:dist` rejects it), its catalog, manifests and pointers are derived files verified by `check:assets` and
 * `assets:verify` against the lock, its blobs are the lock's variants (joined by the lock walk below) and released
 * world packs are joined by the world-lock walk (DL-667 part 2). A copy of one of these files at any other dist path
 * is still ship set.
 */
export const QA_MIRROR_PREFIX = 'media-local/';

const VARIANT_BASE_RE = /^(default|desktop-ultra|desktop|mobile|mobile-low|xr-quest|xr-visionpro)\.([0-9a-f]{12})\.[a-z0-9]+$/;

/** True when the dist-relative path is a C07 object key (`<root>/<variant>.<sha256[0:12]>.<ext>`) whose hash fragment is `sha`'s. */
export function isObjectKeyOf(rel: string, sha: string): boolean {
  const m = VARIANT_BASE_RE.exec(rel.split('/').pop() ?? rel);
  return m !== null && m[2] === sha.slice(0, 12);
}

export function isShipFile(rel: string): boolean {
  if (rel.startsWith(QA_MIRROR_PREFIX)) return false;
  const base = rel.split('/').pop() ?? rel;
  if (NON_SHIP_NAMES.has(base)) return false;
  const dot = base.lastIndexOf('.');
  return !(dot > 0 && CODE_EXT.has(base.slice(dot).toLowerCase()));
}

function isRecordish(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return typeof o.sha256 === 'string' && /^[0-9a-f]{64}$/.test(o.sha256) && Array.isArray(o.paths) && Array.isArray(o.derived_from) &&
    Array.isArray(o.review) && typeof o.license === 'string' && typeof o.status === 'string';
}

export interface ProvenanceCheckOptions {
  root: string;
  dist: string;
  emitCredits?: boolean | undefined;
  release?: boolean | undefined;
}

export interface ProvenanceCheckResult { findings: GateFinding[]; scanned: number; records: ProvenanceRecord[] }

export function runProvenanceCheck(opts: ProvenanceCheckOptions): ProvenanceCheckResult {
  const findings: GateFinding[] = [];
  const cfg = loadConfigs(opts.root);
  const validate = schemaValidator('provenance-1.0');
  const records: ProvenanceRecord[] = [];
  for (const { file, raw, parseError } of loadRecords(opts.root)) {
    if (parseError) {
      findings.push(finding(GATE, file, 'record-unreadable', parseError));
      continue;
    }
    const errors = validate(raw);
    for (const e of errors) findings.push(finding(GATE, file, 'schema', e));
    // Semantic rules still run on records that are schema-invalid but well-formed enough to read, so the rule
    // name (for example attribution-missing) is reported next to the schema error.
    if (!isRecordish(raw)) continue;
    const rec = raw as ProvenanceRecord;
    const expected = `assets/provenance/${rec.sha256.slice(0, 2)}/${rec.sha256}.json`;
    if (file !== expected) findings.push(finding(GATE, file, 'record-path', `record for ${rec.sha256.slice(0, 12)} must live at ${expected}`));
    records.push(rec);
  }
  const bySha = new Map(records.map((r) => [r.sha256, r]));
  const gateOpts = { recordLicenses: cfg.licenses.record, release: opts.release === true };
  for (const rec of records) findings.push(...checkRecord(rec, gateOpts));
  findings.push(...checkDerivation(records));

  const ship = listDist(opts.dist).filter(isShipFile);
  for (const rel of ship) {
    const sha = sha256Hex(readFileSync(path.join(opts.dist, rel)));
    const rec = bySha.get(sha);
    if (!rec) findings.push(finding(GATE, rel, 'no-record', `no provenance record for sha256 ${sha.slice(0, 12)}`));
    else if (!rec.paths.some((p) => p === rel || p.endsWith(`/${rel}`)) && !isObjectKeyOf(rel, sha)) {
      // Same bytes under a new name: the record's paths must resolve to this file (a copy needs its own record).
      // A published object key is the exception: its name carries the content hash, the record is found by that
      // hash and lists the source files, not the key (05 section 4.1).
      findings.push(finding(GATE, rel, 'path-not-recorded', `record ${sha.slice(0, 12)} lists ${rec.paths.join(', ')}, not ${rel}`));
    }
  }

  // Lock variants (assets/assets.lock.json) are part of the ship set: each hash needs a record (05 section 4.3).
  const lockFile = path.join(opts.root, 'assets/assets.lock.json');
  let shipped = ship.length;
  if (existsSync(lockFile)) {
    const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as { entries?: Record<string, { variants?: Record<string, string> }> };
    for (const [ref, e] of Object.entries(lock.entries ?? {})) {
      for (const [variant, sha] of Object.entries(e.variants ?? {})) {
        shipped++;
        if (!bySha.has(sha)) findings.push(finding(GATE, 'assets/assets.lock.json', 'no-record', `${ref} ${variant}: no provenance record for sha256 ${sha}`));
      }
    }
  }

  const creditsPath = path.join(opts.dist, 'credits.json');
  if (opts.emitCredits && existsSync(opts.dist)) {
    const doc = { schema: 'credits/1', attributions: collectAttributions(records).map((a) => ({ license: a.license, attribution: a.attribution })) };
    writeFileSync(creditsPath, `${JSON.stringify(doc, null, 2)}\n`);
  }
  if (existsSync(opts.dist)) {
    findings.push(...checkCredits(records, existsSync(creditsPath) ? readFileSync(creditsPath, 'utf8') : null));
  }
  return { findings, scanned: shipped, records };
}

function main(): void {
  const { values } = parseArgs({
    args: args(),
    options: {
      root: { type: 'string' },
      dist: { type: 'string' },
      'emit-credits': { type: 'boolean', default: false },
      release: { type: 'boolean', default: false },
    },
  });
  const root = path.resolve(values.root ?? toolsRoot);
  const dist = path.resolve(values.dist ?? defaultDist(root));
  if (!existsSync(dist)) {
    console.error(`${GATE}: ${dist} does not exist; run pnpm build first`);
    process.exit(2);
  }
  const res = runProvenanceCheck({ root, dist, emitCredits: values['emit-credits'], release: values.release || process.env.DV_RELEASE === '1' });
  process.exit(report(GATE, res.findings, res.scanned));
}

if (isMain(import.meta.url)) main();
