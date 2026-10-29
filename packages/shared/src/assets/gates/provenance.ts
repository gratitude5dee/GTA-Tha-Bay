/**
 * Pure core of provenance:check (spec/domains/05-assets.md section 4.3). Structural validation against the JSON
 * Schema is done by the CLI with Ajv; this module holds the semantic rules: licence allowlist, status, generator
 * env, previs and mock references, placeholder tags in release mode, derivation cycles and unrooted chains,
 * attribution coverage.
 */
import type { ProvenanceRecord } from '../provenance.ts';
import { missingCcByFields, packOfUrl, parseCcByAttribution } from '../credits.ts';
import { finding, type GateFinding } from './types.ts';
import { licenseAllowed } from './license.ts';

const GATE = 'provenance:check';

export interface ProvenanceGateOptions {
  /** `licenses.record` of config/license-allowlist.json (entries may end in `*`). */
  recordLicenses: readonly string[];
  /** Release mode: placeholder tags fail. */
  release: boolean;
}

export function normalizeSha(ref: string): string {
  return ref.startsWith('sha256:') ? ref.slice(7) : ref;
}

function fileOf(rec: ProvenanceRecord): string {
  return rec.paths[0] ?? rec.sha256;
}

export function checkRecord(rec: ProvenanceRecord, opts: ProvenanceGateOptions): GateFinding[] {
  const out: GateFinding[] = [];
  const file = fileOf(rec);
  const add = (rule: string, detail: string): void => {
    out.push(finding(GATE, file, rule, detail));
  };
  if (!licenseAllowed(rec.license, opts.recordLicenses)) add('license-not-allowed', `licence ${rec.license} is not on the record allowlist`);
  if (rec.status !== 'active') add('status-not-active', `status is ${rec.status}`);
  const g = rec.generator;
  if (g) {
    if (g.env !== 'production') add('env-not-production', `generator.env is ${g.env}`);
    if (g.executor === 'mock') add('mock-reference', 'generator.executor is mock');
    for (const ref of g.input_refs ?? []) {
      if (/(^|\/)previs\//.test(ref)) add('previs-reference', `input ref ${ref}`);
      if (/(^|[/_.-])mock([/_.-]|$)/i.test(ref)) add('mock-reference', `input ref ${ref}`);
    }
  } else if (rec.origin === 'generated') {
    add('generator-missing', 'origin generated requires a generator block');
  }
  for (const p of rec.paths) {
    if (/(^|\/)previs\//.test(p)) add('previs-reference', `path ${p}`);
    if (/(^|[/_.-])mock([/_.-]|$)/i.test(p)) add('mock-reference', `path ${p}`);
    if (opts.release && /placeholder/i.test(p)) add('placeholder-tag', `path ${p}`);
  }
  if (opts.release) {
    if (rec.attribution && /placeholder/i.test(rec.attribution)) add('placeholder-tag', 'attribution is a placeholder');
    for (const r of rec.review) if (r.note && /placeholder/i.test(r.note)) add('placeholder-tag', `review note at ${r.at}`);
  }
  if (!rec.attribution && (rec.origin === 'open_data' || rec.license === 'CC-BY-4.0' || rec.license === 'ODbL-1.0')) {
    add('attribution-missing', `${rec.origin} record under ${rec.license} needs an attribution`);
  }
  if (rec.origin === 'generated' && !rec.ai_generated) add('ai-flag', 'generated record must set ai_generated');
  return out;
}

/** Cycles and unrooted chains over a set of records keyed by sha256. */
export function checkDerivation(records: readonly ProvenanceRecord[]): GateFinding[] {
  const bySha = new Map<string, ProvenanceRecord>();
  for (const r of records) bySha.set(r.sha256, r);
  const out: GateFinding[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (rec: ProvenanceRecord, trail: string[]): void => {
    const st = state.get(rec.sha256);
    if (st === 'done') return;
    if (st === 'visiting') {
      out.push(finding(GATE, fileOf(rec), 'derivation-cycle', [...trail, rec.sha256].map((s) => s.slice(0, 12)).join(' -> ')));
      return;
    }
    state.set(rec.sha256, 'visiting');
    for (const raw of rec.derived_from) {
      const parent = bySha.get(normalizeSha(raw));
      if (!parent) {
        out.push(finding(GATE, fileOf(rec), 'derivation-unrooted', `parent ${normalizeSha(raw).slice(0, 12)} has no record`));
        continue;
      }
      visit(parent, [...trail, rec.sha256]);
    }
    state.set(rec.sha256, 'done');
  };
  for (const r of records) visit(r, []);
  return out;
}

export interface Attribution { sha256: string; license: string; attribution: string }

export function collectAttributions(records: readonly ProvenanceRecord[]): Attribution[] {
  const out: Attribution[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (!r.attribution || r.status !== 'active') continue;
    const key = `${r.license}\u0000${r.attribution}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sha256: r.sha256, license: r.license, attribution: r.attribution });
  }
  return out;
}

/** Every attribution string must appear in credits.json text. */
export function checkCredits(records: readonly ProvenanceRecord[], creditsText: string | null): GateFinding[] {
  const out: GateFinding[] = [];
  for (const a of collectAttributions(records)) {
    if (creditsText === null || !creditsText.includes(JSON.stringify(a.attribution).slice(1, -1))) {
      out.push(finding(GATE, 'credits.json', 'attribution-not-in-credits', `${a.license}: ${a.attribution}`));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// M10d0: third-party art (DL-OWN-06). A `licensed` record is admitted only through a dated licence snapshot.

/** One row of docs/legal/licenses/packs.json. */
export interface ArtPack {
  id: string;
  hosts: string[];
  spdx: string;
  snapshot: { path: string; sha256: string; retrieved: string };
  courtesy?: string;
  use: 'import' | 'snapshot-only';
}

export interface ArtPackRegister { schema: 'art-packs/1'; packs: ArtPack[] }

/** The fields of a provenance record that the credits builder reads. */
export type ArtRecordView = Pick<ProvenanceRecord, 'origin' | 'status' | 'license' | 'attribution' | 'source'>;

/** `tool.name` of the records `assets:import -- textures` writes for its KTX2 outputs. */
export const TEXTURE_TOOL = 'dv-texture-set';

/** The review gate and decision a licensed file needs before it ships. */
export const ART_VETTING_GATE = 'art-vetting';

export interface LicensedGateOptions {
  packs: readonly ArtPack[];
  /** SHA-256 of each pack's snapshot file as found on disk, by pack id; null when the file is missing. */
  snapshotSha: Readonly<Record<string, string | null>>;
}

const RESTRICTED_LICENCE = /(^|[-\s])(nc|nd|sa)([-\s]|$)|editorial|noncommercial|non-commercial|noderiv/i;

/** True for a licence id that carries a non-commercial, no-derivatives, share-alike or editorial-only term. */
export function restrictedLicence(license: string): boolean {
  return RESTRICTED_LICENCE.test(license);
}

/** The register itself: every snapshot file exists and matches its recorded hash. One finding per pack. */
export function checkPackRegister(packs: readonly ArtPack[], snapshotSha: Readonly<Record<string, string | null>>): GateFinding[] {
  const out: GateFinding[] = [];
  for (const p of packs) {
    const actual = snapshotSha[p.id];
    if (actual === undefined || actual === null) out.push(finding(GATE, p.snapshot.path, 'art-snapshot-missing', `pack ${p.id}: snapshot file not found`));
    else if (actual !== p.snapshot.sha256) {
      out.push(finding(GATE, p.snapshot.path, 'art-snapshot-altered', `pack ${p.id}: snapshot sha256 ${actual.slice(0, 12)} differs from the register ${p.snapshot.sha256.slice(0, 12)}`));
    }
  }
  return out;
}

/** The licensed-file rules (DL-OWN-06): a known host with an intact snapshot, the pack's licence, a vetting approval, a complete CC-BY attribution. */
export function checkLicensedRecord(rec: ProvenanceRecord, opts: LicensedGateOptions): GateFinding[] {
  if (rec.origin !== 'licensed') return [];
  const out: GateFinding[] = [];
  const file = fileOf(rec);
  const add = (rule: string, detail: string): void => {
    out.push(finding(GATE, file, rule, detail));
  };
  const url = rec.source?.url ?? null;
  const pack = packOfUrl(opts.packs, url);
  if (!pack) add('art-host-unknown', url ? `source.url host of ${url} is in no pack of docs/legal/licenses/packs.json` : 'a licensed record needs a source.url');
  else {
    const actual = opts.snapshotSha[pack.id];
    if (actual === undefined || actual === null) add('art-snapshot-missing', `pack ${pack.id}: snapshot file not found`);
    else if (actual !== pack.snapshot.sha256) add('art-snapshot-altered', `pack ${pack.id}: snapshot sha256 ${actual.slice(0, 12)} differs from the register`);
    if (rec.license !== pack.spdx) add('art-licence-mismatch', `licence ${rec.license} is not ${pack.spdx} of pack ${pack.id}`);
  }
  if (restrictedLicence(rec.license)) add('art-licence-restricted', `licence ${rec.license} carries a non-commercial, no-derivatives, share-alike or editorial term`);
  if (!rec.review.some((r) => r.gate === ART_VETTING_GATE && r.decision === 'approve')) {
    add('art-vetting-missing', `no review {gate: '${ART_VETTING_GATE}', decision: 'approve'}`);
  }
  if (rec.license === 'CC-BY-4.0') {
    const missing = missingCcByFields(rec.attribution ? parseCcByAttribution(rec.attribution) : {});
    if (missing.length > 0) add('art-attribution-incomplete', `CC-BY attribution lacks ${missing.join(', ')}`);
  }
  return out;
}

/** A derived KTX2 written by the texture importer must reach only licensed roots. */
export function checkDerivedKtx2Roots(records: readonly ProvenanceRecord[]): GateFinding[] {
  const bySha = new Map<string, ProvenanceRecord>();
  for (const r of records) bySha.set(r.sha256, r);
  const out: GateFinding[] = [];
  const rootsOf = (rec: ProvenanceRecord, seen: Set<string>): ProvenanceRecord[] => {
    if (seen.has(rec.sha256)) return [];
    seen.add(rec.sha256);
    if (rec.derived_from.length === 0) return [rec];
    const roots: ProvenanceRecord[] = [];
    for (const raw of rec.derived_from) {
      const parent = bySha.get(normalizeSha(raw));
      if (parent) roots.push(...rootsOf(parent, seen));
    }
    return roots;
  };
  for (const rec of records) {
    if (rec.origin !== 'derived' || rec.tool?.name !== TEXTURE_TOOL || !rec.paths.some((p) => p.endsWith('.ktx2'))) continue;
    const roots = rootsOf(rec, new Set());
    if (roots.length === 0) {
      out.push(finding(GATE, fileOf(rec), 'art-derived-root', 'derived KTX2 has no root record'));
      continue;
    }
    for (const root of roots) {
      if (root.origin !== 'licensed') out.push(finding(GATE, fileOf(rec), 'art-derived-root', `derived KTX2 needs a licensed root; ${root.sha256.slice(0, 12)} is ${root.origin}`));
    }
  }
  return out;
}
