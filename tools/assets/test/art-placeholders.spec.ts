/** M10d1 AC-2 and the prefab half of AC-5: the placeholder registry and the prefabs it repoints. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolsRoot } from '../../ci/lib/common.ts';
import {
  SEED_ROWS, m10d1Targets, prefabRepoints, readRegistry, registryFindings, remainingGrayboxPrefabs, repointMap, rowOf, seedFindings,
  type PlaceholderRegistry,
} from '../src/placeholders.ts';
import { ART_GRAYBOX } from '../../../packages/engine/src/client/vehicle/art-tables.ts';
import { ART_REFS } from '../../../packages/engine/src/client/vehicle/art-model.ts';

const reg = readRegistry(toolsRoot);

const catalog = (): Set<string> => {
  const out = new Set<string>();
  for (const kind of ['vehicle', 'prop', 'character', 'texture']) {
    const dir = path.join(toolsRoot, 'assets/src', kind);
    for (const id of readdirSync(dir)) if (existsSync(path.join(dir, id, 'asset.json'))) out.add(`${kind}/${id}`);
  }
  return out;
};

describe('config/art-placeholders.json', () => {
  it('holds the twelve seed rows with the owners of the milestone', () => {
    expect(reg.rows.map((r) => [r.id, r.owner])).toEqual(SEED_ROWS.map(([id, owner]) => [id, owner]));
    expect(seedFindings(reg)).toEqual([]);
    expect(reg.rows.filter((r) => r.owner === 'M10d1')).toHaveLength(3);
  });

  it('has an M10d1 row whose replacedBy and repoint refs all resolve in the catalog', () => {
    expect(registryFindings(reg, toolsRoot, catalog())).toEqual([]);
    for (const row of reg.rows.filter((r) => r.owner === 'M10d1')) {
      expect(row.replacedBy.length).toBeGreaterThan(0);
      for (const ref of row.replacedBy) expect(catalog().has(ref)).toBe(true);
      for (const to of Object.values(row.repoint ?? {})) expect(catalog().has(to)).toBe(true);
    }
  });

  it('fails a fixture with an empty replacedBy, naming its id', () => {
    const bad: PlaceholderRegistry = structuredClone(reg);
    (bad.rows.find((r) => r.id === 'props') as PlaceholderRegistry['rows'][number]).replacedBy = [];
    const findings = registryFindings(bad, toolsRoot, catalog());
    expect(findings.some((f) => f.rule === 'replaced-by-empty' && f.detail.startsWith('props:'))).toBe(true);
  });

  it('has M10d4 rows whose replacedBy is non-empty and resolves, names no Coast row and keeps the owner enum (M10d4 AC-2)', () => {
    const rows = reg.rows.filter((r) => r.owner === 'M10d4');
    expect(rows.map((r) => r.id)).toEqual(['ped-mannequins', 'creator-parts']);
    expect(registryFindings(reg, toolsRoot, catalog())).toEqual([]);
    for (const r of rows) {
      expect(r.replacedBy.length).toBeGreaterThan(0);
      for (const ref of r.replacedBy) expect(catalog().has(ref), ref).toBe(true);
      expect(r.replacedBy.some((x) => /-coast(\.|$)/.test(x))).toBe(false);
    }
    expect(new Set(reg.rows.map((r) => r.owner))).toEqual(new Set(['M10d1', 'M10d4', 'M10d5', 'M10d2', 'M10d3']));
    const schema = JSON.parse(readFileSync(path.join(toolsRoot, 'config/schemas/art-placeholders.schema.json'), 'utf8')) as { $defs?: Record<string, { enum?: string[] }>; properties?: unknown };
    expect(JSON.stringify(schema)).toContain('M10d3');
  });

  it('fails an M10d4 fixture with an empty replacedBy naming its id, and one that lists a Coast row', () => {
    const empty: PlaceholderRegistry = structuredClone(reg);
    (empty.rows.find((r) => r.id === 'creator-parts') as PlaceholderRegistry['rows'][number]).replacedBy = [];
    expect(registryFindings(empty, toolsRoot, catalog()).some((f) => f.rule === 'replaced-by-empty' && f.detail.startsWith('creator-parts:'))).toBe(true);
    const coast: PlaceholderRegistry = structuredClone(reg);
    (coast.rows.find((r) => r.id === 'creator-parts') as PlaceholderRegistry['rows'][number]).replacedBy.push('character/pc-body-coast');
    const rules = registryFindings(coast, toolsRoot, catalog()).map((f) => f.rule);
    expect(rules).toContain('replaced-by-coast');
    expect(rules).toContain('replaced-by-unresolved');
  });

  it('fails a repoint to a ref the catalog lacks, and a source its row does not match', () => {
    const bad: PlaceholderRegistry = structuredClone(reg);
    const row = bad.rows.find((r) => r.id === 'vehicles') as PlaceholderRegistry['rows'][number];
    row.repoint = { ...row.repoint, 'vehicle/graybox.sedan': 'vehicle/traffic.nothing', 'prop/graybox.cone': 'prop/cone' };
    const rules = registryFindings(bad, toolsRoot, catalog()).map((f) => f.rule);
    expect(rules).toContain('repoint-target');
    expect(rules).toContain('repoint-source');
  });

  it('owns every remaining gray-box prefab by a row of M10d4, M10d5, M10d2 or M10d3 (AC-5)', () => {
    const left = remainingGrayboxPrefabs(toolsRoot, reg);
    for (const r of left) {
      expect(r.row, `${r.file}: ${r.asset}`).toBeDefined();
      expect(['M10d4', 'M10d5', 'M10d2', 'M10d3']).toContain(r.row?.owner);
    }
    // nothing the M10d1 rows own is still a gray-box ref, and no prefab asset matches `^[a-z_]+/graybox\.` outside the other owners
    expect(left.filter((r) => r.row?.owner === 'M10d1')).toEqual([]);
    expect(prefabRepoints(toolsRoot, reg)).toEqual([]);
  });

  it('points every prefab of an M10d1 row at an asset in the catalog', () => {
    const targets = new Set(m10d1Targets(reg));
    const dir = path.join(toolsRoot, 'assets/prefabs');
    let seen = 0;
    for (const name of readdirSync(dir)) {
      const j = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as { render?: { asset?: string } };
      const a = j.render?.asset;
      if (a && targets.has(a)) seen++;
    }
    expect(seen).toBeGreaterThanOrEqual(24);
    for (const to of repointMap(reg).values()) expect(catalog().has(to)).toBe(true);
  });

  it('matches the engine tables: the gray-box stand-ins are the inverse of the repoint maps and every art ref is listed', () => {
    const inverse: Record<string, string> = {};
    for (const [from, to] of repointMap(reg)) inverse[to] = from;
    expect(ART_GRAYBOX).toEqual(inverse);
    expect([...ART_REFS].sort()).toEqual(Object.keys(inverse).sort());
    expect(rowOf(reg, 'vehicle/graybox.kestrel-quill')?.owner).toBe('M10d3');
    expect(rowOf(reg, 'prop/graybox.capsule')?.owner).toBe('M10d5');
    expect(rowOf(reg, 'prop/graybox.stage-powell_turntable-day')?.owner).toBe('M10d3');
    expect(rowOf(reg, 'vehicle/graybox.sedan')?.owner).toBe('M10d1');
  });
});
