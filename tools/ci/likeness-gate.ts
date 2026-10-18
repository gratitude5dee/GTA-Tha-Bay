/**
 * likeness:gate. Tier rules on provenance records, consent coverage against config/consent-index.json, and
 * face-detector model strings anywhere in the tracked tree (outside the string-scan allowlist) and in dist.
 *
 *   tsx tools/ci/likeness-gate.ts [--root <dir>] [--dist <dir>] [--now <iso>]
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { looksBinary, stripEncodedBlobs } from '../../packages/shared/src/assets/gates/ip.ts';
import { checkLikenessRecord, scanFaceDetector } from '../../packages/shared/src/assets/gates/likeness.ts';
import { finding, isStringScanAllowlisted, type GateFinding } from '../../packages/shared/src/assets/gates/types.ts';
import type { ProvenanceRecord } from '../../packages/shared/src/assets/provenance.ts';
import { args } from './run.ts';
import { defaultDist, isMain, listDist, listTree, loadConfigs, loadRecords, report, schemaValidator, toolsRoot } from './lib/common.ts';

const GATE = 'likeness:gate';

export interface LikenessGateOptions {
  root: string;
  dist: string;
  /** ISO-8601 UTC "now" for consent expiry. */
  now: string;
}

export function runLikenessGate(opts: LikenessGateOptions): { findings: GateFinding[]; scanned: number } {
  const cfg = loadConfigs(opts.root);
  const findings: GateFinding[] = [];
  for (const e of schemaValidator('consent-index-1')(cfg.consent)) findings.push(finding(GATE, 'config/consent-index.json', 'schema', e));
  const records = loadRecords(opts.root);
  for (const { file, raw, parseError } of records) {
    // Schema errors are provenance:check's job; the tier rules run on every record that parses, so a record that
    // breaks a conditional (for example parody with a face reference) is reported here by rule name too.
    if (parseError || !raw || typeof raw !== 'object') continue;
    const rec = raw as ProvenanceRecord;
    const paths = Array.isArray(rec.paths) ? rec.paths : [file];
    findings.push(...checkLikenessRecord({ ...rec, paths }, cfg.consent, opts.now).map((f) => ({ ...f, file })));
  }
  const terms = cfg.denylist.faceDetectorTerms;
  const tree = listTree(opts.root).filter((f) => !isStringScanAllowlisted(f));
  for (const rel of tree) {
    const bytes = readFileSync(path.join(opts.root, rel));
    if (!looksBinary(bytes)) findings.push(...scanFaceDetector(rel, bytes.toString('utf8'), terms));
  }
  const dist = listDist(opts.dist);
  for (const rel of dist) {
    const bytes = readFileSync(path.join(opts.dist, rel));
    if (!looksBinary(bytes)) findings.push(...scanFaceDetector(`dist/${rel}`, stripEncodedBlobs(bytes.toString('utf8')), terms));
  }
  return { findings, scanned: records.length + tree.length + dist.length };
}

function main(): void {
  const { values } = parseArgs({ args: args(), options: { root: { type: 'string' }, dist: { type: 'string' }, now: { type: 'string' } } });
  const root = path.resolve(values.root ?? toolsRoot);
  const dist = path.resolve(values.dist ?? defaultDist(root));
  if (!existsSync(dist)) console.log(`${GATE}: note: ${dist} does not exist, scanning the tracked tree only`);
  const { findings, scanned } = runLikenessGate({ root, dist, now: values.now ?? new Date().toISOString() });
  process.exit(report(GATE, findings, scanned));
}

if (isMain(import.meta.url)) main();
