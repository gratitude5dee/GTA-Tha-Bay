/**
 * check:assets (the M00b part). Schemas of every config/*.json that M00b adds and of all provenance records,
 * registry invariants (banned list, voice_clone tiers, no cleared video provider, terms snapshots indexed),
 * ship-set file size (25 MiB) and world-pack size (4 MiB). M01d adds the catalog, lock-file, fidelity, dependency,
 * budget and pointer rules (tools/assets/src/verify.ts).
 *
 *   tsx tools/ci/check-assets.ts [--root <dir>] [--dist <dir>]
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { finding, type GateFinding } from '../../packages/shared/src/assets/gates/types.ts';
import type { ProvenanceRecord } from '../../packages/shared/src/assets/provenance.ts';
import { registryFindings } from '../../packages/shared/src/genai/registry.ts';
import { args } from './run.ts';
import { defaultDist, isMain, listDist, loadConfigs, loadRecords, MIB, readJson, report, schemaValidator, toolsRoot } from './lib/common.ts';
import { isShipFile } from './provenance-check.ts';
import { assetGateFindings, pointerFindings, type VerifyOptions } from '../assets/src/verify.ts';
import { cutsceneIndexFindings } from '../assets/cutscene-index/verify.ts';
import { lintTemplates, templateFiles } from './prompt-lint.ts';

const GATE = 'check:assets';
const SHIP_LIMIT = 25 * MIB;
const PACK_LIMIT = 4 * MIB;

const CONFIG_SCHEMAS: [file: string, schema: string][] = [
  ['config/license-allowlist.json', 'license-allowlist-1'],
  ['config/ip-denylist.json', 'ip-denylist-1'],
  ['config/names.json', 'names-1'],
  ['config/consent-index.json', 'consent-index-1'],
  ['config/genai-endpoints.json', 'genai-endpoints-1'],
];

interface TermsIndex { entries: { id: string; path: string | null }[] }

export function runCheckAssets(opts: { root: string; dist: string; verify?: VerifyOptions }): { findings: GateFinding[]; scanned: number } {
  const findings: GateFinding[] = [];
  let scanned = 0;
  for (const [file, schema] of CONFIG_SCHEMAS) {
    scanned++;
    const p = path.join(opts.root, file);
    if (!existsSync(p)) {
      findings.push(finding(GATE, file, 'config-missing', 'file does not exist'));
      continue;
    }
    for (const e of schemaValidator(schema)(readJson(p))) findings.push(finding(GATE, file, 'schema', e));
  }

  if (existsSync(path.join(opts.root, 'config/genai-endpoints.json'))) {
    const cfg = loadConfigs(opts.root);
    for (const f of registryFindings(cfg.registry)) findings.push(finding(GATE, 'config/genai-endpoints.json', f.rule, f.detail));
    const indexPath = path.join(opts.root, 'docs/legal/vendor-terms/index.json');
    const indexed = new Set<string>();
    if (existsSync(indexPath)) for (const e of readJson<TermsIndex>(indexPath).entries) if (e.path) indexed.add(e.path);
    for (const e of Object.values(cfg.registry.endpoints)) {
      if (e.termsSnapshot !== 'none' && !indexed.has(e.termsSnapshot)) {
        findings.push(finding(GATE, 'config/genai-endpoints.json', 'terms-snapshot-unindexed', `${e.id}: ${e.termsSnapshot} is not in docs/legal/vendor-terms/index.json`));
      }
    }
  }

  const validate = schemaValidator('provenance-1.0');
  for (const { file, raw, parseError } of loadRecords(opts.root)) {
    scanned++;
    if (parseError) {
      findings.push(finding(GATE, file, 'record-unreadable', parseError));
      continue;
    }
    for (const e of validate(raw)) findings.push(finding(GATE, file, 'schema', e));
    const rec = raw as ProvenanceRecord;
    if (rec && rec.kind === 'world_pack') {
      for (const p of rec.paths) {
        const abs = path.join(opts.root, p);
        if (existsSync(abs) && statSync(abs).size > PACK_LIMIT) findings.push(finding(GATE, p, 'pack-too-large', 'world pack is larger than 4 MiB'));
      }
    }
  }

  for (const rel of listDist(opts.dist).filter(isShipFile)) {
    scanned++;
    const size = statSync(path.join(opts.dist, rel)).size;
    if (size > SHIP_LIMIT) findings.push(finding(GATE, rel, 'file-too-large', `${size} bytes exceeds 25 MiB`));
  }
  // M05b2: the genAI prompt templates (rules 1 to 6 of the prompt lint) and the shipped cutscene index.
  const prompts = lintTemplates(opts.root, templateFiles(opts.root));
  for (const n of prompts.notes) console.log(n);
  findings.push(...prompts.findings);
  scanned += prompts.scanned;
  const index = cutsceneIndexFindings(opts.root);
  findings.push(...index.findings);
  scanned += index.scanned;
  const gate = assetGateFindings(opts.root, opts.verify);
  findings.push(...gate.findings, ...pointerFindings(opts.root));
  scanned += gate.scanned;
  return { findings, scanned };
}

function main(): void {
  const { values } = parseArgs({ args: args(), options: { root: { type: 'string' }, dist: { type: 'string' } } });
  const root = path.resolve(values.root ?? toolsRoot);
  const dist = path.resolve(values.dist ?? defaultDist(root));
  if (!existsSync(dist)) console.log(`${GATE}: note: ${dist} does not exist, ship-set size check skipped`);
  const { findings, scanned } = runCheckAssets({ root, dist });
  process.exit(report(GATE, findings, scanned));
}

if (isMain(import.meta.url)) main();
