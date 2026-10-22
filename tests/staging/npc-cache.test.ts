import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * M06a3 AC-12, suite `npc-cache`: a 3-turn conversation with npc_test on the staging Worker.
 *   - turn 2 and turn 3 read the prompt cache (cache_read_input_tokens > 0), read through the staging test route
 *     /api/v1/_test/npc/usage, because the dialogue stream carries only the cost;
 *   - the time to the first text (TTFT) of every turn goes to tests/reports/npc/ttft.json, with the two readings that settle U-NPC-01 (TTFT
 *     against the 800 ms target) and U-NPC-02 (the gateway passes the stream unbuffered: the lines arrive spread over time, not at once).
 *
 * It needs ANTHROPIC_API_KEY in the environment (the repository secret of the npc-runtime workspace) as the sign that staging was switched
 * to ANTHROPIC_MODE=live; without it the suite prints a SKIP line and runs nothing. With the key set but staging still replaying fixtures
 * (response header X-DV-Npc-Mode: fixture), the suite fails: a replayed stream proves nothing about the cache.
 */
const base = process.env['DV_STAGING_URL'] ?? 'https://tha-bay-web-staging.gratitude-8f4.workers.dev';
const key = process.env['ANTHROPIC_API_KEY'];
const root = path.resolve(import.meta.dirname, '..', '..');

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

async function playToken(): Promise<{ token: string; pid: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as { kty: string; crv: string; x: string; y: string };
  const pid = crypto.randomUUID();
  const ts = Date.now();
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`pt-req|${pid}|${ts}`)));
  const res = await fetch(new URL('/api/v1/id/play-token', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pid, jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, ts, sig: b64url(sig), age: '18p' }),
  });
  if (!res.ok) throw new Error(`play-token answered ${res.status}`);
  return { token: ((await res.json()) as { token: string }).token, pid };
}

interface TurnResult {
  encounterId: string;
  mode: string;
  ttftMs: number;
  firstToDoneMs: number;
  events: string[];
}

async function turn(token: string, soulVersion: number, encounterId: string | undefined, text: string): Promise<TurnResult> {
  const body = {
    npcId: 'npc_test',
    ...(encounterId === undefined ? {} : { encounterId }),
    soulVersion,
    turn: { text, intent: 'smalltalk' },
    context: {
      schema: 1, clockT: 7200, chunkKey: '9/256/256', poiId: null, mode: 'story', missionId: null, missionStep: null,
      player: { heat: 0, inVehicle: false, health: 'ok', streetCred: 0, techClout: 0 }, relation: { trust: 0, met: false }, events: [],
      offers: { missionIds: [], raceIds: [], dealIds: [] }, tycoon: null, voice: 'off', locale: 'en-US',
    },
    maxTokens: 512,
  };
  const started = performance.now();
  const res = await fetch(new URL('/api/v1/npc/npc_test/talk', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `PlayToken ${token}` },
    body: JSON.stringify(body),
  });
  if (res.status !== 200) throw new Error(`talk answered ${res.status}: ${await res.text()}`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let ttft = -1;
  let firstText = -1;
  let doneAt = -1;
  let id = '';
  const events: string[] = [];
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    for (let cut = buf.indexOf('\n\n'); cut >= 0; cut = buf.indexOf('\n\n')) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1] ?? '';
      const data = /^data: (.+)$/m.exec(block)?.[1];
      events.push(ev);
      const now = performance.now() - started;
      if (ev === 'meta' && data) id = (JSON.parse(data) as { encounterId: string }).encounterId;
      if (ev === 'line.delta' && ttft < 0 && data && typeof (JSON.parse(data) as { text?: unknown }).text === 'string') {
        ttft = now;
        firstText = now;
      }
      if (ev === 'done') doneAt = now;
    }
  }
  return { encounterId: id, mode: res.headers.get('x-dv-npc-mode') ?? '', ttftMs: Math.round(ttft), firstToDoneMs: Math.round(doneAt - firstText), events };
}

async function cacheRead(token: string, encounterId: string): Promise<number[]> {
  const res = await fetch(new URL(`/api/v1/_test/npc/usage?npc=npc_test&encounter=${encounterId}`, base), { headers: { Authorization: `PlayToken ${token}` } });
  if (!res.ok) throw new Error(`usage answered ${res.status}`);
  return ((await res.json()) as { turns: { cacheRead: number }[] }).turns.map((t) => t.cacheRead);
}

if (key === undefined || key === '') {
  console.log('SKIP npc-cache: ANTHROPIC_API_KEY not set (staging stays in fixture mode; U-NPC-01 and U-NPC-02 stay open)');
  describe.skip('npc cache on staging', () => it('needs ANTHROPIC_API_KEY', () => undefined));
} else {
  describe('npc cache on staging', () => {
    it('reads the prompt cache from turn 2 and records TTFT', { timeout: 120_000 }, async () => {
      const { token } = await playToken();
      const index = JSON.parse(readFileSync(path.join(root, 'content/npcs/souls.index.json'), 'utf8')) as { souls: Record<string, { soulVersion: number }> };
      const soulVersion = index.souls['npc_test']!.soulVersion;
      const results: TurnResult[] = [];
      let encounterId: string | undefined;
      for (const text of ['hello there', 'how is the weather today', 'and what about tomorrow']) {
        const r = await turn(token, soulVersion, encounterId, text);
        encounterId = r.encounterId;
        results.push(r);
        await new Promise((resolve) => setTimeout(resolve, 1800)); // the 1.5 s cadence of the encounter
      }
      expect(results.every((r) => r.mode === 'live'), 'staging must run ANTHROPIC_MODE=live for this suite').toBe(true);
      const reads = await cacheRead(token, encounterId!);
      const ttfts = results.map((r) => r.ttftMs).sort((a, b) => a - b);
      const p50 = ttfts[Math.floor(ttfts.length / 2)]!;
      const spread = Math.max(...results.map((r) => r.firstToDoneMs));
      mkdirSync(path.join(root, 'tests/reports/npc'), { recursive: true });
      writeFileSync(
        path.join(root, 'tests/reports/npc/ttft.json'),
        `${JSON.stringify(
          {
            host: base,
            turns: results.map((r, i) => ({ turn: i + 1, ttftMs: r.ttftMs, firstTextToDoneMs: r.firstToDoneMs, cacheReadTokens: reads[i] ?? null })),
            u_npc_01: { ttftP50Ms: p50, targetMs: 800, withinTarget: p50 <= 800, note: 'recorded, not asserted' },
            u_npc_02: { maxFirstTextToDoneMs: spread, unbuffered: spread > 100, note: 'a gateway that buffers the stream delivers every event at once' },
          },
          null,
          2,
        )}\n`,
      );
      expect(reads.length).toBe(3);
      expect(reads[1]!).toBeGreaterThan(0);
      expect(reads[2]!).toBeGreaterThan(0);
    });
  });
}
