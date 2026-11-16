/** M10d0 AC-2: the licensed-art gate (pack register, snapshots, vetting, CC-BY attribution, derived KTX2 roots). */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkDerivedKtx2Roots,
  checkLicensedRecord,
  checkPackRegister,
  TEXTURE_TOOL,
  type ArtPack,
} from '../../../packages/shared/src/assets/gates/provenance.ts';
import { buildArtCredits, ccByAttribution, isCourtesy, parseCcByAttribution } from '../../../packages/shared/src/assets/credits.ts';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { loadPackRegister, snapshotHashes } from '../../assets/src/import/packs.ts';
import { toolsRoot } from '../lib/common.ts';
import { runProvenanceCheck } from '../provenance-check.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const SNAP = sha('snapshot text');
const PACKS: ArtPack[] = [
  { id: 'cc0pack', hosts: ['cc0.example'], spdx: 'CC0-1.0', snapshot: { path: 'docs/legal/licenses/cc0pack.md', sha256: SNAP, retrieved: '2026-10-28' }, courtesy: 'Textures from the CC0 example pack, CC0 1.0.', use: 'import' },
  { id: 'ccbypack', hosts: ['ccby.example'], spdx: 'CC-BY-4.0', snapshot: { path: 'docs/legal/licenses/ccbypack.md', sha256: SNAP, retrieved: '2026-10-28' }, use: 'import' },
];
const GOOD = { cc0pack: SNAP, ccbypack: SNAP };
const APPROVE = { gate: 'art-vetting', by: 'profile:reviewer', at: '2026-10-28T00:00:00Z', decision: 'approve' as const };
const BY_ATTR = ccByAttribution({
  title: 'Weathered Wall',
  author: 'Jane Doe',
  sourceUrl: 'https://ccby.example/items/1',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  changes: 'resized to 1024 px and encoded as KTX2',
});

function rec(over: Partial<ProvenanceRecord> = {}): ProvenanceRecord {
  return {
    schema: 'provenance/1.0',
    sha256: sha(JSON.stringify(over) + 'x'),
    paths: ['content-incoming/x.png'],
    kind: 'texture',
    origin: 'licensed',
    license: 'CC0-1.0',
    authors: ['profile:someone'],
    source: { url: 'https://cc0.example/a/1', dataset_id: null, retrieved: '2026-10-28' },
    derived_from: [],
    review: [APPROVE],
    ip_checks: { signatures: 'pass', strings: 'pass', similarity: 'n/a' },
    ai_generated: false,
    status: 'active',
    created_at: '2026-10-28T00:00:00Z',
    ...over,
  };
}

const rules = (r: ProvenanceRecord, snap: Record<string, string | null> = GOOD): string[] =>
  checkLicensedRecord(r, { packs: PACKS, snapshotSha: snap }).map((f) => f.rule);

describe('checkLicensedRecord', () => {
  it('passes a vetted CC0 record on a known host', () => {
    expect(rules(rec())).toEqual([]);
  });

  it('art-host-unknown: a host in no pack, or no source.url', () => {
    expect(rules(rec({ source: { url: 'https://elsewhere.example/a', dataset_id: null, retrieved: '2026-10-28' } }))).toContain('art-host-unknown');
    const { source: _s, ...noSource } = rec();
    expect(rules(noSource as ProvenanceRecord)).toContain('art-host-unknown');
  });

  it('accepts a subdomain of a pack host', () => {
    expect(rules(rec({ source: { url: 'https://dl.cc0.example/a', dataset_id: null, retrieved: '2026-10-28' } }))).toEqual([]);
  });

  it('art-snapshot-altered and art-snapshot-missing', () => {
    expect(rules(rec(), { ...GOOD, cc0pack: sha('edited') })).toContain('art-snapshot-altered');
    expect(rules(rec(), { ...GOOD, cc0pack: null })).toContain('art-snapshot-missing');
  });

  it('art-licence-restricted: an NC licence, and art-licence-mismatch with the pack licence', () => {
    const r = rules(rec({ license: 'CC-BY-NC-4.0' }));
    expect(r).toContain('art-licence-restricted');
    expect(r).toContain('art-licence-mismatch');
    expect(rules(rec({ license: 'CC-BY-SA-4.0' }))).toContain('art-licence-restricted');
    expect(rules(rec({ license: 'LicenseRef-Editorial-Use' }))).toContain('art-licence-restricted');
    expect(rules(rec({ license: 'CC-BY-4.0' }))).toContain('art-licence-mismatch');
  });

  it('art-vetting-missing: no approval, or only a rejection', () => {
    expect(rules(rec({ review: [] }))).toContain('art-vetting-missing');
    expect(rules(rec({ review: [{ ...APPROVE, decision: 'reject' }] }))).toContain('art-vetting-missing');
    expect(rules(rec({ review: [{ ...APPROVE, gate: 'other' }] }))).toContain('art-vetting-missing');
  });

  it('art-attribution-incomplete: CC-BY without changes:, or without its other fields', () => {
    const ccby = (attribution?: string): ProvenanceRecord =>
      rec({ license: 'CC-BY-4.0', source: { url: 'https://ccby.example/items/1', dataset_id: null, retrieved: '2026-10-28' }, ...(attribution === undefined ? {} : { attribution }) });
    expect(rules(ccby(BY_ATTR))).toEqual([]);
    const noChanges = BY_ATTR.replace(/ Changes:.*$/, '');
    const f = checkLicensedRecord(ccby(noChanges), { packs: PACKS, snapshotSha: GOOD });
    expect(f.map((x) => x.rule)).toEqual(['art-attribution-incomplete']);
    expect(f[0]?.detail).toContain('changes:');
    expect(rules(ccby())).toContain('art-attribution-incomplete');
    expect(rules(ccby('Weathered Wall, CC BY 4.0. Changes: none.'))).toContain('art-attribution-incomplete');
  });

  it('ignores records that are not licensed', () => {
    expect(rules(rec({ origin: 'authored', source: { url: 'https://elsewhere.example', dataset_id: null, retrieved: 'x' }, review: [] }))).toEqual([]);
  });
});

describe('checkPackRegister', () => {
  it('passes when every snapshot matches and reports each altered or missing one', () => {
    expect(checkPackRegister(PACKS, GOOD)).toEqual([]);
    const f = checkPackRegister(PACKS, { cc0pack: sha('other'), ccbypack: null });
    expect(f.map((x) => x.rule)).toEqual(['art-snapshot-altered', 'art-snapshot-missing']);
  });
});

describe('checkDerivedKtx2Roots', () => {
  const root = rec();
  const authoredRoot = rec({ origin: 'authored', license: 'LicenseRef-DeeVerse-Owned', source: undefined as never, review: [] });
  const derived = (parent: ProvenanceRecord, name = TEXTURE_TOOL): ProvenanceRecord =>
    rec({
      sha256: sha(`derived-${parent.sha256}`),
      paths: ['assets/src/texture/pbr.asphalt.albedo/desktop.ktx2'],
      origin: 'derived',
      derived_from: [parent.sha256],
      tool: { name, version: '1', args_sha256: sha('args') },
      review: [],
    });
  it('accepts a licensed root and refuses an authored one', () => {
    expect(checkDerivedKtx2Roots([root, derived(root)])).toEqual([]);
    const f = checkDerivedKtx2Roots([authoredRoot, derived(authoredRoot)]);
    expect(f.map((x) => x.rule)).toEqual(['art-derived-root']);
  });
  it('leaves KTX2 files of other tools alone', () => {
    expect(checkDerivedKtx2Roots([authoredRoot, derived(authoredRoot, 'tools/map')])).toEqual([]);
  });
});

describe('CC-BY attribution and credits', () => {
  it('round-trips the attribution string', () => {
    expect(parseCcByAttribution(BY_ATTR)).toEqual({
      title: 'Weathered Wall',
      author: 'Jane Doe',
      sourceUrl: 'https://ccby.example/items/1',
      licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
      changes: 'resized to 1024 px and encoded as KTX2',
    });
  });
  it('builds one full entry per CC-BY record and one courtesy line per used CC0 pack', () => {
    const a = rec({ license: 'CC-BY-4.0', attribution: BY_ATTR, source: { url: 'https://ccby.example/items/1', dataset_id: null, retrieved: '2026-10-28' } });
    const b = rec({ source: { url: 'https://cc0.example/a/2', dataset_id: null, retrieved: '2026-10-28' } });
    const c = rec({ source: { url: 'https://cc0.example/a/3', dataset_id: null, retrieved: '2026-10-28' } });
    const killed = rec({ status: 'killed', source: { url: 'https://ccby.example/x', dataset_id: null, retrieved: '2026-10-28' }, license: 'CC-BY-4.0', attribution: BY_ATTR });
    const art = buildArtCredits([a, b, c, killed], PACKS);
    expect(art).toHaveLength(2);
    const courtesy = art.filter(isCourtesy);
    expect(courtesy).toEqual([{ pack: 'cc0pack', courtesy: PACKS[0]?.courtesy }]);
    expect(art.find((x) => !isCourtesy(x))).toMatchObject({ pack: 'ccbypack', title: 'Weathered Wall', licence: 'CC-BY-4.0', changes: 'resized to 1024 px and encoded as KTX2' });
  });
});

describe('the repository register', () => {
  it('lists the four packs plus the CC BY text and every snapshot matches its hash (Quaternius flips to import in M10d4)', () => {
    const reg = loadPackRegister(toolsRoot);
    expect(reg.findings).toEqual([]);
    expect(reg.packs.map((p) => p.id)).toEqual(['polyhaven', 'ambientcg', 'quaternius', 'kenney', 'cc-by-4.0']);
    expect(checkPackRegister(reg.packs, snapshotHashes(toolsRoot, reg.packs))).toEqual([]);
    expect(reg.packs.filter((p) => p.use === 'import').map((p) => p.id)).toEqual(['polyhaven', 'ambientcg', 'quaternius']);
  });
});

describe('runProvenanceCheck over a temporary tree', () => {
  function tree(): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'dv-licensed-'));
    dirs.push(root);
    mkdirSync(path.join(root, 'config'), { recursive: true });
    for (const f of ['ip-denylist.json', 'consent-index.json', 'names.json', 'license-allowlist.json', 'genai-endpoints.json']) {
      cpSync(path.join(toolsRoot, 'config', f), path.join(root, 'config', f));
    }
    mkdirSync(path.join(root, 'docs/legal/licenses'), { recursive: true });
    mkdirSync(path.join(root, 'apps/web/dist'), { recursive: true });
    writeFileSync(path.join(root, 'docs/legal/licenses/cc0pack.md'), 'snapshot text');
    writeFileSync(path.join(root, 'docs/legal/licenses/ccbypack.md'), 'snapshot text');
    writeFileSync(path.join(root, 'docs/legal/licenses/packs.json'), JSON.stringify({ schema: 'art-packs/1', packs: PACKS }));
    return root;
  }
  function put(root: string, r: ProvenanceRecord): void {
    const dir = path.join(root, 'assets/provenance', r.sha256.slice(0, 2));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${r.sha256}.json`), JSON.stringify(r));
  }
  const ruleSet = (root: string): string[] => runProvenanceCheck({ root, dist: path.join(root, 'apps/web/dist') }).findings.map((f) => f.rule);

  it('passes a vetted record', () => {
    const root = tree();
    put(root, rec());
    expect(ruleSet(root)).toEqual([]);
  });

  it('fails an unknown host, an altered snapshot, an NC licence, a missing approval and a CC-BY record without changes:', () => {
    const root = tree();
    put(root, rec({ sha256: sha('a'), source: { url: 'https://nowhere.example/a', dataset_id: null, retrieved: '2026-10-28' } }));
    put(root, rec({ sha256: sha('b'), license: 'CC-BY-NC-4.0' }));
    put(root, rec({ sha256: sha('c'), review: [] }));
    put(root, rec({ sha256: sha('d'), license: 'CC-BY-4.0', attribution: BY_ATTR.replace(/ Changes:.*$/, ''), source: { url: 'https://ccby.example/i', dataset_id: null, retrieved: '2026-10-28' } }));
    const got = new Set(ruleSet(root));
    for (const r of ['art-host-unknown', 'art-licence-restricted', 'art-vetting-missing', 'art-attribution-incomplete']) expect(got.has(r)).toBe(true);
    writeFileSync(path.join(root, 'docs/legal/licenses/cc0pack.md'), 'edited snapshot');
    expect(new Set(ruleSet(root)).has('art-snapshot-altered')).toBe(true);
  });

  it('writes the art array into credits.json', () => {
    const root = tree();
    put(root, rec());
    const dist = path.join(root, 'apps/web/dist');
    runProvenanceCheck({ root, dist, emitCredits: true, emitOnly: true });
    const doc = JSON.parse(readFileSync(path.join(dist, 'credits.json'), 'utf8')) as { art: unknown[] };
    expect(doc.art).toEqual([{ pack: 'cc0pack', courtesy: PACKS[0]?.courtesy }]);
  });
});
