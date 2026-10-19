/** M00f: vendored credits lines and the Mapbox source refusal in provenance:check (AC-1, AC-5). */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runProvenanceCheck } from '../provenance-check.ts';
import { scanThirdParty } from '../lib/third-party.ts';
import { writeThirdPartyLicences } from '../third-party-licenses.ts';
import { buildCase, cleanupCases, MAPBOX_HOST } from './third-party-fixtures.ts';

afterAll(cleanupCases);

describe('provenance:check third-party credits (M00f)', () => {
  it('credits-vendored: emits every NOTICE line and the licences link, and passes', () => {
    const c = buildCase('credits-vendored');
    const dist = path.join(c.root, 'apps/web/dist');
    writeThirdPartyLicences(c.root, path.join(dist, 'third-party-licenses.txt'));
    const res = runProvenanceCheck({ root: c.root, dist, emitCredits: true });
    expect(res.findings).toEqual([]);
    const credits = readFileSync(path.join(dist, 'credits.json'), 'utf8');
    for (const line of readFileSync(path.join(c.root, 'third_party/NOTICE'), 'utf8').trim().split('\n')) expect(credits).toContain(line);
    expect(credits).toContain('third-party-licenses.txt');
    expect(scanThirdParty(c.root, { packFiles: c.packFiles }).findings).toEqual([]);
  });

  it('fails when the dist lacks third-party-licenses.txt', () => {
    const c = buildCase('credits-vendored');
    const dist = path.join(c.root, 'apps/web/dist');
    writeFileSync(path.join(dist, 'third-party-licenses.txt'), 'x');
    const noFile = buildCase('clean');
    mkdirSync(path.join(noFile.root, 'apps/web/dist'), { recursive: true });
    const res = runProvenanceCheck({ root: noFile.root, dist: path.join(noFile.root, 'apps/web/dist'), emitCredits: true });
    expect(res.findings.map((f) => f.rule)).toContain('licences-file-missing');
  });

  it('provenance-mapbox-url: a record whose source.url is a Mapbox host is refused', () => {
    const c = buildCase('provenance-mapbox-url');
    const sha = createHash('sha256').update('fixture').digest('hex');
    const dir = path.join(c.root, 'assets/provenance', sha.slice(0, 2));
    mkdirSync(dir, { recursive: true });
    const rec = {
      schema: 'provenance/1.0',
      sha256: sha,
      paths: ['a.png'],
      kind: 'ui',
      origin: 'open_data',
      license: 'CC0-1.0',
      authors: ['studio:dee-verse'],
      source: { url: `https://${MAPBOX_HOST}/x`, dataset_id: null, retrieved: '2026-10-19T00:00:00Z' },
      derived_from: [],
      review: [],
      ip_checks: { signatures: 'pass', strings: 'n/a', similarity: 'n/a' },
      status: 'approved',
    };
    writeFileSync(path.join(dir, `${sha}.json`), JSON.stringify(rec));
    mkdirSync(path.join(c.root, 'apps/web/dist'), { recursive: true });
    const res = runProvenanceCheck({ root: c.root, dist: path.join(c.root, 'apps/web/dist') });
    expect(res.findings.map((f) => f.rule)).toContain('mapbox-source');
  });
});
