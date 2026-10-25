import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { NpcBridge } from '../../packages/npc/src/debug/overlay.ts';
import { mint } from '../../services/edge/src/id/playtoken.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M06b1 @npc-builder: the NPC builder from text to a private talk, against a real Worker in fixture mode (the staging config: recorded model streams,
 * fixture moderation, the flag on, drafts in the Worker's in-memory database). The Worker of the other e2e specs runs with no secret, so it cannot
 * authenticate a play token; this spec starts a second `wrangler dev --local --env staging` on the next port with a test-only `PLAY_TOKEN_HMAC`
 * and mints its own play token, exactly as the Worker's `mint` does.
 *
 *  1. Playwright's `request` creates a draft, validates it, has the soul written and probed, previews two turns and reads the draft back.
 *  2. A stranger's token gets not_found for that draft.
 *  3. The page talks to the private NPC through `__dvBridge.npc.talk`: the line streams into the dialogue panel with the AI badge text.
 * The Worker side of every rule is proved by `pnpm check:workers -- npc-builder`; this spec proves the pieces fit end to end in a browser.
 */
const PORT = Number(process.env['DV_E2E_PORT'] ?? 8788) + 1;
// The request.cf file the main config writes for the local Worker (playwright.config.ts, BD-FIX-CI-02): the geo gate sees the country in it.
const E2E_CF_PATH = path.resolve(`test-results/e2e-cf.${(process.env['DV_E2E_COUNTRY'] ?? 'US').toUpperCase()}.json`);
const SECRET_NAMES = ['SUPABASE_SECRET_KEY', 'PLAY_TOKEN_HMAC', 'QUOTA_NET_SALT_SECRET', 'ANTHROPIC_API_KEY', 'OPENAI_MODERATION_API_KEY', 'ANTHROPIC_BUILDER_KEY'];
const ORIGIN = `http://localhost:${PORT}`;
const SECRET = `k1:${Buffer.from(new Uint8Array(32).fill(7)).toString('base64url')}`;
const PID = '0198aaaa-bbbb-7ccc-8ddd-0000000000b1';
const STRANGER = '0198aaaa-bbbb-7ccc-8ddd-0000000000b2';

type W = { __dvBridge: { npc: NpcBridge & { useUserNpc(id: string, v: number): void; setAuthHeader(h: string | null): void } } };

let worker: ChildProcess | null = null;
let persist = '';

async function token(pid: string): Promise<string> {
  const t = await mint({ PLAY_TOKEN_HMAC: SECRET }, { pid, dkt: `dkt-${pid}`, age: '18p', iat: Date.now(), exp: Date.now() + 3_600_000 });
  if (t === null) throw new Error('mint failed');
  return t;
}

async function waitHealthy(): Promise<void> {
  const end = Date.now() + 150_000;
  for (;;) {
    try {
      if ((await fetch(`${ORIGIN}/api/v1/health`)).ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > end) throw new Error(`the builder Worker did not start on ${ORIGIN}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

test.beforeAll(async () => {
  persist = mkdtempSync(path.join(tmpdir(), 'dv-builder-e2e-'));
  const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_PATH: E2E_CF_PATH };
  // The shell may hold production values; the Worker under test gets none of them (see playwright.config.ts, E2E_UNSET_SECRETS).
  for (const k of [...SECRET_NAMES, 'FAL_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_API_TOKEN']) delete env[k];
  worker = spawn(
    'pnpm',
    ['--filter', '@dv/edge', 'exec', 'wrangler', 'dev', '--local', '--env', 'staging', '--port', String(PORT), '--persist-to', persist, '--var', `PLAY_TOKEN_HMAC:${SECRET}`],
    { env, stdio: 'ignore', detached: true },
  );
  await waitHealthy();
});

test.afterAll(() => {
  if (worker?.pid !== undefined) {
    try {
      process.kill(-worker.pid, 'SIGTERM');
    } catch {
      worker.kill('SIGTERM');
    }
  }
  if (persist !== '') rmSync(persist, { recursive: true, force: true });
});

async function api(request: APIRequestContext, tok: string, method: 'get' | 'post' | 'put', p: string, data?: unknown): Promise<{ status: number; json: any; text: string }> {
  const res = await request.fetch(`${ORIGIN}/api/v1/npc-builder${p}`, {
    method,
    headers: { Authorization: `PlayToken ${tok}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { data: JSON.stringify(data) }),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // an SSE body
  }
  return { status: res.status(), json, text };
}

async function poll(request: APIRequestContext, tok: string, id: string, until: (state: string) => boolean, ms = 120_000): Promise<any> {
  const end = Date.now() + ms;
  for (;;) {
    const v = (await api(request, tok, 'get', `/drafts/${id}`)).json;
    if (until(v.state) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

test.describe('npc builder @npc-builder', () => {
  test.describe.configure({ mode: 'serial', timeout: 400_000 });
  const made: { id: string; npcId: string; version: number } = { id: '', npcId: '', version: 0 };

  test('creates, validates, writes and probes a character, then previews two turns', async ({ request }) => {
    const tok = await token(PID);
    const created = await api(request, tok, 'post', '/drafts', {
      fields: { name: 'Tomasa Quill', shortBio: 'Runs a late-night tamale cart in the Mission.', archetype: 'vendor', tags: ['street-food'], district: 'mission', voiceRef: null, appearancePreset: null },
      attestation: 'original',
    });
    expect(created.status).toBe(201);
    expect(created.json.state).toBe('draft');
    made.id = created.json.id;
    made.npcId = created.json.npcId;
    expect(made.npcId).toMatch(/^u_[a-z0-9]{16}$/);

    const put = await api(request, tok, 'put', `/drafts/${made.id}`, { rev: created.json.rev, backstory: 'She started the cart after the bakery on her corner closed. Now she knows every regular and every rumor of the block, and she feeds anyone who looks tired.' });
    expect(put.status).toBe(200);

    expect((await api(request, tok, 'post', `/drafts/${made.id}/soul`)).status).toBe(409); // not validated yet
    expect((await api(request, tok, 'post', `/drafts/${made.id}/validate`)).status).toBe(202);
    const checked = await poll(request, tok, made.id, (s) => s !== 'draft' && s !== 'validating');
    expect(checked.state).toBe('text_ok');
    expect(checked.moderation).toMatchObject({ text: 'allow', publishable: true });

    expect((await api(request, tok, 'post', `/drafts/${made.id}/soul`)).status).toBe(202);
    const priv = await poll(request, tok, made.id, (s) => ['private', 'soul_failed', 'soul_ready'].includes(s), 240_000);
    expect(priv.state).toBe('private');
    expect(priv.probes).toEqual({ passed: 5, total: 5, failures: [] });
    expect(priv.soul.frontmatter.origin).toBe('user');
    made.version = priv.publish.soulVersion;
    expect(made.version).toBe(1);

    for (let i = 0; i < 2; i++) {
      const preview = await api(request, tok, 'post', `/drafts/${made.id}/preview`, { turn: { intent: 'greet' } });
      expect(preview.status).toBe(200);
      expect(preview.text).toContain('event: meta');
      expect(preview.text).toContain('"aiCharacter":true');
      expect(preview.text).toContain('event: line.done');
      expect(preview.text.trimEnd().endsWith('}')).toBe(true);
    }
    const after = (await api(request, tok, 'get', `/drafts/${made.id}`)).json;
    expect(after.limits.previewTurnsLeft).toBe(18);
  });

  test('a stranger cannot see or talk to the draft or its private NPC', async ({ request }) => {
    const stranger = await token(STRANGER);
    expect((await api(request, stranger, 'get', `/drafts/${made.id}`)).status).toBe(404);
    const talk = await request.fetch(`${ORIGIN}/api/v1/npc/${made.npcId}/talk`, {
      method: 'POST',
      headers: { Authorization: `PlayToken ${stranger}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({
        npcId: made.npcId,
        soulVersion: made.version,
        turn: { intent: 'greet' },
        context: { schema: 1, clockT: 7200, chunkKey: '9/256/256', poiId: null, mode: 'story', missionId: null, missionStep: null, player: { heat: 0, inVehicle: false, health: 'ok', streetCred: 0, techClout: 0 }, relation: { trust: 0, met: false }, events: [], offers: { missionIds: [], raceIds: [], dealIds: [] }, tycoon: null, voice: 'off', locale: 'en-US' },
        maxTokens: 512,
      }),
    });
    expect(talk.status()).toBe(404);
  });

  test('the page talks to the private NPC in the world, with the AI badge', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?play=off&tier=mobile-low');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.npc !== undefined, undefined, { timeout: 60_000 });
    // The page is served by the main Worker; the private NPC lives in the builder Worker, so its talk route is sent there.
    await page.route(`**/api/v1/npc/${made.npcId}/talk`, async (route) => {
      const u = new URL(route.request().url());
      const res = await route.fetch({ url: `${ORIGIN}${u.pathname}` });
      await route.fulfill({ response: res });
    });
    const tok = await token(PID);
    await page.evaluate(([id, v, t]) => {
      const npc = (window as unknown as W).__dvBridge.npc;
      npc.setAuthHeader(`PlayToken ${t}`);
      npc.useUserNpc(id as string, v as number);
    }, [made.npcId, made.version, tok]);
    const turn = await page.evaluate((id) => (window as unknown as W).__dvBridge.npc.talk(id, { intent: 'greet' }), made.npcId);
    expect(turn).toMatchObject({ npcId: made.npcId, source: 'llm', aiCharacter: true });
    expect(turn.text.length).toBeGreaterThan(5);
    await expect(page.getByTestId('dialogue-panel')).toBeVisible();
    await expect(page.getByTestId('dialogue-ai-badge')).toBeVisible();
    await expect(page.getByTestId('dialogue-line')).toHaveText(turn.text);
    expect(errors).toEqual([]);
  });
});

export type { Page };
