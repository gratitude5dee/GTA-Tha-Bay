import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCreatorVoices } from '../src/creator-voices.ts';
import { soulRoot } from '../src/common.ts';

// M06a4 R-UI-01: the creator voice render step. Without CLOUDFLARE_API_TOKEN it prints SKIP and writes nothing; with it (fake fetch here) it writes
// one clip, one draft asset spec and one render record per voice part.
const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});
const outDir = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'creator-voices-'));
  tmp.push(d);
  return d;
};

describe('renderCreatorVoices', () => {
  it('prints SKIP and writes nothing without CLOUDFLARE_API_TOKEN', async () => {
    const lines: string[] = [];
    const out = outDir();
    const r = await renderCreatorVoices({ root: soulRoot, env: {}, out: path.relative(soulRoot, out), log: (l) => lines.push(l), fetchFn: () => Promise.reject(new Error('must not be called')) });
    expect(r).toBe('skipped');
    expect(lines.join('\n')).toMatch(/SKIP .*CLOUDFLARE_API_TOKEN not set/);
    expect(readdirSync(out)).toEqual([]);
  });

  it('renders the eight parts through the Workers AI endpoint with the part voice', async () => {
    const calls: { url: string; body: { text: string; speaker: string; encoding: string }; auth: string }[] = [];
    const fetchFn = ((url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as never, auth: String((init.headers as Record<string, string>)['Authorization']) });
      return Promise.resolve(new Response(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
    }) as unknown as typeof fetch;
    const lines: string[] = [];
    const out = outDir();
    const r = await renderCreatorVoices({ root: soulRoot, env: { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acct' }, out: path.relative(soulRoot, out), log: (l) => lines.push(l), fetchFn });
    expect(r).toBe('rendered');
    expect(calls).toHaveLength(8);
    expect(calls[0]?.url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/deepgram/aura-1');
    expect(calls[0]?.auth).toBe('Bearer t');
    expect(new Set(calls.map((c) => c.body.speaker)).size).toBe(8);
    expect(calls.every((c) => c.body.encoding === 'mp3' && c.body.text.length > 10)).toBe(true);
    expect(readdirSync(out).sort()).toHaveLength(8);
    const rec = JSON.parse(readFileSync(path.join(out, 'voice-gravel', 'render.json'), 'utf8')) as { voiceRef: string; bytes: number; sha256: string };
    expect(rec.voiceRef).toBe('voice/aura-zeus');
    expect(rec.bytes).toBe(13);
    expect(rec.sha256).toMatch(/^[0-9a-f]{64}$/);
    const asset = JSON.parse(readFileSync(path.join(out, 'voice-gravel', 'asset.json'), 'utf8')) as { id: string; kind: string };
    expect(asset).toMatchObject({ kind: 'audio_bark', id: 'creator-voice.voice-gravel' });
  });

  it('fails the run when the endpoint answers JSON errors', async () => {
    const fetchFn = (() => Promise.resolve(new Response('{"errors":[]}', { status: 400, headers: { 'content-type': 'application/json' } }))) as unknown as typeof fetch;
    const out = outDir();
    const r = await renderCreatorVoices({ root: soulRoot, env: { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' }, out: path.relative(soulRoot, out), log: () => undefined, fetchFn });
    expect(r).toBe('failed');
    expect(readdirSync(out)).toEqual([]);
  });
});
