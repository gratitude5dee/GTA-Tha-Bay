/**
 * names:lint (includes names:brand).
 *  - names:brand: the display-name literal appears only in config/brand.ts across apps/, packages/, services/,
 *    tools/, content/ and config/ (Markdown is exempt); the built bundle passes the R-NAME-2 shipped-name regex
 *    except for the exact disclaimer sentence.
 *  - display side: config/names.json display names keep a normalised distance of at least 0.4 from every real-side
 *    name.
 *  - real side (only with DV_NAMES_REAL_JSON, a JSON document or a path to one): no real-side string appears in
 *    client code, content, provenance records, config or the bundle.
 *
 *   tsx tools/ci/names-lint.ts [--root <dir>] [--dist <dir>] [--brand] [--real-json <file|json>]
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { looksBinary, stripEncodedBlobs } from '../../packages/shared/src/assets/gates/ip.ts';
import {
  checkDisplayDistance,
  compileRealNames,
  scanDisplayLiteral,
  scanRealNames,
  scanShippedNames,
  type NamesFile,
} from '../../packages/shared/src/assets/gates/names.ts';
import type { GateFinding } from '../../packages/shared/src/assets/gates/types.ts';
import { BRAND } from '../../config/brand.ts';
import { args } from './run.ts';
import { defaultDist, isMain, listDist, listTree, loadConfigs, report, schemaValidator, toolsRoot } from './lib/common.ts';
import { finding } from '../../packages/shared/src/assets/gates/types.ts';

const GATE = 'names:lint';
const BRAND_DIRS = ['apps/', 'packages/', 'services/', 'tools/', 'content/', 'config/'];
const REAL_DIRS = ['apps/', 'packages/', 'services/', 'content/', 'assets/provenance/', 'config/'];

export interface NamesLintOptions {
  root: string;
  dist: string;
  /** Real-side NameRegistry (parsed). Omit to run display-side rules only. */
  real?: NamesFile | null | undefined;
  /** Display name to look for; defaults to BRAND.displayName. */
  displayName?: string | undefined;
  /** Run only names:brand (display literal and bundle regex). */
  brandOnly?: boolean | undefined;
}

export function loadRealSide(spec: string | undefined): NamesFile | null {
  if (!spec) return null;
  const text = spec.trimStart().startsWith('{') ? spec : readFileSync(spec, 'utf8');
  const doc = JSON.parse(text) as NamesFile;
  const errors = schemaValidator('names-1')(doc);
  if (errors.length) throw new Error(`real-side names: ${errors.join('; ')}`);
  return doc;
}

export function runNamesLint(opts: NamesLintOptions): { findings: GateFinding[]; scanned: number; notes: string[] } {
  const cfg = loadConfigs(opts.root);
  const displayName = opts.displayName ?? BRAND.displayName;
  const findings: GateFinding[] = [];
  const notes: string[] = [];
  const tree = listTree(opts.root).filter((f) => !f.startsWith('third_party/'));
  const exceptions = cfg.denylist.exceptions.map((e) => e.match);

  const read = (rel: string): string | null => {
    const bytes = readFileSync(path.join(opts.root, rel));
    return looksBinary(bytes) ? null : bytes.toString('utf8');
  };

  for (const rel of tree) {
    if (!BRAND_DIRS.some((d) => rel.startsWith(d)) || rel === 'config/brand.ts' || rel.endsWith('.md')) continue;
    const text = read(rel);
    if (text !== null) findings.push(...scanDisplayLiteral(rel, text, displayName));
  }

  const dist = listDist(opts.dist);
  const distText = new Map<string, string>();
  for (const rel of dist) {
    const bytes = readFileSync(path.join(opts.dist, rel));
    if (!looksBinary(bytes)) distText.set(rel, stripEncodedBlobs(bytes.toString('utf8')));
  }
  for (const [rel, text] of distText) findings.push(...scanShippedNames(`dist/${rel}`, text, cfg.denylist.nameRegex, exceptions));

  if (!opts.brandOnly) {
    const nameErrors = schemaValidator('names-1')(cfg.names);
    for (const e of nameErrors) findings.push(finding(GATE, 'config/names.json', 'schema', e));
    if (!opts.real) {
      notes.push('real-side: skipped (DV_NAMES_REAL_JSON not set)');
    } else {
      findings.push(...checkDisplayDistance(cfg.names.entries, opts.real.entries));
      const matchers = compileRealNames(opts.real.entries);
      for (const rel of tree) {
        if (!REAL_DIRS.some((d) => rel.startsWith(d))) continue;
        const text = read(rel);
        if (text !== null) findings.push(...scanRealNames(rel, text, matchers));
      }
      for (const [rel, text] of distText) findings.push(...scanRealNames(`dist/${rel}`, text, matchers));
    }
  }
  return { findings, scanned: tree.length + dist.length, notes };
}

function main(): void {
  const { values } = parseArgs({
    args: args(),
    options: {
      root: { type: 'string' },
      dist: { type: 'string' },
      brand: { type: 'boolean', default: false },
      'real-json': { type: 'string' },
    },
  });
  const root = path.resolve(values.root ?? toolsRoot);
  const dist = path.resolve(values.dist ?? defaultDist(root));
  if (!existsSync(dist)) console.log(`${GATE}: note: ${dist} does not exist, bundle check skipped`);
  const real = values.brand ? null : loadRealSide(values['real-json'] ?? process.env.DV_NAMES_REAL_JSON);
  const res = runNamesLint({ root, dist, real, brandOnly: values.brand });
  for (const n of res.notes) console.log(n);
  if (!real && !values.brand && existsSync(dist)) console.log('SKIP names real-side dist: DV_NAMES_REAL_JSON not set');
  process.exit(report(values.brand ? 'names:brand' : GATE, res.findings, res.scanned));
}

if (isMain(import.meta.url)) main();
