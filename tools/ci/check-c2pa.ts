/**
 * check:c2pa — provenance gate for shipped generated cutscenes (spec/domains/05-assets-pipeline.md section 9, M05b1).
 *
 *   tsx tools/ci/check-c2pa.ts [--index <cutscene-index.json>] [--manifests <dir>] [--env prod|staging] [--verify-signatures]
 *
 * `--env prod` (M05c3) reads the manifests as production outputs: `provenance.resigned: true` is then required whatever the licence
 * status. The default run also checks the committed fixtures of `tools/ci/fixtures/c2pa` (the mock prewarm output passes, an
 * unsigned production manifest and one without `aiGenerated` fail).
 *
 * For every entry of the shipped cutscene index (C07 asset `data/cutscene-index`, written by M05b2's index builder) it reads
 * `<manifests>/<key>/manifest.json` and fails when the manifest
 *   - lacks `provenance.origSha256` (the anchor for the unmodified original),
 *   - lacks `provenance.aiGenerated: true`, or
 *   - carries a `cleared` licence without `provenance.resigned: true` (our own C2PA claim on the renditions).
 * Without an index it prints `0 shipped cutscenes` and exits 0. An explicit `--index` is strict (M05c4): a file that does not exist, or one with
 * no entries, fails, because a release that names an index means to ship what it lists.
 *
 * `--verify-signatures` (M05c4) reads every rendition named by a manifest, beside it, with the pinned `Reader.fromAsset` of
 * `@contentauth/c2pa-node` and fails on a missing active manifest, a missing `orig.mp4` ingredient, or any validation code other than
 * `signingCredential.untrusted` (the code a self-made root produces).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { inspectSignature, loadC2pa, signatureProblems, type C2paModuleLike } from './c2pa-read.ts';
import { args, repoRoot } from './run.ts';

export interface C2paFinding {
  key: string;
  rule: 'manifest-missing' | 'manifest-invalid' | 'orig-sha256-missing' | 'ai-generated-missing' | 'resign-missing' | 'signature-invalid';
  detail: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface ManifestOptions {
  /** `prod`: the manifest is a production-environment output, so it must be re-signed whatever its licence status says (M05c3). */
  env?: 'prod' | 'staging';
}

export function manifestFindings(key: string, manifest: unknown, opts: ManifestOptions = {}): C2paFinding[] {
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
  if ((licence['status'] === 'cleared' || opts.env === 'prod') && prov['resigned'] !== true) {
    out.push({
      key,
      rule: 'resign-missing',
      detail: `${opts.env === 'prod' ? 'a production manifest' : 'a cleared licence'} needs provenance.resigned: true (renditions re-signed with our C2PA claim)`,
    });
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

export function checkAll(index: unknown, readManifest: (key: string) => unknown, opts: ManifestOptions = {}): { count: number; findings: C2paFinding[] } {
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
    findings.push(...manifestFindings(key, manifest, opts));
  }
  return { count: keys.length, findings };
}

/** The renditions a manifest names (`renditions.*.file`), in key order. */
export function renditionFiles(manifest: unknown): string[] {
  if (!isRecord(manifest) || !isRecord(manifest['renditions'])) return [];
  return Object.values(manifest['renditions']).flatMap((r) => (isRecord(r) && typeof r['file'] === 'string' ? [r['file']] : []));
}

/**
 * `--verify-signatures`: the claim of every rendition file beside its manifest. `mod` is the pinned reader (a test passes its own).
 * A manifest that cannot be read is already a `manifest-missing` finding of `checkAll`, so it is skipped here.
 */
export async function verifySignatures(
  index: unknown,
  manifestsDir: string,
  readManifest: (key: string) => unknown,
  mod?: C2paModuleLike,
): Promise<C2paFinding[]> {
  const findings: C2paFinding[] = [];
  const reader = mod ?? (await loadC2pa());
  for (const key of [...new Set(indexKeys(index))]) {
    let manifest: unknown;
    try {
      manifest = readManifest(key);
    } catch {
      continue;
    }
    const files = renditionFiles(manifest);
    if (files.length === 0) findings.push({ key, rule: 'signature-invalid', detail: 'the manifest names no rendition to verify' });
    for (const file of files) {
      const full = path.join(manifestsDir, key, file);
      if (!existsSync(full)) {
        findings.push({ key, rule: 'signature-invalid', detail: `${file}: the rendition file is missing beside the manifest` });
        continue;
      }
      const problems = signatureProblems(await inspectSignature(reader, full, 'video/mp4'));
      for (const p of problems) findings.push({ key, rule: 'signature-invalid', detail: `${file}: ${p}` });
    }
  }
  return findings;
}

const FIXTURES_DIR = 'tools/ci/fixtures/c2pa';

interface Expectations {
  fixtures: { manifest: string; env?: 'prod' | 'staging'; expect: C2paFinding['rule'][] }[];
}

/**
 * The rules checked against committed fixtures (M05c3 AC-6): the output of the mock prewarm (fixture renditions re-signed once
 * with the pinned C2PA tool) passes as a production manifest; a production manifest with `resigned: false` and one without
 * `aiGenerated` each trip exactly the rule named in `expectations.json`. Returns the problems with the expectations themselves.
 */
export function selfTest(root: string = repoRoot): { problems: string[]; checked: number } {
  const dir = path.join(root, FIXTURES_DIR);
  const file = path.join(dir, 'expectations.json');
  if (!existsSync(file)) return { problems: [], checked: 0 };
  const exp = JSON.parse(readFileSync(file, 'utf8')) as Expectations;
  const problems: string[] = [];
  for (const f of exp.fixtures) {
    const manifest: unknown = JSON.parse(readFileSync(path.join(dir, 'manifests', f.manifest, 'manifest.json'), 'utf8'));
    const got = manifestFindings(f.manifest, manifest, f.env ? { env: f.env } : {}).map((x) => x.rule).sort();
    const want = [...f.expect].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`fixture ${f.manifest}: expected [${want.join(', ')}], got [${got.join(', ')}]`);
  }
  return { problems, checked: exp.fixtures.length };
}

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { index: { type: 'string' }, manifests: { type: 'string' }, env: { type: 'string' }, 'verify-signatures': { type: 'boolean', default: false } },
    allowPositionals: true,
  });
  if (values.env !== undefined && values.env !== 'prod' && values.env !== 'staging') {
    console.error('check:c2pa: --env must be prod or staging');
    return 2;
  }
  const opts: ManifestOptions = values.env ? { env: values.env } : {};
  // The fixture self-test runs on the default invocation; an explicit --index or --manifests checks only what it names.
  const explicit = values.index !== undefined || values.manifests !== undefined;
  if (!explicit) {
    const st = selfTest();
    if (st.problems.length > 0) {
      for (const p of st.problems) console.error(`check:c2pa FAIL ${p}`);
      return 1;
    }
    if (st.checked > 0) console.log(`check:c2pa fixtures ok: ${st.checked} (the mock prewarm output passes; an unsigned production manifest and one without aiGenerated fail)`);
  }
  const explicitIndex = values.index !== undefined;
  const indexPath = path.resolve(repoRoot, values.index ?? 'content/cutscenes/cutscene-index.json');
  const manifestsDir = path.resolve(repoRoot, values.manifests ?? 'assets/cutscenes');
  if (!existsSync(indexPath)) {
    if (explicitIndex) {
      console.error(`check:c2pa FAIL the index ${values.index} does not exist`);
      return 1;
    }
    console.log('check:c2pa: 0 shipped cutscenes (no cutscene index yet; M05b2 writes it)');
    return 0;
  }
  const index: unknown = JSON.parse(readFileSync(indexPath, 'utf8'));
  const readManifest = (key: string): unknown => JSON.parse(readFileSync(path.join(manifestsDir, key, 'manifest.json'), 'utf8'));
  const { count, findings } = checkAll(index, readManifest, opts);
  if (count === 0) {
    if (explicitIndex) {
      console.error(`check:c2pa FAIL the index ${values.index} has no entries`);
      return 1;
    }
    console.log('check:c2pa: 0 shipped cutscenes (the index has no entries)');
    return 0;
  }
  if (values['verify-signatures']) findings.push(...(await verifySignatures(index, manifestsDir, readManifest)));
  for (const f of findings) console.error(`check:c2pa FAIL ${f.key.slice(0, 12)} ${f.rule}: ${f.detail}`);
  if (findings.length > 0) return 1;
  console.log(`check:c2pa ok: ${count} shipped cutscene(s)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(args()).then((c) => process.exit(c), (e: unknown) => {
  console.error(e);
  process.exit(1);
});
