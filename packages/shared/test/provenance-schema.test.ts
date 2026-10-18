import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const schema = JSON.parse(readFileSync(path.join(import.meta.dirname, '../schemas/provenance-1.0.schema.json'), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const h = (c: string): string => c.repeat(64);

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'provenance/1.0',
    sha256: h('a'),
    paths: ['apps/web/public/icon.svg'],
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
const generator = {
  vendor: 'fal',
  endpoint: 'meshy/v7.1/multi-image-to-3d',
  endpoint_registry_key: 'meshy/v7.1/multi-image-to-3d',
  endpoint_updated_at: null,
  request_id: 'r',
  job_key: h('1'),
  params_sha256: h('2'),
  prompt_template: 'p@1',
  prompt_sha256: h('3'),
  input_refs: [`sha256:${h('4')}`],
  terms_snapshot: { path: 'docs/legal/vendor-terms/fal-tos-2026-10-18.md', sha256: h('5'), checked_at: '2026-10-18' },
  generated_at: '2026-10-18T00:00:00Z',
  executor: 'workflow',
  env: 'production',
};
const likeness = { subject_id: null, tier: 'original', face_reference_used: false, voice_mode: 'none', photoreal: false };
const source = { url: null, dataset_id: 'osm', retrieved: '2026-10-18' };
const tool = { name: 't', version: '1', args_sha256: h('6') };

const positive: [string, Record<string, unknown>][] = [
  ['authored ui file', base()],
  ['derived with tool and parent', base({ origin: 'derived', tool, derived_from: [h('b')] })],
  ['generated with generator and ai flag', base({ origin: 'generated', ai_generated: true, generator })],
  ['licensed with source', base({ origin: 'licensed', source, license: 'LicenseRef-Vendor-acme' })],
  ['open_data with source and attribution', base({ origin: 'open_data', source, attribution: 'map contributors', license: 'ODbL-1.0' })],
  ['original character', base({ kind: 'character', likeness })],
  ['parody voice, designed', base({ kind: 'voice', likeness: { ...likeness, tier: 'parody', voice_mode: 'designed' } })],
  ['consented character with consent id', base({ kind: 'character', likeness: { ...likeness, tier: 'consented', face_reference_used: true, photoreal: true, voice_mode: 'consented_clone', consent_record_id: 'c1' } })],
];

const negative: [string, Record<string, unknown>][] = [
  ['generated without a generator', base({ origin: 'generated', ai_generated: true })],
  ['generated without the ai flag', base({ origin: 'generated', generator })],
  ['open_data without attribution', base({ origin: 'open_data', source })],
  ['licensed without source', base({ origin: 'licensed' })],
  ['derived without tool', base({ origin: 'derived', derived_from: [h('b')] })],
  ['derived without parents', base({ origin: 'derived', tool })],
  ['character without likeness', base({ kind: 'character' })],
  ['parody with a face reference', base({ kind: 'character', likeness: { ...likeness, tier: 'parody', face_reference_used: true } })],
  ['fictionalized photoreal', base({ kind: 'character', likeness: { ...likeness, tier: 'fictionalized', photoreal: true } })],
  ['original with a cloned voice', base({ kind: 'voice', likeness: { ...likeness, voice_mode: 'consented_clone' } })],
  ['consented without a consent id', base({ kind: 'character', likeness: { ...likeness, tier: 'consented' } })],
  ['unknown property', base({ extra: 1 })],
  ['bad sha256', base({ sha256: 'xyz' })],
  ['bad status', base({ status: 'gone' })],
  ['created_at without Z', base({ created_at: '2026-10-18T00:00:00+02:00' })],
];

describe('provenance/1.0 schema', () => {
  it.each(positive)('accepts: %s', (_name, rec) => {
    expect(validate(rec), JSON.stringify(validate.errors)).toBe(true);
  });
  it.each(negative)('rejects: %s', (_name, rec) => {
    expect(validate(rec)).toBe(false);
  });
});
