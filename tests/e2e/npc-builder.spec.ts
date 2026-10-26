import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { NpcBridge } from '../../packages/npc/src/debug/overlay.ts';
import { createHmac } from 'node:crypto';
import { NO_ENV_FILE, scrubbedEnv } from '../../tools/ci/secret-env.ts';
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
const PORT = Number(process.env['DV_E2E_PORT'] ?? 8790) + 1;
// The request.cf file the main config writes for the local Worker (playwright.config.ts, BD-FIX-CI-02): the geo gate sees the country in it.
const E2E_CF_PATH = path.resolve(`test-results/e2e-cf.${(process.env['DV_E2E_COUNTRY'] ?? 'US').toUpperCase()}.json`);
const ORIGIN = `http://localhost:${PORT}`;
const SECRET = `k1:${Buffer.from(new Uint8Array(32).fill(7)).toString('base64url')}`;
const PID = '0198aaaa-bbbb-7ccc-8ddd-0000000000b1';
const STRANGER = '0198aaaa-bbbb-7ccc-8ddd-0000000000b2';

type W = { __dvBridge: { npc: NpcBridge & { useUserNpc(id: string, v: number): void; setAuthHeader(h: string | null): void } } };

let worker: ChildProcess | null = null;
let persist = '';

// Mints a `pt1.<claims>.<mac>` play token in the format of services/edge/src/id/playtoken.ts (HMAC-SHA256 over `pt1.<claims>`; the e2e project does not
// compile the Worker's sources, so the few lines are repeated here).
async function token(pid: string): Promise<string> {
  const claims = { v: 1, pid, dkt: `dkt-${pid}`, age: '18p', iat: Date.now(), exp: Date.now() + 3_600_000, kid: 'k1' };
  const head = `pt1.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const mac = createHmac('sha256', Buffer.from(SECRET.slice(3), 'base64url')).update(head).digest('base64url');
  return `${head}.${mac}`;
}

/** True when something accepts TCP connections on `port` of the loopback (IPv4 or IPv6; wrangler binds `localhost`). */
async function listening(port: number): Promise<boolean> {
  const one = (host: string): Promise<boolean> =>
    new Promise((resolve) => {
      const socket = net.connect({ host, port });
      socket.setTimeout(2000);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('error', () => resolve(false));
    });
  return (await Promise.all(['127.0.0.1', '::1'].map(one))).some(Boolean);
}

/** Exit of the spawned Worker, once it has exited (code or signal); null while it runs. */
let exited: string | null = null;
const exitOf = (): string | null => exited;

async function waitHealthy(): Promise<void> {
  const end = Date.now() + 150_000;
  for (;;) {
    // K2-R1: a Worker that died (a busy port, a config error) is a failure at once, never a server someone else answers with.
    if (exitOf() !== null) throw new Error(`the builder Worker exited before it was healthy (${exitOf()}) on ${ORIGIN}`);
    try {
      if ((await fetch(`${ORIGIN}/api/v1/health`)).ok) {
        if (exitOf() !== null) throw new Error(`the builder Worker exited before it was healthy (${exitOf()}) on ${ORIGIN}`);
        return;
      }
    } catch (err) {
      if (exitOf() !== null) throw err;
      // not up yet
    }
    if (Date.now() > end) throw new Error(`the builder Worker did not start on ${ORIGIN}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * Stops the Worker's whole process group (pnpm, wrangler, workerd; the child leads it, `detached`): SIGTERM, then SIGKILL after 10 s,
 * and a final SIGKILL to the group for anything left behind even when pnpm itself already exited.
 */
async function stopWorker(): Promise<void> {
  const child = worker;
  worker = null;
  if (child?.pid === undefined) return;
  const pid = child.pid;
  const gone = exitOf() !== null ? Promise.resolve() : new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const kill = (sig: NodeJS.Signals): void => {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        if (exitOf() === null) child.kill(sig);
      } catch {
        // already gone
      }
    }
  };
  kill('SIGTERM');
  const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 10_000));
  if ((await Promise.race([gone.then(() => 'gone' as const), timer])) === 'timeout') {
    kill('SIGKILL');
    await Promise.race([gone, new Promise((r) => setTimeout(r, 5_000))]);
  }
  kill('SIGKILL');
}

test.beforeAll(async () => {
  // K2-R1: never talk to a server this spec did not start (it could be a `pnpm dev` Worker or another run's, possibly with live secrets).
  if (await listening(PORT)) {
    throw new Error(`port ${PORT} (DV_E2E_PORT+1) is already listening; @npc-builder starts its own Worker there and never reuses one. Stop that server or set DV_E2E_PORT.`);
  }
  persist = mkdtempSync(path.join(tmpdir(), 'dv-builder-e2e-'));
  // The shell may hold production values; the Worker under test gets none of them, not even with DV_ALLOW_LIVE_SECRETS=1 (it has its own
  // test-only PLAY_TOKEN_HMAC): every secret name of tools/ci/secret-env.ts is removed (BD-FIX-SEC-01).
  const env: NodeJS.ProcessEnv = { ...scrubbedEnv(process.env, { label: 'npc-builder', force: true }), WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_PATH: E2E_CF_PATH };
  exited = null;
  worker = spawn(
    'pnpm',
    // --env-file NO_ENV_FILE: no services/edge/.dev.vars(.staging) or .env file is read either (BD-FIX-SEC-02); the staging config names the
    // production SUPABASE_URL.
    ['--filter', '@dv/edge', 'exec', 'wrangler', 'dev', '--local', '--env', 'staging', '--port', String(PORT), '--persist-to', persist, '--env-file', NO_ENV_FILE, '--var', `PLAY_TOKEN_HMAC:${SECRET}`],
    { env, stdio: 'ignore', detached: true },
  );
  worker.once('exit', (code, signal) => {
    exited = signal ? `signal ${signal}` : `code ${code}`;
  });
  worker.once('error', (err) => {
    exited ??= `spawn error ${err.message}`;
  });
  try {
    await waitHealthy();
  } catch (err) {
    await stopWorker();
    throw err;
  }
});

test.afterAll(async () => {
  await stopWorker();
  if (persist !== '') rmSync(persist, { recursive: true, force: true });
});

interface Json {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function api(request: APIRequestContext, tok: string, method: 'get' | 'post' | 'put', p: string, data?: unknown): Promise<{ status: number; json: Json; text: string }> {
  const res = await request.fetch(`${ORIGIN}/api/v1/npc-builder${p}`, {
    method,
    headers: { Authorization: `PlayToken ${tok}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { data: JSON.stringify(data) }),
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = JSON.parse(text);
  } catch {
    // an SSE body
  }
  return { status: res.status(), json, text };
}

async function poll(request: APIRequestContext, tok: string, id: string, until: (state: string) => boolean, ms = 120_000): Promise<Json> {
  const end = Date.now() + ms;
  for (;;) {
    const v = (await api(request, tok, 'get', `/drafts/${id}`)).json;
    if (until(String(v['state'])) || Date.now() > end) return v;
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
