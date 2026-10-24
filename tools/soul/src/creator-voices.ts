/**
 * `pnpm test:staging -- npc-tts --render-creator` (M06a4, R-UI-01): renders the creator's voice samples. For each of the eight creator `voice` parts of
 * config/creator-voices.json it asks Workers AI (the REST `ai/run` endpoint, with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID) to speak the one fixed
 * sample sentence with the part's t1 catalog voice as mp3, and writes the clip and a draft asset spec to `tests/reports/npc/creator-voices/<partId>/`.
 *
 * Without CLOUDFLARE_API_TOKEN it prints `SKIP ... CLOUDFLARE_API_TOKEN not set` and writes no clip.
 *
 * What it does not do: put the clips into `assets/src/audio_bark/creator-voice.<partId>/`, write their provenance records or lock them. A provenance
 * record of a generated asset needs a terms snapshot of the vendor (`generator.terms_snapshot`), and docs/legal/vendor-terms holds none for Workers AI
 * or Deepgram; an `audio_bark` asset also needs the audio extras (loudness, 48 kHz) that the bark pipeline of M10c measures. Those steps are the
 * operator's and M10c's (see the M06a4 report). Until then the Voice tab's Preview button stays disabled with its hint, which is its specified state.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const OUT_DIR = 'tests/reports/npc/creator-voices';

interface CreatorVoices {
  sample: string;
  voices: Record<string, string>;
}
interface Catalog {
  entries: { voiceRef: string; model: string; providerVoiceId: string; engine: string; tier: string }[];
}

export interface RenderOptions {
  root: string;
  env: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  log: (line: string) => void;
  now?: () => number;
  /** Output directory relative to `root`. */
  out?: string;
}

export type RenderResult = 'skipped' | 'rendered' | 'failed';

export async function renderCreatorVoices(o: RenderOptions): Promise<RenderResult> {
  const token = o.env['CLOUDFLARE_API_TOKEN'];
  const account = o.env['CLOUDFLARE_ACCOUNT_ID'];
  if (!token) {
    o.log('SKIP test:staging npc-tts --render-creator: CLOUDFLARE_API_TOKEN not set (no clip is written; the Voice tab keeps its Preview disabled)');
    return 'skipped';
  }
  if (!account) {
    o.log('SKIP test:staging npc-tts --render-creator: CLOUDFLARE_ACCOUNT_ID not set (no clip is written)');
    return 'skipped';
  }
  const fetchFn = o.fetchFn ?? fetch;
  const now = o.now ?? ((): number => Date.now());
  const voices = JSON.parse(readFileSync(path.join(o.root, 'config/creator-voices.json'), 'utf8')) as CreatorVoices;
  const catalog = JSON.parse(readFileSync(path.join(o.root, 'config/voice-catalog.json'), 'utf8')) as Catalog;
  const out = path.join(o.root, o.out ?? OUT_DIR);
  let failed = 0;
  for (const [part, ref] of Object.entries(voices.voices)) {
    const entry = catalog.entries.find((e) => e.voiceRef === ref && e.engine === 'workers_ai' && e.tier === 't1');
    if (entry === undefined) {
      o.log(`npc-tts --render-creator: ${part}: ${ref} is not a t1 Workers AI entry of config/voice-catalog.json`);
      failed++;
      continue;
    }
    const t0 = now();
    try {
      const res = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${entry.model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: voices.sample, speaker: entry.providerVoiceId, encoding: 'mp3' }),
      });
      const bytes = new Uint8Array(await res.arrayBuffer());
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || bytes.length === 0 || type.includes('json')) {
        o.log(`npc-tts --render-creator: ${part}: the endpoint answered ${res.status} ${type}`);
        failed++;
        continue;
      }
      const dir = path.join(out, part);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'clip.mp3'), bytes);
      writeFileSync(
        path.join(dir, 'asset.json'),
        `${JSON.stringify({ kind: 'audio_bark', id: `creator-voice.${part}`, variants: { default: 'clip.mp3' }, deps: [], tags: ['creator-voice'], status: 'active', visibility: 'public' }, null, 2)}\n`,
      );
      writeFileSync(
        path.join(dir, 'render.json'),
        `${JSON.stringify({ part, voiceRef: ref, model: entry.model, speaker: entry.providerVoiceId, chars: voices.sample.length, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ms: now() - t0, contentType: type }, null, 2)}\n`,
      );
    } catch {
      o.log(`npc-tts --render-creator: ${part}: the request failed`);
      failed++;
    }
  }
  o.log(failed === 0 ? `npc-tts --render-creator: 8 clips written to ${path.relative(o.root, out)}; promote them into assets/src/audio_bark/ (terms snapshot, provenance, lock) before the Preview can play them` : `npc-tts --render-creator: ${failed} of ${Object.keys(voices.voices).length} clips failed`);
  return failed === 0 ? 'rendered' : 'failed';
}
