/** Gates A1 and A2 over procedural sheets, the crop and slice helpers, and the A8 record check (M10a1, spec section 2). */
import { describe, expect, it } from 'vitest';
import type { ProvenanceRecord } from '../../../packages/shared/src/assets/provenance.ts';
import { evaluateA1Crops, evaluateA1Sheet, evaluateA2, evaluateA8, h1Checklist, heldVision } from '../../../services/pipeline/src/steps/gates.ts';
import { cellStats, decodePng, limitEdge, pngSize, sliceGrid } from '../src/image.ts';
import { emptySheetPng, sheetPng, squarePng } from './helpers/images.ts';

const at = '2026-10-27T12:00:00Z';
const shape = { width: 2560, height: 1440, cols: 2, rows: 2 };

function cellsOf(png: Uint8Array) {
  return sliceGrid(decodePng(png), 2, 2).map(cellStats);
}

describe('A1 layout on a sheet', () => {
  it('passes four centred figures on a flat background, holding the vision check for the human', () => {
    const rep = evaluateA1Sheet('sheet-1', shape, cellsOf(sheetPng(2560, 1440, 40)), null, at, 'standard');
    expect(rep.findings).toEqual([]);
    expect(rep.status).toBe('held');
    expect(rep.notes[0]).toMatch(/human gate decides/);
  });

  it('fails figures that crowd the cell edge', () => {
    const rep = evaluateA1Sheet('sheet-1', shape, cellsOf(sheetPng(2560, 1440, 40, 0.98)), null, at, 'standard');
    expect(rep.status).toBe('fail');
    expect(rep.findings.map((f) => f.rule)).toContain('margin');
  });

  it('fails an empty sheet and a sheet of the wrong size', () => {
    const empty = evaluateA1Sheet('sheet-1', shape, cellsOf(emptySheetPng(2560, 1440)), null, at, 'standard');
    expect(empty.findings.filter((f) => f.rule === 'figure')).toHaveLength(4);
    const small = evaluateA1Sheet('sheet-1', { ...shape, width: 1280, height: 720 }, cellsOf(sheetPng(1280, 720, 40)), null, at, 'standard');
    expect(small.findings.map((f) => f.rule)).toContain('size');
    expect(evaluateA1Sheet('sheet-1', { ...shape, width: 1280, height: 720 }, cellsOf(sheetPng(1280, 720, 40)), null, at, 'lean').findings).toEqual([]);
  });

  it('reads the vision verdict: a missing T-pose or a non-uniform background fails', () => {
    const v = { status: 'answered' as const, fields: { grid_cells: 4, full_body_in_cell: true, t_pose_arms: false, bg_uniform: false } };
    const rep = evaluateA1Sheet('sheet-1', shape, cellsOf(sheetPng(2560, 1440, 40)), v, at, 'standard');
    expect(rep.findings.map((f) => f.rule).sort()).toEqual(['vision-background', 'vision-pose']);
  });

  it('checks the four crops for size', () => {
    const ok = evaluateA1Crops(['front', 'left', 'back', 'right'].map((n) => ({ name: n, width: 1280, height: 720 })), at, { width: 1280, height: 720 });
    expect(ok.status).toBe('pass');
    const bad = evaluateA1Crops([{ name: 'front', width: 1000, height: 720 }], at, { width: 1280, height: 720 });
    expect(bad.findings.map((f) => f.rule).sort()).toEqual(['count', 'size']);
  });
});

describe('A2 safety', () => {
  const textOk = (): boolean => true;
  it('holds without a vision model and passes a clean answer', () => {
    expect(evaluateA2('s', 'sheet', null, textOk, at).status).toBe('held');
    expect(evaluateA2('s', 'sheet', { status: 'answered', fields: { apparent_minor: 'none', nudity: 'none', gore: 'none', logos_or_jerseys: false, text_in_image: [] } }, textOk, at).status).toBe('pass');
  });
  it('fails an apparent minor, nudity, realistic gore, logos, a weapon and text that fails the names lint', () => {
    const v = { status: 'answered' as const, fields: { apparent_minor: 'likely' as const, nudity: 'partial' as const, gore: 'realistic' as const, logos_or_jerseys: true, weapon_present: true, text_in_image: ['Some Name'] } };
    const rep = evaluateA2('s', 'sheet', v, () => false, at);
    expect(rep.findings.map((f) => f.rule).sort()).toEqual(['apparent-minor', 'gore', 'logos', 'nudity', 'text-in-image', 'weapon']);
    expect(heldVision('x')).toBeDefined();
  });
});

describe('image helpers', () => {
  it('reads a PNG size without decoding, slices a grid in reading order and caps the longest edge', () => {
    const png = sheetPng(400, 200, 50);
    expect(pngSize(png)).toEqual({ width: 400, height: 200 });
    const cells = sliceGrid(decodePng(png), 2, 2);
    expect(cells.map((c) => [c.width, c.height])).toEqual([[200, 100], [200, 100], [200, 100], [200, 100]]);
    const sq = decodePng(squarePng(1024, 7));
    expect(limitEdge(sq, 512).width).toBe(512);
    expect(limitEdge(sq, 2048)).toBe(sq);
    expect(sliceGrid(sq, 3, 3)[0]?.width).toBe(341);
  });
});

describe('A8 record', () => {
  const base = (over: Partial<ProvenanceRecord>): ProvenanceRecord => ({
    schema: 'provenance/1.0', sha256: 'a'.repeat(64), paths: ['assets/src/character/x/desktop.glb'], kind: 'character', origin: 'generated', license: 'LicenseRef-DeeVerse-Owned', authors: ['profile:art-lead'],
    generator: {
      vendor: 'fal', endpoint: 'meshy/v7.1/multi-image-to-3d', endpoint_registry_key: 'meshy/v7.1/multi-image-to-3d', endpoint_updated_at: null, request_id: 'r', seed: 1, job_key: 'b'.repeat(64),
      params_sha256: 'c'.repeat(64), prompt_template: 'character-mesh@1', prompt_sha256: 'd'.repeat(64), input_refs: [], terms_snapshot: { path: 'docs/legal/vendor-terms/fal-tos-2026-10-18.md', sha256: 'e'.repeat(64), checked_at: '2026-10-18' },
      generated_at: at, executor: 'cli', env: 'production',
    },
    derived_from: [], likeness: { subject_id: null, tier: 'original', face_reference_used: false, voice_mode: 'none', photoreal: false }, review: [],
    ip_checks: { signatures: 'n/a', strings: 'pass', similarity: 'n/a' }, ai_generated: true, status: 'active', created_at: at, ...over,
  });
  const input = (records: ProvenanceRecord[], stored: string[], mock = false) => ({ storedSha256: stored, records, recordLicenses: ['LicenseRef-DeeVerse-Owned'], consent: { schema: 'consent-index/1' as const, entries: [] }, nowIso: at, mock });

  it('passes a generated root with a derived child', () => {
    const root = base({});
    const child = base({ sha256: 'f'.repeat(64), origin: 'derived', derived_from: [root.sha256], tool: { name: 'assets:optimize', version: '1.0.0', args_sha256: '1'.repeat(64) } });
    delete (child as { generator?: unknown }).generator;
    expect(evaluateA8(input([root, child], [child.sha256]), at).status).toBe('pass');
  });
  it('fails a stored file without a record and a chain that does not end in a generated root', () => {
    const orphan = base({ sha256: '9'.repeat(64), origin: 'derived', derived_from: ['8'.repeat(64)] });
    delete (orphan as { generator?: unknown }).generator;
    const rep = evaluateA8(input([orphan], ['7'.repeat(64)]), at);
    expect(rep.findings.map((f) => f.rule)).toEqual(expect.arrayContaining(['no-record', 'derivation-unrooted', 'root']));
  });
  it('fails a mock record outside a mock run, and accepts it inside one', () => {
    const mocked = base({ generator: { ...(base({}).generator as NonNullable<ProvenanceRecord['generator']>), executor: 'mock', env: 'test' } });
    expect(evaluateA8(input([mocked], [mocked.sha256]), at).status).toBe('fail');
    expect(evaluateA8(input([mocked], [mocked.sha256], true), at).status).toBe('pass');
  });
  it('lists the H1 checklist for a parody and fictionalized design only', () => {
    expect(h1Checklist('parody').length).toBeGreaterThan(4);
    expect(h1Checklist('original')).toEqual([]);
    expect(h1Checklist('consented')).toEqual([]);
  });
});
