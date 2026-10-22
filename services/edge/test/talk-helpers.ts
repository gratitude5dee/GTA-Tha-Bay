import { env } from 'cloudflare:test';
import type { DialogueEvent, NPCDialogueContext, NPCDialogueRequest } from '@dv/shared/contracts/c10-npc';
import bundled from '../src/generated/npc-fixtures.json';
import type { Env } from '../src/env.ts';
import { drainTalk } from '../src/npc/dialogue.ts';
import { setModerationForTests, setNameRegistryForTests } from '../src/npc/safety.ts';
import { dropSoulCache } from '../src/npc/souls.ts';
import { fixtureUpstream, setFixtureSourceForTests, type FixtureRequest } from '../src/npc/upstream-fixture.ts';
import { setTimingForTests, setUpstreamForTests, type Timing, type UpstreamCall } from '../src/npc/upstream.ts';
import { uuidv7 } from '../src/uuidv7.ts';
import { harness, playToken, type Harness } from './npc-helpers.ts';
import endConversation from './fixtures/anthropic/end-conversation.sse?raw';
import errorSpend from './fixtures/anthropic/error-400-spend-limit.sse?raw';
import error429 from './fixtures/anthropic/error-429.sse?raw';
import error429Long from './fixtures/anthropic/error-429-long.sse?raw';
import error529 from './fixtures/anthropic/error-529.sse?raw';
import escapes from './fixtures/anthropic/escapes.sse?raw';
import happy from './fixtures/anthropic/happy.sse?raw';
import happyCached from './fixtures/anthropic/happy-cached.sse?raw';
import happyEffects from './fixtures/anthropic/happy-effects.sse?raw';
import heroFallback from './fixtures/anthropic/hero-fallback-served.sse?raw';
import heroSonnet from './fixtures/anthropic/hero-sonnet.sse?raw';
import invalidJson from './fixtures/anthropic/invalid-json.sse?raw';
import longLine from './fixtures/anthropic/long-line.sse?raw';
import maxTokens from './fixtures/anthropic/max-tokens.sse?raw';
import nameHit from './fixtures/anthropic/name-hit.sse?raw';
import refusal from './fixtures/anthropic/refusal.sse?raw';
import slow3 from './fixtures/anthropic/slow-3s.sse?raw';
import slowFirst from './fixtures/anthropic/slow-first-text.sse?raw';

/** The recorded-style streams of test/fixtures/anthropic by name. */
export const FIXTURES = {
  happy, 'happy-cached': happyCached, 'happy-effects': happyEffects, 'end-conversation': endConversation, escapes, 'long-line': longLine,
  'slow-first-text': slowFirst, 'slow-3s': slow3, refusal, 'invalid-json': invalidJson, 'max-tokens': maxTokens, 'name-hit': nameHit,
  'hero-fallback-served': heroFallback, 'hero-sonnet': heroSonnet,
  'error-429': error429, 'error-429-long': error429Long, 'error-529': error529, 'error-400-spend-limit': errorSpend,
} as const;
export type FixtureName = keyof typeof FIXTURES;

/** Time of the suites: virtual timers for the 4 s rule, the fixture pacing and the kill poll; `now` is the same virtual time. */
export class ManualClock implements Timing {
  t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.timers.delete(h as number);
  }
  now(): number {
    return this.t;
  }
  /** Moves time forward in 100 ms steps, letting promise callbacks (and Durable Object calls) run between steps. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    while (this.t < end) {
      this.t = Math.min(this.t + 100, end);
      for (const [id, tm] of [...this.timers]) {
        if (tm.at <= this.t) {
          this.timers.delete(id);
          tm.fn();
        }
      }
      await flush();
    }
  }
}
export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 2));

export interface Frame {
  event: string;
  data: Record<string, unknown>;
  /** Virtual time at which the frame arrived. */
  at: number;
}

export const context = (over: Partial<NPCDialogueContext> = {}): NPCDialogueContext => ({
  schema: 1,
  clockT: 7200,
  chunkKey: '9/256/256',
  poiId: null,
  mode: 'story',
  missionId: null,
  missionStep: null,
  player: { heat: 0, inVehicle: false, health: 'ok', streetCred: 10, techClout: 0 },
  relation: { trust: 5, met: true },
  events: [],
  offers: { missionIds: [], raceIds: [], dealIds: [] },
  tycoon: null,
  voice: 'auto',
  locale: 'en-US',
  ...over,
});

export const request = (over: Partial<NPCDialogueRequest> = {}): NPCDialogueRequest => ({
  npcId: 'npc_test',
  soulVersion: 1,
  turn: { text: 'hello there', intent: 'greet' },
  context: context(),
  maxTokens: 512,
  ...over,
});

/** A request body with extra top-level fields (a forged history, for instance). */
export type RawBody = Record<string, unknown>;

export interface Talk {
  h: Harness;
  clock: ManualClock;
  pid: string;
  dkt: string;
  /** Posts a talk request as this player (or as `pid` when given) and returns the response without reading the body. */
  post(body: RawBody | NPCDialogueRequest, init?: { npcId?: string; token?: string | null; pid?: string }): Promise<Response>;
  /**
   * Reads a streaming response to its end while the virtual clock runs, then waits for the commit work. `at` maps a virtual time (ms from
   * the start of the read) to something to do once that time has passed (kill the NPC, for example).
   */
  read(res: Response, opts?: { maxMs?: number; at?: Record<number, () => Promise<void>> }): Promise<Frame[]>;
  /** Every request the upstream saw, in order, once `recordCalls` has run. */
  calls: { call: UpstreamCall; req: FixtureRequest }[];
  /** Wraps the fixture upstream so the suite can see each request body and its headers. */
  recordCalls(): void;
  /** post + read. */
  say(body: RawBody | NPCDialogueRequest, init?: { npcId?: string }): Promise<{ res: Response; frames: Frame[] }>;
  dispose(): void;
}

export interface TalkOptions {
  fixture?: FixtureName | ((req: { model: string; hero: boolean; turnIndex: number }) => string);
  env?: Partial<Env>;
}

/** The PRIVATE bucket holds a distinct block B (the bundled bytes plus a marker), so a test can tell PRIVATE from the bundled fallback. */
export const PRIVATE_MARKER = '\n<!-- from PRIVATE -->\n';
export const PRIVATE_PROMPT = `${(bundled.souls as Record<string, { prompt: string }>)['npc_test']!.prompt}${PRIVATE_MARKER}`;

export async function seedSouls(over: { npcTestVersion?: number; extra?: Record<string, { version: number; compiled: Record<string, unknown>; prompt?: string }> } = {}): Promise<void> {
  const npcTest = (bundled.souls as Record<string, { compiled: Record<string, unknown> }>)['npc_test']!;
  const index: Record<string, { soulVersion: number }> = { npc_test: { soulVersion: over.npcTestVersion ?? 1 } };
  const put = async (id: string, version: number, compiled: Record<string, unknown>, prompt: string): Promise<void> => {
    await env.PRIVATE.put(`souls/${id}/${version}/soul.prompt.txt`, prompt);
    await env.PRIVATE.put(`souls/${id}/${version}/soul.compiled.json`, JSON.stringify({ ...compiled, id, soulVersion: version }));
  };
  const v = over.npcTestVersion ?? 1;
  await put('npc_test', v, npcTest.compiled, PRIVATE_PROMPT);
  if (v > 1) await put('npc_test', v - 1, npcTest.compiled, PRIVATE_PROMPT);
  for (const [id, s] of Object.entries(over.extra ?? {})) {
    index[id] = { soulVersion: s.version };
    await put(id, s.version, s.compiled, s.prompt ?? PRIVATE_PROMPT);
  }
  await env.PRIVATE.put('souls/index.json', JSON.stringify({ schema: 'souls-index/1', rosterVersion: 1, souls: index }));
  dropSoulCache();
}

/** A hero soul: npc_test's compiled soul with the hero role and the Sonnet tier. */
export function heroSoul(): Record<string, unknown> {
  const base = (bundled.souls as Record<string, { compiled: Record<string, unknown> }>)['npc_test']!.compiled as { roles: object; dialogue: object };
  return { ...base, roles: { ...base.roles, hero: true }, dialogue: { modelTier: 'sonnet', maxTurnsPerEncounter: 6 } };
}

/** Flags and governor state live in KV and a Durable Object, which survive from one test to the next: put them back to "all clear". */
export async function resetFlags(): Promise<void> {
  for (const key of ['gov:level', 'ks:anthropic', 'ks:anthropic:sonnet', 'ks:genai:all', 'ks:likeness:npc_test', 'ks:likeness:npc_hero', 'flags:features']) await env.FLAGS.delete(key);
  const gov = env.GOVERNOR.get(env.GOVERNOR.idFromName(`gov:${env.ENVIRONMENT}`)) as unknown as { forceLevel(l: number, by: string, reason: string): Promise<void> };
  await gov.forceLevel(0, 'test', 'reset');
  await env.FLAGS.delete('gov:level');
}

/** Pre-built app, clock, souls and fixture choice. `dispose` restores every seam. */
export async function talkSetup(opts: TalkOptions = {}): Promise<Talk> {
  await resetFlags();
  // The Rate Limiting binding counts real time (4 per 10 s per player): off here, a suite that tests it passes its own stub.
  const h = harness({ env: { RL_TALK: undefined, ...opts.env } });
  const clock = new ManualClock();
  setTimingForTests(clock);
  const choose = opts.fixture ?? 'happy';
  setFixtureSourceForTests((req) => (typeof choose === 'function' ? choose(req) : FIXTURES[choose]));
  setUpstreamForTests(null);
  setModerationForTests(null);
  setNameRegistryForTests(null);
  await seedSouls();
  const pid = uuidv7();
  const dkt = `dkt-${pid}`;
  const talk: Talk = {
    h,
    clock,
    pid,
    dkt,
    async post(body, init = {}) {
      const who = init.pid ?? pid;
      const token = init.token === undefined ? await playToken(who, `dkt-${who}`, h.clock.t) : init.token;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token !== null) headers['Authorization'] = `PlayToken ${token}`;
      return h.api(`/api/v1/npc/${init.npcId ?? 'npc_test'}/talk`, { method: 'POST', headers, body: JSON.stringify(body) });
    },
    calls: [],
    recordCalls() {
      const inner = fixtureUpstream(clock);
      setUpstreamForTests({
        mode: 'fixture',
        stream: (call, signal, req) => {
          talk.calls.push({ call, req });
          return inner.stream(call, signal, req);
        },
      });
    },
    async read(res, opts = {}) {
      const maxMs = opts.maxMs ?? 20_000;
      const pending = Object.entries(opts.at ?? {}).map(([ms, fn]) => ({ ms: Number(ms), fn })).sort((a, b) => a.ms - b.ms);
      const frames: Frame[] = [];
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let ended = false;
      const pump = (async () => {
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          buf += dec.decode(r.value, { stream: true });
          for (;;) {
            const cut = buf.indexOf('\n\n');
            if (cut < 0) break;
            const block = buf.slice(0, cut);
            buf = buf.slice(cut + 2);
            const ev = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (ev !== undefined && data !== undefined) frames.push({ event: ev, data: JSON.parse(data) as Record<string, unknown>, at: clock.t });
          }
        }
        ended = true;
      })();
      const started = clock.t;
      while (!ended) {
        await clock.advance(100);
        while (pending.length > 0 && clock.t - started >= pending[0]!.ms) await pending.shift()!.fn();
        if (clock.t - started > maxMs) throw new Error(`the stream did not end within ${maxMs} virtual ms; frames so far: ${frames.map((f) => f.event).join(',')}`);
      }
      await pump;
      await drainTalk();
      return frames;
    },
    async say(body, init = {}) {
      const res = await talk.post(body, init);
      if (res.headers.get('Content-Type')?.startsWith('text/event-stream') !== true) return { res, frames: [] };
      return { res, frames: await talk.read(res) };
    },
    dispose() {
      setTimingForTests(null);
      setFixtureSourceForTests(null);
      setUpstreamForTests(null);
      setModerationForTests(null);
      setNameRegistryForTests(null);
      dropSoulCache();
      h.dispose();
    },
  };
  return talk;
}

export const names = (frames: readonly Frame[]): string[] => frames.map((f) => f.event);
export const find = (frames: readonly Frame[], event: DialogueEvent['event']): Frame | undefined => frames.find((f) => f.event === event);
export const textOf = (frames: readonly Frame[]): string => frames.filter((f) => f.event === 'line.delta').map((f) => String(f.data['text'] ?? '')).join('');

/** Today's counters of a player's quota object (`turn`, `cost_micros`, `npc:<id>`, ...). */
export async function quotaUsage(pid: string): Promise<Record<string, number>> {
  const stub = env.QUOTA.get(env.QUOTA.idFromName(`q:p:${pid}`)) as unknown as { usage(): Promise<Record<string, number>> };
  return stub.usage();
}

/** The text a fixture's stream carries, concatenated from its text deltas. */
export function fixtureText(sse: string): string {
  let out = '';
  for (const m of sse.matchAll(/^data: (.+)$/gm)) {
    const ev = JSON.parse(m[1] as string) as { type?: string; delta?: { type?: string; text?: string } };
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') out += ev.delta.text ?? '';
  }
  return out;
}
