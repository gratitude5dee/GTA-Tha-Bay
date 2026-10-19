/**
 * check:c2pa — provenance gate for shipped generated cutscenes (spec/domains/05-assets-pipeline.md section 9, M05b1).
 *
 *   tsx tools/ci/check-c2pa.ts [--index <cutscene-index.json>] [--manifests <dir>]
 *
 * For every entry of the shipped cutscene index (C07 asset `data/cutscene-index`, written by M05b2's index builder) it reads
 * `<manifests>/<key>/manifest.json` and fails when the manifest
 *   - lacks `provenance.origSha256` (the anchor for the unmodified original),
 *   - lacks `provenance.aiGenerated: true`, or
 *   - carries a `cleared` licence without `provenance.resigned: true` (our own C2PA claim on the renditions).
 * Without an index it prints `0 shipped cutscenes` and exits 0.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { args, repoRoot } from './run.ts';

export interface C2paFinding {
  key: string;
  rule: 'manifest-missing' | 'manifest-invalid' | 'orig-sha256-missing' | 'ai-generated-missing' | 'resign-missing';
  detail: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function manifestFindings(key: string, manifest: unknown): C2paFinding[] {
  if (!isRecord(manifest) || !isRecord(manifest['provenance'])) {
    return [{ key, rule: 'manifest-invalid', detail: 'the manifest has no provenance object' }];
  }
  const prov = manifest['provenance'];
  const out: C2paFinding[] = [];
  if (typeof prov['origSha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(prov['origSha256'])) {
    out.push({ key, rule: 'orig-sha256-missing', detail: 'provenance.origSha256 must be the SHA-256 of the unmodified original (orig.mp4)' });
  }
  if (prov['aiGenerated'] !== true) {
    out.push({ key, rule: 'ai-generated-missing', detail: 'provenance.aiGenerated must be true' });
  }
  const licence = isRecord(manifest['licence']) ? manifest['licence'] : {};
  if (licence['status'] === 'cleared' && prov['resigned'] !== true) {
    out.push({ key, rule: 'resign-missing', detail: 'a cleared licence needs provenance.resigned: true (renditions re-signed with our C2PA claim)' });
  }
  return out;
}

export interface IndexEntryLike {
  key: string;
}

/** Keys named by a `cutscene-index/1` document. */
export function indexKeys(index: unknown): string[] {
  if (!isRecord(index) || !Array.isArray(index['entries'])) return [];
  return index['entries'].flatMap((e) => (isRecord(e) && typeof e['key'] === 'string' ? [e['key']] : []));
}

export function checkAll(index: unknown, readManifest: (key: string) => unknown): { count: number; findings: C2paFinding[] } {
  const keys = [...new Set(indexKeys(index))];
  const findings: C2paFinding[] = [];
  for (const key of keys) {
    let manifest: unknown;
    try {
      manifest = readManifest(key);
    } catch (e) {
      findings.push({ key, rule: 'manifest-missing', detail: e instanceof Error ? e.message : String(e) });
      continue;
    }
    findings.push(...manifestFindings(key, manifest));
  }
  return { count: keys.length, findings };
}

export function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: { index: { type: 'string' }, manifests: { type: 'string' } },
    allowPositionals: true,
  });
  const indexPath = path.resolve(repoRoot, values.index ?? 'content/cutscenes/cutscene-index.json');
  const manifestsDir = path.resolve(repoRoot, values.manifests ?? 'assets/cutscenes');
  if (!existsSync(indexPath)) {
    console.log('check:c2pa: 0 shipped cutscenes (no cutscene index yet; M05b2 writes it)');
    return 0;
  }
  const index: unknown = JSON.parse(readFileSync(indexPath, 'utf8'));
  const { count, findings } = checkAll(index, (key) => JSON.parse(readFileSync(path.join(manifestsDir, key, 'manifest.json'), 'utf8')));
  if (count === 0) {
    console.log('check:c2pa: 0 shipped cutscenes (the index has no entries)');
    return 0;
  }
  for (const f of findings) console.error(`check:c2pa FAIL ${f.key.slice(0, 12)} ${f.rule}: ${f.detail}`);
  if (findings.length > 0) return 1;
  console.log(`check:c2pa ok: ${count} shipped cutscene(s)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(args()));
