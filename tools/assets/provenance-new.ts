/**
 * provenance:new. Creates the provenance record for one file from flags (no generator block: records for generated
 * files are written by the pipeline). Prints the record with --dry-run, otherwise writes it to
 * assets/provenance/<sha[0:2]>/<sha>.json.
 *
 *   tsx tools/assets/provenance-new.ts <file> --origin authored --kind ui --license LicenseRef-DeeVerse-Owned
 *       --author studio:dee-verse [--path <repo path>]... [--derived-from <sha256>]... [--tool name@version]
 *       [--attribution <text>] [--source-url <url>] [--dataset-id <id>] [--created-at <iso>] [--dry-run]
 *
 * `--path` repeats: a file the Vite build bundles under a content-hashed name lists both its repo path and its dist path
 * (`assets/<name>-<hash>.<ext>`), because provenance:check joins each dist file to a record path (BD-FIX-CI4-F02).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { AssetKind, Origin } from '../../packages/shared/src/assets/c07.ts';
import type { ProvenanceRecord } from '../../packages/shared/src/assets/provenance.ts';
import { args } from '../ci/run.ts';
import { isMain, schemaValidator, sha256Hex, toolsRoot } from '../ci/lib/common.ts';

export interface NewRecordInput {
  sha256: string;
  paths: string[];
  kind: AssetKind;
  origin: Origin;
  license: string;
  authors: string[];
  attribution?: string | undefined;
  derivedFrom?: string[] | undefined;
  tool?: { name: string; version: string; args_sha256: string } | undefined;
  source?: { url: string | null; dataset_id: string | null; retrieved: string } | undefined;
  createdAt: string;
}

export function buildRecord(i: NewRecordInput): ProvenanceRecord {
  const rec: ProvenanceRecord = {
    schema: 'provenance/1.0',
    sha256: i.sha256,
    paths: i.paths,
    kind: i.kind,
    origin: i.origin,
    license: i.license,
    authors: i.authors,
    derived_from: i.derivedFrom ?? [],
    review: [],
    ip_checks: { signatures: 'pass', strings: 'n/a', similarity: 'n/a' },
    ai_generated: false,
    status: 'active',
    created_at: i.createdAt,
  };
  if (i.attribution) rec.attribution = i.attribution;
  if (i.tool) rec.tool = i.tool;
  if (i.source) rec.source = i.source;
  return rec;
}

function main(): void {
  const { values, positionals } = parseArgs({
    args: args(),
    allowPositionals: true,
    options: {
      origin: { type: 'string' },
      kind: { type: 'string' },
      license: { type: 'string' },
      author: { type: 'string', multiple: true },
      path: { type: 'string', multiple: true },
      'derived-from': { type: 'string', multiple: true },
      tool: { type: 'string' },
      attribution: { type: 'string' },
      'source-url': { type: 'string' },
      'dataset-id': { type: 'string' },
      'created-at': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const file = positionals[0];
  if (!file || !values.origin || !values.kind || !values.license || !values.author?.length) {
    console.error('usage: provenance-new <file> --origin <o> --kind <k> --license <spdx> --author <profile:|studio:...> [--dry-run]');
    process.exit(2);
  }
  const abs = path.resolve(file);
  const sha = sha256Hex(readFileSync(abs));
  const paths = values.path?.length ? values.path : [path.relative(toolsRoot, abs).split(path.sep).join('/')];
  let tool: NewRecordInput['tool'];
  if (values.tool) {
    const at = values.tool.lastIndexOf('@');
    if (at <= 0) {
      console.error('--tool must be name@version');
      process.exit(2);
    }
    tool = { name: values.tool.slice(0, at), version: values.tool.slice(at + 1), args_sha256: sha256Hex(Buffer.from(values.tool)) };
  }
  const now = values['created-at'] ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const rec = buildRecord({
    sha256: sha,
    paths,
    kind: values.kind as AssetKind,
    origin: values.origin as Origin,
    license: values.license,
    authors: values.author,
    attribution: values.attribution,
    derivedFrom: values['derived-from'],
    tool,
    source: values['source-url'] || values['dataset-id'] ? { url: values['source-url'] ?? null, dataset_id: values['dataset-id'] ?? null, retrieved: now.slice(0, 10) } : undefined,
    createdAt: now,
  });
  const errors = schemaValidator('provenance-1.0')(rec);
  if (errors.length) console.error(`warning: the record does not validate yet: ${errors.join('; ')}`);
  const text = `${JSON.stringify(rec, null, 2)}\n`;
  if (values['dry-run']) {
    process.stdout.write(text);
    return;
  }
  const out = path.join(toolsRoot, 'assets', 'provenance', sha.slice(0, 2), `${sha}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(`wrote ${path.relative(toolsRoot, out)}`);
}

if (isMain(import.meta.url)) main();
