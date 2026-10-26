import type { DraftView, DraftFields } from '@dv/shared/npc';
import { setBuilderSinkForTests, drainBuilder, pendingBuilderJobs } from '../src/npc-builder/queue.ts';
import { resetFallbackPortForTests } from '../src/npc-builder/port.ts';
import { setModerationFixtureForTests, type ModerationFixture } from '../src/npc-builder/moderation-openai.ts';
import { defaultFixtureText, fixtureUpstream, type FixtureRequest } from '../src/npc/upstream-fixture.ts';
import { setUpstreamForTests, type UpstreamCall } from '../src/npc/upstream.ts';
import type { Env } from '../src/env.ts';
import { playToken } from './npc-helpers.ts';
import { talkSetup, type Talk } from './talk-helpers.ts';

/**
 * Harness of the NPC builder suites (M06b1): the talk harness (app, in-memory database, manual clock, souls) with the builder flag on, no queue bound so jobs run
 * inline (`drain` waits for them), a play token for the player, and spies on every model call and every moderation call.
 */
export interface ModelCall {
  intent: string;
  npcId: string;
  call: UpstreamCall;
}

export interface Builder {
  t: Talk;
  pid: string;
  token: string;
  /** Every model call the Worker made, in order. */
  calls: ModelCall[];
  /** Every moderation vendor call, in order (`openai`, `llama_guard`). */
  vendors: string[];
  /** Calls the builder API as the player (or as another player with `as`). */
  api(method: string, path: string, body?: unknown, init?: { as?: string; headers?: Record<string, string>; env?: Partial<Env> }): Promise<Response>;
  /** Waits for the inline jobs. */
  drain(): Promise<void>;
  create(fields?: Partial<DraftFields>, backstory?: string): Promise<DraftView>;
  get(id: string, as?: string): Promise<DraftView>;
  /** create -> backstory -> validate -> soul (which probes) until the draft is `private` or stops. */
  toPrivate(fields?: Partial<DraftFields>): Promise<DraftView>;
  /** A play token for another player. */
  tokenFor(pid: string): Promise<string>;
  dispose(): void;
}

export const FIELDS: DraftFields = {
  name: 'Tomasa Quill',
  shortBio: 'Runs a late-night tamale cart in the Mission.',
  archetype: 'vendor',
  tags: ['street-food'],
  district: 'mission',
  voiceRef: null,
  appearancePreset: null,
};
export const BACKSTORY = 'She started the cart after the bakery closed. Now she knows every regular, every corner and every rumor of the block, and she feeds anyone who looks tired.';

export interface BuilderOptions {
  /** Chooses the stream of a model call; return undefined to use the default of fixture mode. */
  fixture?: (req: FixtureRequest) => string | undefined;
  moderation?: ModerationFixture;
  env?: Partial<Env>;
}

export async function builderSetup(opts: BuilderOptions = {}): Promise<Builder> {
  resetFallbackPortForTests();
  const t = await talkSetup({
    fixture: (req) => opts.fixture?.(req) ?? defaultFixtureText(req),
    env: { BUILDER: undefined, FLAGS_JSON: JSON.stringify({ 'npc.dialogue': true, 'npc.builder': true }), ...opts.env },
  });
  const calls: ModelCall[] = [];
  const vendors: string[] = [];
  const inner = fixtureUpstream(t.clock);
  setUpstreamForTests({
    mode: 'fixture',
    stream: (call, signal, req) => {
      calls.push({ intent: req.intent, npcId: req.npcId, call });
      return inner.stream(call, signal, req);
    },
  });
  setModerationFixtureForTests((text, vendor) => {
    vendors.push(vendor);
    return opts.moderation?.(text, vendor) ?? (vendor === 'openai' ? JSON.stringify({ results: [{ flagged: false, category_scores: {} }] }) : JSON.stringify({ response: { safe: true, categories: [] } }));
  });
  setBuilderSinkForTests(null);
  const pid = t.pid;
  const token = await playToken(pid, t.dkt, t.h.clock.t);
  const b: Builder = {
    t,
    pid,
    token,
    calls,
    vendors,
    async api(method, path, body, init = {}) {
      const tok = init.as === undefined ? token : await playToken(init.as, `dkt-${init.as}`, t.h.clock.t);
      const headers: Record<string, string> = { Authorization: `PlayToken ${tok}`, ...init.headers };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      return t.h.api(`/api/v1/npc-builder${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(init.env === undefined ? {} : { env: init.env }) });
    },
    async drain() {
      // The fixture upstream paces itself on the virtual clock of the suite: move it while a job runs.
      for (let i = 0; i < 400 && pendingBuilderJobs() > 0; i++) await t.clock.advance(300);
      await drainBuilder();
    },
    async create(fields = {}, backstory = BACKSTORY) {
      const res = await b.api('POST', '/drafts', { fields: { ...FIELDS, ...fields }, attestation: 'original' });
      if (res.status !== 201) throw new Error(`create answered ${res.status}: ${await res.text()}`);
      const draft = (await res.json()) as DraftView;
      const put = await b.api('PUT', `/drafts/${draft.id}`, { rev: draft.rev, backstory });
      if (put.status !== 200) throw new Error(`backstory answered ${put.status}: ${await put.text()}`);
      return (await put.json()) as DraftView;
    },
    async get(id, as) {
      const res = await b.api('GET', `/drafts/${id}`, undefined, as === undefined ? {} : { as });
      return (await res.json()) as DraftView;
    },
    async toPrivate(fields = {}) {
      const d = await b.create(fields);
      expectStatus(await b.api('POST', `/drafts/${d.id}/validate`), 202);
      await b.drain();
      expectStatus(await b.api('POST', `/drafts/${d.id}/soul`), 202);
      await b.drain();
      return b.get(d.id);
    },
    tokenFor: (p) => playToken(p, `dkt-${p}`, t.h.clock.t),
    dispose() {
      setUpstreamForTests(null);
      setModerationFixtureForTests(null);
      setBuilderSinkForTests(null);
      resetFallbackPortForTests();
      t.dispose();
    },
  };
  return b;
}

export function expectStatus(res: Response, status: number): Response {
  if (res.status !== status) throw new Error(`expected HTTP ${status}, got ${res.status}`);
  return res;
}

/** The fixture stream of a text answer (JSON object or string) for a model call. */
export { buildStream } from '../src/npc/upstream-fixture.ts';
