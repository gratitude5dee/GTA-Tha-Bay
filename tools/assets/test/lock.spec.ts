import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { lockText, readLock, recordMap, updateLock } from '../src/lock.ts';
import { loadSpecs } from '../src/spec.ts';
import { addAsset, put, tempRepo } from './helpers.ts';

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe('assets:lock', () => {
  it('writes approved fields and rewrites changed refs only', () => {
    const root = tempRepo();
    roots.push(root);
    const before = readLock(root);
    expect(before?.entries['data/asset-smoke']?.approved_by).toBe('gratitude5dee');
    // change one asset
    const h = addAsset(root, { kind: 'data', id: 'asset-new', variants: { default: { ext: 'json', bytes: '{"n":1}' } }, lock: false }).default as string;
    const { specs } = loadSpecs(root);
    const { lock, changed } = updateLock(specs, before, recordMap(root), 'reviewer', '2026-11-01T10:00:00Z');
    expect(changed).toEqual(['data/asset-new']);
    expect(lock.entries['data/asset-new']).toEqual({ rev: 1, variants: { default: h }, root: h, approved_by: 'reviewer', approved_at: '2026-11-01T10:00:00Z' });
    expect(lock.entries['data/asset-smoke']).toEqual(before?.entries['data/asset-smoke']);
    expect(lock.entries['texture/asset-smoke']).toEqual(before?.entries['texture/asset-smoke']);
  });

  it('bumps rev when a variant hash changes and drops entries that are no longer public', () => {
    const root = tempRepo();
    roots.push(root);
    const before = readLock(root);
    put(root, 'assets/src/data/asset-smoke/smoke.json', '{"v":2}\n');
    put(root, 'assets/src/texture/asset-smoke/asset.json', JSON.stringify({ kind: 'texture', id: 'asset-smoke', variants: { desktop: 'assets/src/texture/asset-smoke/d.png', mobile: 'assets/src/texture/asset-smoke/m.png', 'mobile-low': 'assets/src/texture/asset-smoke/l.png' }, deps: [], tags: [], status: 'killed', visibility: 'public' }));
    const { specs } = loadSpecs(root);
    const { lock, changed } = updateLock(specs, before, recordMap(root), 'r', '2026-11-01T10:00:00Z');
    expect(lock.entries['data/asset-smoke']?.rev).toBe(2);
    expect('texture/asset-smoke' in lock.entries).toBe(false);
    expect(changed.sort()).toEqual(['data/asset-smoke', 'texture/asset-smoke']);
  });

  it('prints sorted keys with a trailing newline and ISO Z times', () => {
    const root = tempRepo();
    roots.push(root);
    const lock = readLock(root);
    expect(lock).not.toBeNull();
    const text = lockText(lock as NonNullable<typeof lock>);
    expect(text.endsWith('\n')).toBe(true);
    for (const e of Object.values(lock?.entries ?? {})) expect(e.approved_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(text.indexOf('data/asset-smoke')).toBeLessThan(text.indexOf('texture/asset-smoke'));
  });
});
