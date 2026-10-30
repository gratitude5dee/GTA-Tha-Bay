/**
 * `assets:import -- vet <dir>`: the vetting rules of docs/legal/art-vetting-checklist.md (M10d0, DL-OWN-06) over the
 * intake records of assets/intake/<pack>/<item>.json (config/schemas/art-intake.schema.json).
 *
 * The tool decides what it can read off the record (real make or model names, game-style names, franchise tags and uploaders,
 * missing authorship evidence, licence, pack host) and takes the reviewer's answers for the rest (origin, storefront logos,
 * people, murals, and the silhouette of every vehicle). An unanswered question rejects, as does an unclear origin.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { packOfUrl } from '../../../../packages/shared/src/assets/credits.ts';
import { restrictedLicence, type ArtPack } from '../../../../packages/shared/src/assets/gates/provenance.ts';
import { compileStringMatcher, scanText, type StringMatcher } from '../../../../packages/shared/src/assets/gates/ip.ts';
import { licenseAllowed } from '../../../../packages/shared/src/assets/gates/license.ts';
import { loadConfigs, readJson } from '../../../ci/lib/common.ts';
import { configSchemaValidator, loadPackRegister } from './packs.ts';

export interface IntakeRecord {
  schema: 'art-intake/1';
  pack: string;
  item: string;
  title: string;
  author: string;
  sourceUrl: string;
  licence: string;
  licenceUrl?: string;
  kind: 'texture' | 'vehicle' | 'prop' | 'ped' | 'building' | 'terrain' | 'hdri' | 'audio';
  uploader: { name: string; franchiseShare: number };
  files: string[];
  tags: string[];
  evidence: Array<'portfolio' | 'wip' | 'wireframe' | 'vendor-page' | 'source-files'>;
  answers: {
    origin: 'clear' | 'unclear' | null;
    logos: 'none' | 'present' | null;
    people: 'none' | 'present' | null;
    mural: 'none' | 'present' | null;
    'V-SIL'?: 'pass' | 'fail' | null;
  };
  review?: { by: string; at: string; note?: string };
}

export interface VettingConfig {
  schema: 'art-vetting/1';
  realMakes: string[];
  realModels: string[];
  gameNamePatterns: { id: string; regex: string; flags: string }[];
  uploaderFranchiseShare: number;
  silhouetteKinds: string[];
  allowedLicences: string[];
}

export interface VetFinding { rule: string; detail: string }
export interface VetResult { file: string; pack: string; item: string; decision: 'approve' | 'reject'; findings: VetFinding[] }

export interface VetContext {
  config: VettingConfig;
  ipMatcher: StringMatcher;
  /** Lower-case extensions with a leading dot that the IP denylist refuses. */
  deniedExtensions: readonly string[];
  packs: readonly ArtPack[];
  recordLicenses: readonly string[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordRe(list: readonly string[]): RegExp | null {
  return list.length === 0 ? null : new RegExp(`(?<![a-z0-9])(?:${list.map(escapeRe).join('|')})(?![a-z0-9])`, 'i');
}

/** Rule ids: V-LICENCE, V-PACK, V-MAKE, V-NAME-LOD0, V-NAME-VEHSHARE, V-NAME-HI, V-NAME-EXT, V-DENYLIST, V-TAG, V-UPLOADER, V-EVIDENCE, V-ORIGIN, V-LOGO, V-PERSON, V-MURAL, V-SIL. */
export function vetItem(item: IntakeRecord, ctx: VetContext): VetFinding[] {
  const out: VetFinding[] = [];
  const add = (rule: string, detail: string): void => {
    out.push({ rule, detail });
  };
  const names = [item.item, item.title, ...item.files, ...item.tags];

  // licence and source
  if (restrictedLicence(item.licence) || !ctx.config.allowedLicences.includes(item.licence) || !licenseAllowed(item.licence, ctx.recordLicenses)) {
    add('V-LICENCE', `licence ${item.licence} is not one of ${ctx.config.allowedLicences.join(', ')} (no NC, ND, SA or editorial terms)`);
  }
  const pack = packOfUrl(ctx.packs, item.sourceUrl);
  if (!pack) add('V-PACK', `source host of ${item.sourceUrl} is in no pack of docs/legal/licenses/packs.json (a pack is admitted after its snapshot)`);
  else if (pack.spdx !== item.licence) add('V-LICENCE', `licence ${item.licence} is not ${pack.spdx} of pack ${pack.id}`);

  // real make and model names
  const makes = wordRe(ctx.config.realMakes);
  const models = item.kind === 'vehicle' ? wordRe(ctx.config.realModels) : null;
  for (const n of names) {
    const m = makes?.exec(n) ?? models?.exec(n);
    if (m) {
      add('V-MAKE', `"${n}" names a real make or model (${m[0].toLowerCase()})`);
      break;
    }
  }

  // game-style names and extensions
  for (const p of ctx.config.gameNamePatterns) {
    const re = new RegExp(p.regex, p.flags);
    const hit = names.find((n) => re.test(n));
    if (hit !== undefined) add(`V-NAME-${p.id.toUpperCase()}`, `"${hit}" has the game-style token ${p.id}`);
  }
  for (const f of item.files) {
    const ext = path.extname(f).toLowerCase();
    if (ext !== '' && ctx.deniedExtensions.includes(ext)) add('V-NAME-EXT', `"${f}" has the game-format extension ${ext}`);
  }

  // franchise strings in the name, title and files; franchise tags and uploaders
  const nameHits = scanText([item.item, item.title, ...item.files].join('\n'), ctx.ipMatcher, 3);
  if (nameHits.length > 0) add('V-DENYLIST', `name or title hits the IP denylist (${nameHits.map((h) => h.rule).join(', ')})`);
  const tagHits = scanText(item.tags.join('\n'), ctx.ipMatcher, 3);
  if (tagHits.length > 0) add('V-TAG', `tags hit the IP denylist (${tagHits.map((h) => h.rule).join(', ')})`);
  const uploaderHits = scanText(item.uploader.name, ctx.ipMatcher, 3);
  if (uploaderHits.length > 0 || item.uploader.franchiseShare >= ctx.config.uploaderFranchiseShare) {
    add('V-UPLOADER', uploaderHits.length > 0
      ? 'uploader name hits the IP denylist'
      : `${Math.round(item.uploader.franchiseShare * 100)} % of the uploader's items are franchise material (limit ${Math.round(ctx.config.uploaderFranchiseShare * 100)} %)`);
  }

  // authorship evidence
  if (item.evidence.length === 0) add('V-EVIDENCE', 'no authorship evidence (portfolio, work in progress, wireframe, vendor page or source files)');

  // the reviewer's answers
  const a = item.answers;
  if (a.origin === null) add('V-ORIGIN', 'origin unanswered: reject when the origin is unclear');
  else if (a.origin === 'unclear') add('V-ORIGIN', 'origin is unclear');
  const presence = (rule: string, what: string, v: 'none' | 'present' | null): void => {
    if (v === null) add(rule, `${what} unanswered`);
    else if (v === 'present') add(rule, `${what} present`);
  };
  presence('V-LOGO', 'storefront logos', a.logos);
  presence('V-PERSON', 'people or scans of people', a.people);
  presence('V-MURAL', 'murals or public art', a.mural);
  if (ctx.config.silhouetteKinds.includes(item.kind)) {
    const sil = a['V-SIL'];
    if (sil === undefined || sil === null) add('V-SIL', 'silhouette check unanswered (side and three-quarter profile against the denylisted makes)');
    else if (sil === 'fail') add('V-SIL', 'silhouette follows a real vehicle: remodel or drop');
  }
  return out;
}

export function loadVetContext(root: string): VetContext {
  const cfgs = loadConfigs(root);
  return {
    config: readJson<VettingConfig>(path.join(root, 'config', 'art-vetting.json')),
    ipMatcher: compileStringMatcher(cfgs.denylist),
    deniedExtensions: cfgs.denylist.extensions,
    packs: loadPackRegister(root).packs,
    recordLicenses: cfgs.licenses.record,
  };
}

function jsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...jsonFiles(abs));
    else if (name.endsWith('.json')) out.push(abs);
  }
  return out;
}

/** Vets every intake record under `dir` (a file or a directory). A record that does not match the schema rejects as V-SCHEMA. */
export function vetDir(root: string, dir: string): VetResult[] {
  const ctx = loadVetContext(root);
  const validate = configSchemaValidator('art-intake');
  const files = existsSync(dir) && statSync(dir).isDirectory() ? jsonFiles(dir) : [dir];
  const results: VetResult[] = [];
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      results.push({ file, pack: '?', item: '?', decision: 'reject', findings: [{ rule: 'V-SCHEMA', detail: (e as Error).message }] });
      continue;
    }
    const errors = validate(raw);
    const rec = raw as Partial<IntakeRecord>;
    if (errors.length > 0) {
      results.push({ file, pack: rec.pack ?? '?', item: rec.item ?? '?', decision: 'reject', findings: errors.map((e) => ({ rule: 'V-SCHEMA', detail: e })) });
      continue;
    }
    const findings = vetItem(raw as IntakeRecord, ctx);
    results.push({ file, pack: (raw as IntakeRecord).pack, item: (raw as IntakeRecord).item, decision: findings.length === 0 ? 'approve' : 'reject', findings });
  }
  return results;
}

export function formatVet(r: VetResult): string[] {
  const head = `vet: ${r.pack}/${r.item}: ${r.decision}`;
  return [head, ...r.findings.map((f) => `vet: ${r.pack}/${r.item}: ${f.rule}: ${f.detail}`)];
}
