import { describe, expect, it } from 'vitest';
import type { BootConfig } from '@dv/shared';
import { parseFlags } from '../src/routes/boot.ts';
import { call } from './helpers.ts';

describe('GET /api/v1/boot', () => {
  it('returns every BootConfig field from the staging vars', async () => {
    const res = await call('/api/v1/boot', { country: 'US' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as BootConfig;
    expect(Object.keys(body).sort()).toEqual(['assetCatalog', 'build', 'flags', 'gov', 'hosts', 'minClientBuild', 'region'].sort());
    expect(body.region).toBe('ok');
    expect(body.gov).toBe(0);
    expect(body.assetCatalog).toBe('');
    expect(Object.keys(body.hosts).sort()).toEqual(['api', 'id', 'media', 'rt', 'ugc']);
    expect('modsUi' in body.hosts).toBe(false);
    const flags = Object.entries(body.flags);
    expect(flags.length).toBe(13);
    expect(flags.every(([, v]) => v === false)).toBe(true);
    expect(body.flags['mods.enabled']).toBe(false);
  });

  it('parseFlags ignores unknown keys and bad JSON', () => {
    expect(parseFlags('{"mp.enabled":true,"nope":true}')['mp.enabled']).toBe(true);
    expect('nope' in parseFlags('{"nope":true}')).toBe(false);
    expect(Object.values(parseFlags('not json')).every((v) => v === false)).toBe(true);
  });

  it('POST is 405 as an ApiError with Allow', async () => {
    const res = await call('/api/v1/boot', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
  });
});
