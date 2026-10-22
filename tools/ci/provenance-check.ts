/**
 * provenance:check. Walks the ship set (every file under apps/web/dist except code, `_headers`, the manifest and
 * `credits.json`), joins each SHA-256 to a record under assets/provenance/, validates records against
 * provenance-1.0.schema.json and applies the semantic rules of the pure core.
 *
 *   tsx tools/ci/provenance-check.ts [--root <dir>] [--dist <dir>] [--emit-credits [--emit-only]] [--release]
 *
 * `--emit-credits` writes dist/credits.json: the record attributions, the vendored-item NOTICE lines and (M02c2, DL-662) the `world`
 * array of config/attribution.world.json with the ODbL notice and the OSM `offerUrl`. `--emit-only` writes the file and runs no gate
 * (the root `build` script ends with it so every dist holds the file; the gate runs in the CI `ip` job).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { worldCreditsOf, type WorldAttributionFile } from '../../packages/shared/src/world/credits.ts';
import { args } from './run.ts';
import { hasThirdParty, loadRegister, noticeFor, parseNotice, readText, vendoredEntries } from './lib/third-party.ts';
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
const NON_SHIP_NAMES = new Set(['sw.js', 'manifest.webmanifest', '_headers', 'credits.json', 'asset-catalog.json',
  // M00f: delivery metadata checked by license:scan, not by a provenance record.
  'third-party-licenses.txt', 'THIRD_PARTY_LICENSES.txt']);

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

const MAPBOX_HOST = ['map', 'box.com'].join('');

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Every vendored item's third_party/NOTICE line verbatim (license = the item's SPDX id, attribution = the line)
 * plus one entry linking third-party-licenses.txt (BD-M00f-03). Empty without vendored items.
 */
export function vendoredCredits(root: string): Array<{ license: string; attribution: string }> {
  const entries = vendoredEntries(loadRegister(root));
  if (entries.length === 0) return [];
  const notice = parseNotice(readText(root, 'third_party/NOTICE') ?? '').lines;
  const out: Array<{ license: string; attribution: string }> = [];
  for (const e of entries) {
    for (const item of e.allowedPaths ?? []) {
      const line = noticeFor(notice, e.name as string, item);
      if (line) out.push({ license: item.spdx, attribution: line.raw });
    }
  }
  out.push({ license: 'LicenseRef-ThirdParty-Notices', attribution: 'Third-party software and data: see third-party-licenses.txt' });
  return out;
}

function isRecordish(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return typeof o.sha256 === 'string' && /^[0-9a-f]{64}$/.test(o.sha256) && Array.isArray(o.paths) && Array.isArray(o.derived_from) &&
    Array.isArray(o.review) && typeof o.license === 'string' && typeof o.status === 'string';
}

/** assets/assets.lock.json and every assets/world/*.lock.json that exists, as repo-relative paths. */
export function lockFiles(root: string): string[] {
  const out: string[] = [];
  if (existsSync(path.join(root, 'assets/assets.lock.json'))) out.push('assets/assets.lock.json');
  const worldDir = path.join(root, 'assets/world');
  if (existsSync(worldDir)) {
    for (const name of readdirSync(worldDir).sort()) if (name.endsWith('.lock.json')) out.push(`assets/world/${name}`);
  }
  return out;
}

export interface ProvenanceCheckOptions {
  root: string;
  dist: string;
  emitCredits?: boolean | undefined;
  /** With `emitCredits`: write credits.json and skip every gate (M02c2, DL-662). */
  emitOnly?: boolean | undefined;
  release?: boolean | undefined;
}

export interface ProvenanceCheckResult { findings: GateFinding[]; scanned: number; records: ProvenanceRecord[] }

/** `config/attribution.world.json` of a checkout, or an empty file when there is none. */
export function readWorldAttribution(root: string): WorldAttributionFile {
  const file = path.join(root, 'config', 'attribution.world.json');
  if (!existsSync(file)) return { entries: [] };
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as WorldAttributionFile;
  return { ...parsed, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
}

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
  // M00f: a record whose source URL is on mapbox.com or a subdomain is refused (DL-506).
  for (const rec of records) {
    const host = hostOf(rec.source?.url ?? null);
    if (host !== null && (host === MAPBOX_HOST || host.endsWith(`.${MAPBOX_HOST}`))) {
      findings.push(finding(GATE, `assets/provenance/${rec.sha256.slice(0, 2)}/${rec.sha256}.json`, 'mapbox-source', 'source.url is a Mapbox host; Mapbox content is never used (DL-506)'));
    }
  }
  const writeCredits = (): void => {
    const attributions = collectAttributions(records).map((a) => ({ license: a.license, attribution: a.attribution }));
    attributions.push(...vendoredCredits(opts.root));
    const doc = { schema: 'credits/1', attributions, ...worldCreditsOf(readWorldAttribution(opts.root)) };
    writeFileSync(path.join(opts.dist, 'credits.json'), `${JSON.stringify(doc, null, 2)}\n`);
  };
  if (opts.emitCredits && opts.emitOnly) {
    if (existsSync(opts.dist)) writeCredits();
    return { findings: [], scanned: 0, records };
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

  // Lock variants are part of the ship set: each hash needs a record (05 section 4.3). The main lock and every world lock
  // (assets/world/*.lock.json, written by map:pack for the sf bake; same lock schema; DL-667) are walked the same way.
  let shipped = ship.length;
  for (const lockRel of lockFiles(opts.root)) {
    const lock = JSON.parse(readFileSync(path.join(opts.root, lockRel), 'utf8')) as { entries?: Record<string, { variants?: Record<string, string> }> };
    for (const [ref, e] of Object.entries(lock.entries ?? {})) {
      for (const [variant, sha] of Object.entries(e.variants ?? {})) {
        shipped++;
        if (!bySha.has(sha)) findings.push(finding(GATE, lockRel, 'no-record', `${ref} ${variant}: no provenance record for sha256 ${sha}`));
      }
    }
  }

  if (hasThirdParty(opts.root) && vendoredEntries(loadRegister(opts.root)).length > 0 && existsSync(opts.dist) && !existsSync(path.join(opts.dist, 'third-party-licenses.txt'))) {
    findings.push(finding(GATE, 'third-party-licenses.txt', 'licences-file-missing', 'vendored items exist but the dist has no third-party-licenses.txt (run tools/ci/third-party-licenses.ts)'));
  }
  const creditsPath = path.join(opts.dist, 'credits.json');
  if (opts.emitCredits && existsSync(opts.dist)) writeCredits();
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
      'emit-only': { type: 'boolean', default: false },
      release: { type: 'boolean', default: false },
    },
  });
  const root = path.resolve(values.root ?? toolsRoot);
  const dist = path.resolve(values.dist ?? defaultDist(root));
  if (!existsSync(dist)) {
    console.error(`${GATE}: ${dist} does not exist; run pnpm build first`);
    process.exit(2);
  }
  const res = runProvenanceCheck({ root, dist, emitCredits: values['emit-credits'] || values['emit-only'], emitOnly: values['emit-only'], release: values.release || process.env.DV_RELEASE === '1' });
  process.exit(report(GATE, res.findings, res.scanned));
}

if (isMain(import.meta.url)) main();
