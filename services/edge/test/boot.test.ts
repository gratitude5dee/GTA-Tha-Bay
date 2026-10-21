import { describe, expect, it } from 'vitest';
import type { BootConfig } from '@dv/shared';
import { parseFlags } from '../src/routes/boot.ts';
import pointer from '../src/generated/asset-catalog.json' with { type: 'json' };
import wranglerRaw from '../wrangler.jsonc?raw';
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
    expect(body.assetCatalog).toBe(pointer.key);
    expect(body.assetCatalog).toMatch(/^manifests\/assets-[0-9a-f]{64}\.json$/);
    expect(Object.keys(body.hosts).sort()).toEqual(['api', 'id', 'media', 'rt', 'ugc']);
    expect('modsUi' in body.hosts).toBe(false);
    const flags = Object.entries(body.flags);
    expect(flags.length).toBe(14);
    expect(flags.every(([, v]) => v === false)).toBe(true);
    expect(body.flags['mods.enabled']).toBe(false);
    // LEGAL_CONTACT is not set in the staging vars, so route 58 would refuse every sign-up (M00e item 8).
    expect(body.flags['auth.password']).toBe(false);
  });

  it('every host except media and ugc ends in .gratitude-8f4.workers.dev (AC-10)', async () => {
    const res = await call('/api/v1/boot', { country: 'US' });
    const { hosts } = (await res.json()) as BootConfig;
    for (const [name, host] of Object.entries(hosts)) {
      if (name === 'media' || name === 'ugc') continue;
      expect(host, name).toMatch(/^https:\/\/[a-z0-9-]+\.gratitude-8f4\.workers\.dev$/);
    }
    expect(hosts.rt).toBe('https://tha-bay-rooms-staging.gratitude-8f4.workers.dev');
  });

  it('hosts.media is the configured HOST_MEDIA, the Worker media route (M01d2)', async () => {
    const res = await call('/api/v1/boot', { country: 'US', env: { HOST_MEDIA: 'https://media.example.test/media' } });
    const { hosts } = (await res.json()) as BootConfig;
    expect(hosts.media).toBe('https://media.example.test/media');
    const staging = (await (await call('/api/v1/boot', { country: 'US' })).json()) as BootConfig;
    expect(staging.hosts.media).toBe('https://tha-bay-web-staging.gratitude-8f4.workers.dev/media');
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

  it('AC-6: wrangler.jsonc carries the switch in prod and staging, the Supabase vars there, and neither in previews', () => {
    const wrangler = parseJsonc(wranglerRaw) as {
      vars: Record<string, string>;
      env: { staging: { vars: Record<string, string> } };
      previews: { vars: Record<string, string> };
    };
    for (const vars of [wrangler.vars, wrangler.env.staging.vars]) {
      expect(['off', 'on']).toContain(vars['AUTH_PASSWORD_SIGNUP']);
      expect(vars['SUPABASE_URL']).toBeTruthy();
      expect(vars['SUPABASE_ANON_KEY']).toBeTruthy();
    }
    expect(wrangler.vars['AUTH_PASSWORD_SIGNUP']).toBe('off');
    expect(wrangler.env.staging.vars['AUTH_PASSWORD_SIGNUP']).toBe('on');
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'AUTH_PASSWORD_SIGNUP']) expect(wrangler.previews.vars[k]).toBeUndefined();
  });
});

/** Strips // and block comments outside strings and trailing commas, then parses. */
function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const n = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}
