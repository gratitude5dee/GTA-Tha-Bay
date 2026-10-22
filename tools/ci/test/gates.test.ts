/**
 * Gate tests for M00b (AC-2 ... AC-7). Every foreign-format byte sequence and every denylisted string is built at
 * run time from config/ip-denylist.json into a temp directory: the repository never contains them.
 */
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRAND } from '../../../config/brand.ts';
import type { IpDenylistConfig } from '../../../packages/shared/src/assets/gates/ip.ts';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { runIpScan } from '../ip-scan.ts';
import { runLicenseScan } from '../license-scan.ts';
import { runLikenessGate } from '../likeness-gate.ts';
import { runNamesLint } from '../names-lint.ts';
import { runProvenanceCheck } from '../provenance-check.ts';
import { writeThirdPartyLicences } from '../third-party-licenses.ts';
import { readJson, toolsRoot } from '../lib/common.ts';
import { lintTemplates, templateFiles } from '../prompt-lint.ts';

const cfg = readJson<IpDenylistConfig>(path.join(toolsRoot, 'config/ip-denylist.json'));
const TERM = cfg.terms[0] as string; // first seed term
const WORD = cfg.words[0] as string;
const FACE = cfg.faceDetectorTerms[1] as string;
const NEEDLE = cfg.wasmNameNeedles[0] as string;

let base: string;
beforeAll(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'dv-gates-'));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

let counter = 0;
/** A fresh temp repository root with the real config directory copied in. */
function tempRoot(): string {
  const root = path.join(base, `r${counter++}`);
  mkdirSync(root, { recursive: true });
  cpSync(path.join(toolsRoot, 'config'), path.join(root, 'config'), { recursive: true });
  return root;
}
function put(root: string, rel: string, data: string | Uint8Array): void {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, data);
}
const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const rules = (f: { rule: string }[]): string[] => f.map((x) => x.rule);
const files = (f: { file: string }[]): string[] => f.map((x) => x.file);

function record(bytes: Uint8Array | string, over: Partial<ProvenanceRecord> = {}, rel = 'a.png'): ProvenanceRecord {
  return {
    schema: 'provenance/1.0',
    sha256: sha(bytes),
    paths: [rel],
    kind: 'ui',
    origin: 'authored',
    license: 'LicenseRef-DeeVerse-Owned',
    authors: ['studio:dee-verse'],
    derived_from: [],
    review: [],
    ip_checks: { signatures: 'pass', strings: 'n/a', similarity: 'n/a' },
    ai_generated: false,
    status: 'active',
    created_at: '2026-10-18T00:00:00Z',
    ...over,
  };
}
function putRecord(root: string, rec: ProvenanceRecord): void {
  put(root, `assets/provenance/${rec.sha256.slice(0, 2)}/${rec.sha256}.json`, `${JSON.stringify(rec, null, 2)}\n`);
}
const generator = (env: 'production' | 'previs' | 'test'): NonNullable<ProvenanceRecord['generator']> => ({
  vendor: 'fal',
  endpoint: 'meshy/v7.1/multi-image-to-3d',
  endpoint_registry_key: 'meshy/v7.1/multi-image-to-3d',
  endpoint_updated_at: null,
  request_id: 'req-1',
  job_key: sha('job'),
  params_sha256: sha('params'),
  prompt_template: 'p@1',
  prompt_sha256: sha('prompt'),
  input_refs: [],
  terms_snapshot: { path: 'docs/legal/vendor-terms/fal-tos-2026-10-18.md', sha256: sha('t'), checked_at: '2026-10-18' },
  generated_at: '2026-10-18T00:00:00Z',
  executor: 'workflow',
  env,
});

function provenance(root: string): ReturnType<typeof runProvenanceCheck> {
  return runProvenanceCheck({ root, dist: path.join(root, 'dist') });
}

describe('provenance gate (AC-2)', () => {
  it('passes a shipped file with a valid record', () => {
    const root = tempRoot();
    const bytes = randomBytes(64);
    put(root, 'dist/a.png', bytes);
    putRecord(root, record(bytes));
    expect(provenance(root).findings).toEqual([]);
  });

  it('does not require records for code and delivery files', () => {
    const root = tempRoot();
    for (const f of ['index.html', 'assets/x.js', 'assets/x.css', 'sw.js', 'manifest.webmanifest', '_headers', 'assets/x.js.map']) put(root, `dist/${f}`, 'x');
    expect(provenance(root).findings).toEqual([]);
  });

  it('reports a file without a record', () => {
    const root = tempRoot();
    put(root, 'dist/b.png', randomBytes(32));
    const res = provenance(root);
    expect(rules(res.findings)).toEqual(['no-record']);
    expect(files(res.findings)).toEqual(['b.png']);
  });

  it('reports identical bytes shipped under a name the record does not list', () => {
    const root = tempRoot();
    const bytes = randomBytes(32);
    put(root, 'dist/a.png', bytes);
    put(root, 'dist/copy/a2.png', bytes);
    putRecord(root, record(bytes, {}, 'art/a.png'));
    const res = provenance(root);
    expect(files(res.findings)).toEqual(['copy/a2.png']);
    expect(rules(res.findings)).toEqual(['path-not-recorded']);
  });

  it('matches a C07 object key to its record by hash (the record lists the source path)', () => {
    const root = tempRoot();
    const bytes = randomBytes(48);
    const h = sha(bytes);
    put(root, `dist/assets/data/smoke/default.${h.slice(0, 12)}.json`, bytes);
    putRecord(root, record(bytes, {}, 'assets/src/data/smoke/smoke.json'));
    expect(provenance(root).findings).toEqual([]);
  });

  it('still reports a copy whose name only imitates an object key (wrong hash fragment)', () => {
    const root = tempRoot();
    const bytes = randomBytes(48);
    put(root, 'dist/assets/data/smoke/default.000000000000.json', bytes);
    putRecord(root, record(bytes, {}, 'assets/src/data/smoke/smoke.json'));
    expect(rules(provenance(root).findings)).toEqual(['path-not-recorded']);
  });

  it('treats media-local/ as the QA-only mirror: derived catalogs and blobs need no record of their own', () => {
    const root = tempRoot();
    const blob = randomBytes(40);
    const manifest = Buffer.from('{"schema":"asset-manifest/1"}');
    put(root, `dist/media-local/assets/texture/x/desktop.${sha(blob).slice(0, 12)}.png`, blob);
    put(root, `dist/media-local/manifests/assets-${sha(manifest)}.json`, manifest);
    put(root, 'dist/media-local/asset-catalog.json', '{}');
    expect(provenance(root).findings).toEqual([]);
  });

  it('does not extend the media-local exemption to other dist paths', () => {
    const root = tempRoot();
    const manifest = Buffer.from('{"schema":"asset-manifest/1"}');
    put(root, 'dist/manifests/assets-x.json', manifest);
    put(root, 'dist/assets/texture/x/desktop.000000000000.png', randomBytes(40));
    const res = provenance(root);
    expect(files(res.findings).sort()).toEqual(['assets/texture/x/desktop.000000000000.png', 'manifests/assets-x.json']);
    expect(rules(res.findings)).toEqual(['no-record', 'no-record']);
  });

  it('reports a record with a copyleft licence', () => {
    const root = tempRoot();
    const bytes = randomBytes(32);
    put(root, 'dist/a.png', bytes);
    putRecord(root, record(bytes, { license: 'GPL-3.0-only' }));
    expect(rules(provenance(root).findings)).toContain('license-not-allowed');
  });

  it('reports generator.env other than production', () => {
    const root = tempRoot();
    const bytes = randomBytes(32);
    put(root, 'dist/a.png', bytes);
    putRecord(root, record(bytes, { origin: 'generated', ai_generated: true, generator: generator('test') }));
    expect(rules(provenance(root).findings)).toEqual(['env-not-production']);
    const ok = tempRoot();
    put(ok, 'dist/a.png', bytes);
    putRecord(ok, record(bytes, { origin: 'generated', ai_generated: true, generator: generator('production') }));
    expect(provenance(ok).findings).toEqual([]);
  });

  it('reports a derived_from cycle', () => {
    const root = tempRoot();
    const a = randomBytes(16);
    const b = randomBytes(16);
    const tool = { name: 't', version: '1', args_sha256: sha('x') };
    put(root, 'dist/a.png', a);
    putRecord(root, record(a, { origin: 'derived', tool, derived_from: [sha(b)] }));
    putRecord(root, record(b, { origin: 'derived', tool, derived_from: [sha(a)] }, 'b.png'));
    expect(rules(provenance(root).findings)).toContain('derivation-cycle');
  });

  it('reports an unrooted derivation chain', () => {
    const root = tempRoot();
    const a = randomBytes(16);
    put(root, 'dist/a.png', a);
    putRecord(root, record(a, { origin: 'derived', tool: { name: 't', version: '1', args_sha256: sha('x') }, derived_from: [sha('missing parent')] }));
    expect(rules(provenance(root).findings)).toEqual(['derivation-unrooted']);
  });

  it('reports an open_data record without attribution', () => {
    const root = tempRoot();
    const bytes = randomBytes(32);
    put(root, 'dist/a.png', bytes);
    putRecord(root, record(bytes, { origin: 'open_data', license: 'ODbL-1.0', source: { url: null, dataset_id: 'd', retrieved: '2026-10-18' } }));
    const r = rules(provenance(root).findings);
    expect(r).toContain('attribution-missing');
    expect(r).toContain('schema');
  });

  it('reports placeholder tags only in release mode', () => {
    const root = tempRoot();
    const bytes = randomBytes(32);
    put(root, 'dist/placeholder-a.png', bytes);
    putRecord(root, record(bytes, {}, 'art/placeholder-a.png'));
    expect(provenance(root).findings).toEqual([]);
    expect(rules(runProvenanceCheck({ root, dist: path.join(root, 'dist'), release: true }).findings)).toEqual(['placeholder-tag']);
  });

  it('walks assets/world/*.lock.json: a world lock whose pack sha256 has no record fails with no-record (DL-667)', () => {
    const root = tempRoot();
    const pack = randomBytes(24);
    put(root, 'assets/world/sf.lock.json', JSON.stringify({ schema: 'asset-lock/1', entries: { 'world_pack/p0-1-1': { rev: 1, variants: { default: sha(pack) }, root: sha(pack), approved_by: 't', approved_at: '2026-10-19T00:00:00Z' } } }));
    const res = provenance(root);
    expect(rules(res.findings)).toEqual(['no-record']);
    expect(files(res.findings)).toEqual(['assets/world/sf.lock.json']);
  });

  it('passes a world lock whose pack and source-stamp records are present and allowlisted', () => {
    const root = tempRoot();
    const stamp = randomBytes(24);
    const pack = randomBytes(24);
    putRecord(root, record(stamp, { origin: 'open_data', license: 'PDDL-1.0', attribution: 'City and County of San Francisco', source: { url: 'https://data.sf.gov/resource/ynuv-fyni.json', dataset_id: 'ynuv-fyni', retrieved: '2026-10-19T00:00:00Z' } }, 'raw/sf/ynuv-fyni.jsonl'));
    putRecord(root, record(pack, { origin: 'derived', kind: 'world_pack', license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', derived_from: [sha(stamp)], tool: { name: 'tools/map', version: '0.2.0', args_sha256: sha('x') } }, 'assets/world_pack/p0-1-1/default.pack'));
    put(root, 'assets/world/sf.lock.json', JSON.stringify({ schema: 'asset-lock/1', entries: { 'world_pack/p0-1-1': { rev: 1, variants: { default: sha(pack) }, root: sha(stamp), approved_by: 't', approved_at: '2026-10-19T00:00:00Z' } } }));
    expect(provenance(root).findings).toEqual([]);
  });

  it('fails a world lock whose source stamp record has a licence missing from the allowlist with license-not-allowed (DL-667)', () => {
    const root = tempRoot();
    const stamp = randomBytes(24);
    const pack = randomBytes(24);
    putRecord(root, record(stamp, { origin: 'open_data', license: 'LicenseRef-Unlisted-Source', attribution: 'Somebody', source: { url: null, dataset_id: 'd', retrieved: '2026-10-19T00:00:00Z' } }, 'raw/sf/x.jsonl'));
    putRecord(root, record(pack, { origin: 'derived', kind: 'world_pack', license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', derived_from: [sha(stamp)], tool: { name: 'tools/map', version: '0.2.0', args_sha256: sha('x') } }, 'assets/world_pack/p0-1-1/default.pack'));
    put(root, 'assets/world/sf.lock.json', JSON.stringify({ schema: 'asset-lock/1', entries: { 'world_pack/p0-1-1': { rev: 1, variants: { default: sha(pack) }, root: sha(stamp), approved_by: 't', approved_at: '2026-10-19T00:00:00Z' } } }));
    expect(rules(provenance(root).findings)).toEqual(['license-not-allowed']);
  });

  it('flags a world pack whose stamp record is missing (derivation-unrooted) and passes the repository own tree', () => {
    const root = tempRoot();
    const pack = randomBytes(24);
    putRecord(root, record(pack, { origin: 'derived', kind: 'world_pack', license: 'ODbL-1.0', attribution: 'x', derived_from: [sha('missing stamp')], tool: { name: 'tools/map', version: '0.2.0', args_sha256: sha('x') } }, 'a'));
    put(root, 'assets/world/sf.lock.json', JSON.stringify({ schema: 'asset-lock/1', entries: { 'world_pack/p0-1-1': { rev: 1, variants: { default: sha(pack) }, root: sha(pack), approved_by: 't', approved_at: '2026-10-19T00:00:00Z' } } }));
    expect(rules(provenance(root).findings)).toEqual(['derivation-unrooted']);
    const dist = mkdtempSync(path.join(os.tmpdir(), 'dv-prov-dist-'));
    writeThirdPartyLicences(toolsRoot, path.join(dist, 'third-party-licenses.txt')); // as pnpm build does (M00f item 1)
    expect(runProvenanceCheck({ root: toolsRoot, dist, emitCredits: true }).findings).toEqual([]);
    rmSync(dist, { recursive: true, force: true });
  });

  it('requires attributions in credits.json and can emit it', () => {
    const root = tempRoot();
    const bytes = randomBytes(32);
    put(root, 'dist/a.png', bytes);
    putRecord(root, record(bytes, { origin: 'open_data', license: 'ODbL-1.0', attribution: 'Map data contributors', source: { url: null, dataset_id: 'd', retrieved: '2026-10-18' } }));
    expect(rules(provenance(root).findings)).toEqual(['attribution-not-in-credits']);
    expect(runProvenanceCheck({ root, dist: path.join(root, 'dist'), emitCredits: true }).findings).toEqual([]);
  });
});

describe('ip:signatures and ip:extensions (AC-3)', () => {
  it('reports every foreign format and denylisted extension', () => {
    const root = tempRoot();
    const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
    put(root, 'blobs/a1.blob', Uint8Array.from([0x37, 0x46, 0x50, 0x52, 1, 2, 3, 4]));
    put(root, 'blobs/a2.blob', Uint8Array.from([0x52, 0x53, 0x43, 0x37, 1, 2, 3, 4]));
    put(root, 'blobs/a3.blob', Uint8Array.from([0x32, 0x54, 0x58, 0x47, 1, 2, 3, 4]));
    put(root, 'blobs/shader.bin', Uint8Array.from([9, 9, 0x44, 0x58, 0x42, 0x43, 9]));
    const payload = [...ascii('x'), ...ascii(NEEDLE), 0, 1];
    const section = [4, ...ascii('name'), ...payload];
    put(root, 'blobs/mod.wasm', Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0, section.length, ...section]));
    put(root, 'blobs/pack.zip', Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0, ...ascii('assembly.xml'), 0]));
    put(root, 'blobs/clump.dff', Uint8Array.from([0x10, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0x03, 0x18, 1, 2, 3, 4]));
    put(root, 'blobs/archive.blob', Uint8Array.from([0x56, 0x45, 0x52, 0x32, 0, 0, 0, 0]));
    put(root, 'blobs/x.rpf', 'plain');
    put(root, 'blobs/y.ytd', 'plain');
    put(root, 'blobs/clean.bin', Uint8Array.from([1, 2, 3, 4]));
    put(root, 'blobs/clean.wasm', Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    const sig = runIpScan({ root, dist: path.join(root, 'dist'), modes: ['signatures'] });
    expect(new Set(files(sig.findings))).toEqual(
      new Set(['blobs/a1.blob', 'blobs/a2.blob', 'blobs/a3.blob', 'blobs/shader.bin', 'blobs/mod.wasm', 'blobs/pack.zip', 'blobs/clump.dff', 'blobs/archive.blob']),
    );
    expect(new Set(rules(sig.findings))).toEqual(
      new Set(['sig-rpf7', 'sig-rsc7', 'sig-gxt2', 'sig-dxbc', 'sig-wasm-name', 'sig-oiv-package', 'sig-renderware', 'sig-img-v2']),
    );
    const ext = runIpScan({ root, dist: path.join(root, 'dist'), modes: ['extensions'] });
    expect(files(ext.findings).sort()).toEqual(['blobs/clump.dff', 'blobs/x.rpf', 'blobs/y.ytd']);
  });

  it('scans dist too and treats .dat as denylisted only for data tables', () => {
    const root = tempRoot();
    put(root, 'dist/lib.wasm', Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    put(root, 'dist/x.bin', Uint8Array.from([0x37, 0x46, 0x50, 0x52]));
    put(root, 'notes/readme.dat', 'hello');
    put(root, 'data/table.dat', `${cfg.datHeaderTerms[0]} table\n`);
    put(root, 'data/other.dat', 'something else');
    const res = runIpScan({ root, dist: path.join(root, 'dist'), modes: ['signatures', 'extensions'] });
    expect(files(res.findings).sort()).toEqual(['data/table.dat', 'dist/x.bin']);
  });
});

describe('ip:strings (AC-4)', () => {
  it('reports source files, skips allowlisted paths, honours the disclaimer exception', () => {
    const root = tempRoot();
    put(root, 'packages/ui/src/a.ts', `// ${TERM} reference\n`);
    put(root, 'spec/note.md', `${TERM}\n`);
    put(root, 'docs/research/note.md', `${TERM}\n`);
    put(root, 'docs/legal/vendor-terms/x.md', `${TERM}\n`);
    put(root, 'packages/ui/src/ok.ts', `export const d = '${BRAND.disclaimer}';\n`);
    put(root, 'packages/ui/src/bad.ts', `export const d = 'Thanks to ${TERM} Games for nothing.';\n`);
    put(root, 'packages/ui/src/word.ts', `const make = '${WORD}';\n`);
    put(root, 'packages/ui/src/fine.ts', `const make = '${WORD}ly different';\n`);
    const res = runIpScan({ root, dist: path.join(root, 'dist'), modes: ['strings'] });
    expect(new Set(files(res.findings))).toEqual(new Set(['packages/ui/src/a.ts', 'packages/ui/src/bad.ts', 'packages/ui/src/word.ts']));
  });

  it('reports the real transit brand words in any letter case outside spec/, and only as whole words (M03b2 AC-10, DL-664)', () => {
    const root = tempRoot();
    // built from parts so this file itself passes ip:strings (the words are denylisted repo-wide)
    const words = ['BA' + 'RT', 'Mu' + 'ni', 'Cal' + 'train', 'ba' + 'rt', 'MU' + 'NI', 'caL' + 'train'];
    for (const w of words) put(root, `packages/ui/src/t-${w}.ts`, `export const n = '${w} line';\n`);
    put(root, 'spec/transit.md', words.slice(0, 3).join(' ') + '\n');
    put(root, 'packages/ui/src/fine.ts', 'export const n = ' + JSON.stringify('a municipal bartender, caltrains') + ';\n');
    put(root, 'packages/ui/src/id.ts', 'export const id = ' + JSON.stringify('lm.rail-terminus sfmta-stops sfmta-patterns') + ';\n');
    const res = runIpScan({ root, dist: path.join(root, 'dist'), modes: ['strings'] });
    expect(new Set(files(res.findings))).toEqual(new Set(words.map((w) => `packages/ui/src/t-${w}.ts`)));
  });

  it('skips base64 runs and data URLs in dist, but not ordinary text', () => {
    const root = tempRoot();
    const blob = randomBytes(3 * 1024 * 1024).toString('base64');
    put(root, 'dist/assets/big.js', `var w="${blob.slice(0, 5000)}${TERM}${blob.slice(5000)}";`);
    put(root, 'dist/assets/data.css', `a{background:url(data:image/png;base64,AAAA${TERM}BBBB)}`);
    put(root, 'dist/assets/ok.js', `var d="${BRAND.disclaimer}";`);
    expect(runIpScan({ root, dist: path.join(root, 'dist'), modes: ['strings'] }).findings).toEqual([]);
    put(root, 'dist/assets/bad.js', `var d="plain ${TERM} text";`);
    expect(files(runIpScan({ root, dist: path.join(root, 'dist'), modes: ['strings'] }).findings)).toEqual(['dist/assets/bad.js']);
  });

  it('reports matches in the franchise acronym pattern on word boundaries only', () => {
    const root = tempRoot();
    const acro = ['g', 't', 'a'].join('');
    put(root, 'packages/ui/src/p.ts', `const x = '${acro} style';\n`);
    put(root, 'packages/ui/src/q.ts', `const x = 'mega${acro}byte';\n`);
    const res = runIpScan({ root, dist: path.join(root, 'dist'), modes: ['strings'] });
    expect(files(res.findings)).toEqual(['packages/ui/src/p.ts']);
  });
});

describe('license:scan (AC-5)', () => {
  const policyFiles = (root: string): void => {
    put(root, 'REUSE.toml', 'version = 1\n\n[[annotations]]\npath = ["src/**", "config/**", "*"]\nSPDX-FileCopyrightText = "x"\nSPDX-License-Identifier = "LicenseRef-DeeVerse-Owned"\n');
    put(root, 'LICENSES/LicenseRef-DeeVerse-Owned.txt', 'text');
  };

  it('reports a copyleft dependency and an uncovered first-party file', () => {
    const root = tempRoot();
    policyFiles(root);
    put(root, 'src/a.ts', 'export {};\n');
    put(root, 'other/b.ts', 'export {};\n');
    put(root, 'other/c.ts', '// SPDX-License-Identifier: MIT\nexport {};\n');
    const res = runLicenseScan({
      root,
      deps: [
        { name: 'copyleft-lib', version: '1.0.0', license: 'AGPL-3.0-only' },
        { name: 'fine-lib', version: '1.0.0', license: 'MIT' },
        { name: 'odd-lib', version: '1.0.0', license: 'SSPL-1.0' },
        { name: 'bitecs', version: '0.4.0', license: 'MPL-2.0' },
        { name: '@dv/shared', version: 'workspace:*', license: 'UNKNOWN' },
      ],
    });
    expect(res.findings.map((f) => `${f.file}:${f.rule}`).sort()).toEqual([
      'copyleft-lib@1.0.0:license-copyleft',
      'odd-lib@1.0.0:license-not-allowed',
      'other/b.ts:no-license-coverage',
    ]);
  });

  it('lets a copyleft package through only with an ADR id', () => {
    const root = tempRoot();
    policyFiles(root);
    const lic = readJson<{ exceptions: unknown[] }>(path.join(root, 'config/license-allowlist.json'));
    lic.exceptions.push({ package: 'copyleft-lib', license: 'LGPL-3.0-only', scope: 'prod', reason: 'dynamic link', adr: 'ADR-9999' });
    put(root, 'config/license-allowlist.json', JSON.stringify(lic));
    const res = runLicenseScan({ root, deps: [{ name: 'copyleft-lib', version: '1.0.0', license: 'LGPL-3.0-only' }] });
    // M00b's dependency judgement still lets the ADR id through; the M00f rule (DL-634) refuses any GPL-family
    // exception entry whatever ADR id it carries (BD-M00f-02).
    expect(res.findings.map((f) => f.rule)).toEqual(['gpl-exception']);
  });
});

describe('names:lint (AC-6)', () => {
  const realFixture = { schema: 'names/1' as const, entries: [{ id: 'r1', real: 'Zed Fixturename', aliases: ['Fixy Z'] }] };

  it('reports the display literal, a close display name and a real-side string', () => {
    const root = tempRoot();
    put(root, 'packages/ui/src/title.ts', `export const t = '${BRAND.displayName}';\n`);
    put(root, 'packages/ui/src/notes.md', `${BRAND.displayName}\n`);
    put(root, 'config/names.json', JSON.stringify({ schema: 'names/1', entries: [{ id: 'd1', display: 'Zed Fixturenaim' }, { id: 'd2', display: 'Completely Different' }] }));
    put(root, 'content/line.json', JSON.stringify({ text: 'ask zed fixturename about it' }));
    put(root, 'content/fine.json', JSON.stringify({ text: 'zed fixturenamed is a different word' }));
    const res = runNamesLint({ root, dist: path.join(root, 'dist'), real: realFixture });
    expect(res.findings.map((f) => `${f.file}:${f.rule}`).sort()).toEqual([
      'content/line.json:real-name-in-client',
      'names:d1:name-distance',
      'packages/ui/src/title.ts:display-name-literal',
    ]);
  });

  it('exempts config/brand.ts and tolerates the bundle disclaimer only as the exact sentence', () => {
    const root = tempRoot();
    put(root, 'config/brand.ts', `export const n = '${BRAND.displayName}';\n`);
    put(root, 'dist/assets/ok.js', `var d="${BRAND.disclaimer}";`);
    expect(runNamesLint({ root, dist: path.join(root, 'dist') }).findings).toEqual([]);
    put(root, 'dist/assets/bad.js', `var d="Made with help from ${TERM} Games.";`);
    expect(runNamesLint({ root, dist: path.join(root, 'dist') }).findings.map((f) => `${f.file}:${f.rule}`)).toEqual(['dist/assets/bad.js:shipped-name']);
  });

  it('skips the real side without the secret and says so', () => {
    const root = tempRoot();
    const res = runNamesLint({ root, dist: path.join(root, 'dist'), real: null });
    expect(res.findings).toEqual([]);
    expect(res.notes).toEqual(['real-side: skipped (DV_NAMES_REAL_JSON not set)']);
  });
});

describe('likeness:gate (AC-7)', () => {
  it('reports tier violations, expired consent and face-detector strings', () => {
    const root = tempRoot();
    const likeness = (over: Record<string, unknown>): NonNullable<ProvenanceRecord['likeness']> =>
      ({ subject_id: 'subj_1', tier: 'parody', face_reference_used: false, voice_mode: 'none', photoreal: false, ...over }) as NonNullable<ProvenanceRecord['likeness']>;
    const mk = (n: string, l: NonNullable<ProvenanceRecord['likeness']>): void => putRecord(root, record(n, { kind: 'character', likeness: l }, `${n}.glb`));
    mk('face', likeness({ face_reference_used: true }));
    mk('nocons', likeness({ tier: 'consented', voice_mode: 'consented_clone' }));
    mk('expired', likeness({ tier: 'consented', voice_mode: 'consented_clone', consent_record_id: 'c1', consent_scopes_used: ['face'] }));
    mk('scope', likeness({ tier: 'consented', consent_record_id: 'c2', consent_scopes_used: ['voice'] }));
    mk('good', likeness({ tier: 'consented', consent_record_id: 'c2', consent_scopes_used: ['face'] }));
    mk('clone', likeness({ voice_mode: 'consented_clone' }));
    mk('photo', likeness({ photoreal: true }));
    putRecord(root, record('nolik', { kind: 'voice' }, 'v.opus'));
    put(
      root,
      'config/consent-index.json',
      JSON.stringify({
        schema: 'consent-index/1',
        entries: [
          { id: 'c1', subject_id: 'subj_1', scopes: ['face', 'voice'], term_end: '2026-01-01T00:00:00Z' },
          { id: 'c2', subject_id: 'subj_1', scopes: ['face'], term_end: null },
        ],
      }),
    );
    put(root, 'packages/ui/src/cam.ts', `const m = '${FACE}';\n`);
    put(root, 'spec/allowed.md', FACE);
    const res = runLikenessGate({ root, dist: path.join(root, 'dist'), now: '2026-10-18T00:00:00Z' });
    expect(res.findings.map((f) => `${f.rule}`).sort()).toEqual(
      ['face-detector', 'likeness-consent-expired', 'likeness-consent-missing', 'likeness-face-ref', 'likeness-missing', 'likeness-photoreal', 'likeness-scope', 'likeness-voice-mode'].sort(),
    );
  });
});

describe('prompt-lint CLI (M05b2 AC-4)', () => {
  const TEMPLATE = (over: { body?: string; pin?: string; slots?: string } = {}): string => `---
id: t
version: 1
hook: story.beat
recipe: K
style: bay-cel@1
keyframePin: ${over.pin ?? 'openai/gpt-image-2.5/sunburst/edit@unpinned'}
shots: [{ durationS: 7, camera: push-in }]
aspect: '16:9'
resolution: 768P
audio: engine
slots: [${over.slots ?? 'style_tokens, place_desc'}]
---
${over.body ?? '{style_tokens}. {place_desc}. No text, no letters, no logos.'}
`;
  const lintRoot = (root: string, env: NodeJS.ProcessEnv = {}) => lintTemplates(root, templateFiles(root), env);

  it('passes the two story templates of the repository and prints the real-side SKIP line without DV_NAMES_REAL_JSON', () => {
    const res = lintTemplates(toolsRoot, templateFiles(toolsRoot), {});
    expect(templateFiles(toolsRoot).map((f) => path.basename(f))).toEqual(['story.beat@1.md', 'story.establish@1.md']);
    expect(res.findings).toEqual([]);
    expect(res.notes).toContain('SKIP prompt-lint real-side names: DV_NAMES_REAL_JSON not set');
  });

  it('fails each fixture with its rule number', () => {
    const cases: [string, Parameters<typeof TEMPLATE>[0], string][] = [
      ['banned vocabulary', { body: '{style_tokens}. {place_desc}. A pistol. No text, no logos.' }, 'rule-2'],
      ['a denylisted term', { body: `{style_tokens}. {place_desc}. Like ${TERM}. No text, no logos.` }, 'rule-1'],
      ['realism tokens', { body: '{style_tokens}. {place_desc}. Photorealistic. No text, no logos.' }, 'rule-3'],
      ['the missing clause', { body: '{style_tokens}. {place_desc}.' }, 'rule-5'],
      ['an unknown slot', { body: '{style_tokens}. {place_desc}. {secret}. No text, no logos.', slots: 'style_tokens, place_desc, secret' }, 'rule-4'],
      ['a keyframePin that differs from the registry', { pin: 'openai/gpt-image-2.5/sunburst/edit@2020-01-01' }, 'rule-6'],
    ];
    for (const [name, over, rule] of cases) {
      const root = tempRoot();
      put(root, 'content/prompts/genai/t@1.md', TEMPLATE(over));
      expect(rules(lintRoot(root).findings), name).toContain(rule);
    }
    const ok = tempRoot();
    put(ok, 'content/prompts/genai/t@1.md', TEMPLATE());
    expect(lintRoot(ok).findings).toEqual([]);
  });

  it('flags frontmatter slots that differ from the body', () => {
    const root = tempRoot();
    put(root, 'content/prompts/genai/t@1.md', TEMPLATE({ slots: 'style_tokens' }));
    expect(rules(lintRoot(root).findings)).toEqual(['template']);
  });

  it('applies the real-side names from DV_NAMES_REAL_JSON and never prints them', () => {
    const root = tempRoot();
    put(root, 'content/prompts/genai/t@1.md', TEMPLATE({ body: '{style_tokens}. {place_desc}. Zaphod Quillfeather. No text, no logos.' }));
    const real = JSON.stringify({ schema: 'names/1', entries: [{ id: 'x', real: 'Zaphod Quillfeather' }] });
    const res = lintRoot(root, { DV_NAMES_REAL_JSON: real });
    expect(rules(res.findings)).toEqual(['rule-1']);
    expect(JSON.stringify(res)).not.toMatch(/quillfeather/i);
    expect(res.notes).toEqual([]);
  });
});
