import { NPC_GUARDRAILS, sha256Hex, type GovLevel } from '@dv/shared';
import type { CompiledSoul, DialogueEvent, FallbackReason, InkKnot, NPCDialogueRequest } from '@dv/shared/contracts/c10-npc';
import { inkKnotFor, normalizeTurnJson, renderScene, validateDialogueRequest, validateNpcTurn, validateTurn, type ExecutorScene, type NpcTurnOutput } from '@dv/shared/npc';
import { nextUtcMidnight, now } from '../clock.ts';
import { playerQuota } from '../budget/quota.ts';
import { apiError } from '../errors.ts';
import { isKilled } from '../flags/roster.ts';
import { activeKillSwitches, featureOn, governorLevel } from '../flags/ks.ts';
import { authenticatePlayer } from '../id/tofu.ts';
import type { Ctx } from '../router.ts';
import { writeServerEvent } from '../telemetry/server.ts';
import { UUIDV7_PATTERN, uuidv7 } from '../uuidv7.ts';
import type { BeginResult, EncounterDO } from './EncounterDO.ts';
import { LineScanner } from './scanner.ts';
import { assemblePrompt, asHaikuRequest, type AssembledPrompt, type HistoryMessage } from './prompt.ts';
import { clampMaxTokens, offlineReason, routeModel, type RoutedModel } from './router.ts';
import { moderation, outputNameHit, preFilter } from './safety.ts';
import { costMicros, emptyUsage, mergeUsage, type Usage } from './settle.ts';
import { activeSoulVersion, loadBlockA, loadSoul, temperamentOf, type LoadedSoul } from './souls.ts';
import { sseStream, watchKill } from './sse.ts';
import { anthropicMode, currentTiming, selectUpstream, UpstreamError, type Timing, type Upstream, type UpstreamCall } from './upstream.ts';

/**
 * DialogueService (route 31, `POST /api/v1/npc/:npcId/talk`; 04-npc.md section 5.1, M06a3). Every check that can fail before the model is
 * called answers C12 `ApiError` JSON; from the first byte on, a failure is a `fallback` event (the client then plays ink).
 *
 * Order: play token, body schema, feature flag, RL_TALK, kill switches and roster, governor, soul version, input prefilter, encounter
 * (`EncounterDO.begin`), quota reservation, prompt, stream. The history is always the one `EncounterDO` holds. Nothing here logs or stores
 * prompts, player text or model output; transcripts live only in the encounter object and PRIVATE.
 */
const BODY_LIMIT = 16 * 1024;
const NPC_ID = /^[a-z][a-z0-9_-]{2,47}$/;
const SONNET_ESTIMATE_FACTOR = 20;
const WRAP_UP_NOTE = '<system_note>This is the last turn of this conversation. Wrap up in character and set end_conversation to true.</system_note>';

type EncounterRpc = DurableObjectStub<EncounterDO>;

/** Work that continues after the response body ended (settlement, commit, moderation). Tests await it with `drainTalk`. */
const inflight = new Set<Promise<void>>();
export async function drainTalk(): Promise<void> {
  while (inflight.size > 0) await Promise.allSettled([...inflight]);
}

/** The memory hook of step 4. M06a4 fills it; until then no memory enters the prompt. */
export interface MemoryHook {
  retrieve(input: { profileId: string; npcId: string }): Promise<{ summary: string; hits: [] }>;
}
export const memoryHook: MemoryHook = { retrieve: () => Promise.resolve({ summary: '', hits: [] }) };

interface TurnState {
  usage: Usage | null;
  model: string | undefined;
  /** The assistant's JSON text exactly as the model wrote it (history stays byte-identical). */
  assistantJson: string | null;
  /** Micros the turn cost when the usage is known (done and fallbacks after a response), else null. */
  cost: number | null;
  closed: boolean;
  endConversation: boolean;
}

type Item = { k: 'text'; text: string } | { k: 'end'; stop: string | null; text: string; usage: Usage; model: string | undefined };

async function* oneAttempt(upstream: Upstream, call: UpstreamCall, signal: AbortSignal, fixture: Parameters<Upstream['stream']>[2]): AsyncGenerator<Item> {
  const scanner = new LineScanner();
  const usage = emptyUsage();
  let model: string | undefined;
  let stop: string | null = null;
  for await (const ev of upstream.stream(call, signal, fixture)) {
    if (ev.type === 'message_start') {
      const m = ev['message'] as { model?: unknown; usage?: unknown } | undefined;
      if (typeof m?.model === 'string') model = m.model;
      mergeUsage(usage, m?.usage);
    } else if (ev.type === 'content_block_delta') {
      const d = ev['delta'] as { type?: unknown; text?: unknown } | undefined;
      if (d?.type === 'text_delta' && typeof d.text === 'string') {
        const fresh = scanner.feed(d.text);
        if (fresh !== '') yield { k: 'text', text: fresh };
      }
    } else if (ev.type === 'message_delta') {
      const d = ev['delta'] as { stop_reason?: unknown } | undefined;
      if (typeof d?.stop_reason === 'string') stop = d.stop_reason;
      mergeUsage(usage, ev['usage']);
    } else if (ev.type === 'error') {
      throw new UpstreamError(529, 'error event in stream');
    }
  }
  yield { k: 'end', stop, text: scanner.text(), usage, model };
}

function sleep(timing: Timing, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const h = timing.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { timing.clearTimeout(h); resolve(); }, { once: true });
  });
}

interface TurnRun {
  ctx: Ctx;
  upstream: Upstream;
  assembled: AssembledPrompt;
  headers: Record<string, string>;
  routed: RoutedModel;
  loaded: LoadedSoul;
  req: NPCDialogueRequest;
  turnIndex: number;
  turnsLeft: number;
  scene: ExecutorScene;
  knot: InkKnot;
  state: TurnState;
}

const fallback = (reason: FallbackReason, knot: InkKnot): DialogueEvent => ({ event: 'fallback', data: { reason, knot } });

/** The events of one turn after `meta`: `line.delta`*, `line.done`, `effects`, `done`, or a `fallback`. The 4 s first-token rule is the transport's. */
async function* turnEvents(r: TurnRun, signal: AbortSignal): AsyncGenerator<DialogueEvent> {
  const timing = currentTiming();
  const t0 = timing.now();
  const windowMs = NPC_GUARDRAILS.encounter.firstTokenMs;
  const fixture = { npcId: r.req.npcId, intent: r.req.turn.intent ?? 'text', turnIndex: r.turnIndex, model: String(r.assembled.body['model']), hero: r.routed.tier === 'sonnet' };
  let assembled = r.assembled;
  let retried = false;
  let seq = 0;
  let started = false;
  let end: Extract<Item, { k: 'end' }> | null = null;

  while (end === null) {
    try {
      const call: UpstreamCall = { body: assembled.body, betas: assembled.betas, headers: r.headers };
      for await (const item of oneAttempt(r.upstream, call, signal, { ...fixture, model: String(assembled.body['model']) })) {
        if (item.k === 'text') {
          started = true;
          yield { event: 'line.delta', data: { seq: seq++, text: item.text } };
        } else {
          end = item;
        }
      }
    } catch (e) {
      if (signal.aborted) return;
      if (e instanceof UpstreamError && !started && !e.spendLimit && !retried) {
        if (e.status === 429 && assembled.body['model'] === 'claude-sonnet-5-5') {
          // the gateway's Sonnet spend rule answers 429: re-issue once, at once, as the Haiku request (DL-545 b)
          retried = true;
          assembled = asHaikuRequest(assembled);
          continue;
        }
        if (e.status === 429 || e.status === 529) {
          const wait = e.retryAfterMs ?? 500;
          if (timing.now() - t0 + wait < windowMs) {
            retried = true;
            await sleep(timing, wait, signal);
            if (signal.aborted) return;
            continue;
          }
        }
      }
      yield fallback('upstream', r.knot);
      return;
    }
  }

  r.state.usage = end.usage;
  r.state.model = end.model;
  const priced = costMicros(end.usage, end.model);
  r.state.cost = priced.micros;
  if (!priced.priced) r.ctx.deps.log(JSON.stringify({ event: 'genai.cost.unpriced', model: end.model ?? 'unknown' }));

  // Branch on stop_reason before reading any content.
  if (end.stop === 'refusal') {
    yield fallback('refusal', 'deflect');
    return;
  }
  if (end.stop !== 'end_turn' && end.stop !== 'stop_sequence') {
    yield fallback('invalid_output', r.knot);
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(end.text);
  } catch {
    yield fallback('invalid_output', r.knot);
    return;
  }
  const normalized = normalizeTurnJson(raw);
  if (validateNpcTurn(normalized).length > 0 || (normalized as NpcTurnOutput).line.trim() === '') {
    yield fallback('invalid_output', r.knot);
    return;
  }
  const c = r.loaded.compiled;
  const checked = validateTurn(
    normalized as NpcTurnOutput,
    { roles: c.roles, archetype: c.archetype, temperament: temperamentOf(c), maxWordsPerLine: c.speech.maxWordsPerLine },
    r.scene,
  );
  if (await outputNameHit(r.ctx.env, checked.line, c)) {
    yield fallback('moderation', 'deflect');
    return;
  }
  r.state.assistantJson = end.text;
  r.state.endConversation = checked.effects.endConversation === true;
  r.state.closed = r.state.endConversation || r.turnsLeft <= 0;
  yield { event: 'line.done', data: { text: checked.line, words: checked.words } };
  yield { event: 'effects', data: checked.effects };
  yield { event: 'done', data: { costMicros: priced.micros, turnsLeft: r.turnsLeft, closed: r.state.closed } };
}

const toHistory = (items: { role: 'user' | 'assistant'; content: unknown }[]): HistoryMessage[] =>
  items.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));

async function readJson(request: Request): Promise<unknown | undefined> {
  const text = await request.text();
  if (text.length === 0 || text.length > BODY_LIMIT) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function talk(ctx: Ctx, npcId: string): Promise<Response> {
  const { env, requestId, deps } = ctx;
  if (!NPC_ID.test(npcId)) return apiError('bad_request', 'The NPC id is not valid.', requestId);

  const auth = await authenticatePlayer(ctx);
  if (auth instanceof Response) return auth;
  const pid = auth.profileId;

  const body = await readJson(ctx.request);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return apiError('bad_request', 'The body must be a JSON object.', requestId);
  // The history is the server's (DL-046): a client-sent history is ignored, whatever it holds.
  const { history: _ignored, ...rest } = body as Record<string, unknown>;
  const issues = validateDialogueRequest(rest);
  if (issues.length > 0) return apiError('bad_request', `Invalid talk request: ${issues[0]?.path ?? ''} ${issues[0]?.message ?? ''}`.trim(), requestId);
  const req = rest as unknown as NPCDialogueRequest;
  if (req.npcId !== npcId) return apiError('bad_request', 'The body npcId does not match the path.', requestId);
  if (req.turn.text === undefined && req.turn.intent === undefined) return apiError('bad_request', 'A turn needs text or an intent.', requestId);
  if (req.encounterId !== undefined && !UUIDV7_PATTERN.test(req.encounterId)) return apiError('bad_request', 'The encounter id is not valid.', requestId);

  if (!(await featureOn(env, 'npc.dialogue'))) return apiError('feature_disabled', 'NPC dialogue is off.', requestId);

  if (env.RL_TALK) {
    let ok = true;
    try {
      ok = (await env.RL_TALK.limit({ key: pid })).success;
    } catch {
      ok = true; // a failing limiter must not block play; the quotas still hold
    }
    if (!ok) return apiError('rate_limited', 'Slow down a little.', requestId, { retryAfterMs: 10_000 });
  }

  // Kill switches, the roster kill and the governor.
  let ks: Set<string>;
  let gov: GovLevel;
  let rosterKilled: boolean;
  try {
    [ks, gov, rosterKilled] = await Promise.all([
      activeKillSwitches(env, ['ks:anthropic', 'ks:anthropic:sonnet', 'ks:genai:all', `ks:likeness:${npcId}`], now()),
      governorLevel(env),
      isKilled(env, deps, npcId),
    ]);
  } catch {
    return apiError('upstream_unavailable', 'The roster is temporarily unavailable.', requestId, { retryAfterMs: 5000 });
  }
  if (rosterKilled || ks.has(`ks:likeness:${npcId}`)) return apiError('kill_switched', 'This character is not available.', requestId);
  if (offlineReason(gov, ks) !== null) return apiError('budget_offline', 'Dialogue is offline for now.', requestId, { retryAfterMs: 60_000 });

  // The soul: unknown id, stale version, and the bytes of block A and B.
  let loaded: LoadedSoul | null;
  let blockA: string | null;
  try {
    const cur = await activeSoulVersion(env, npcId);
    if (cur === null) return apiError('not_found', 'No such character.', requestId);
    if (req.soulVersion !== cur && req.soulVersion !== cur - 1) {
      return apiError('conflict', 'The character has changed; reload the roster.', requestId, { details: { reason: 'soul_version', soulVersion: cur } });
    }
    loaded = await loadSoul(env, npcId, req.soulVersion);
    if (loaded === null) {
      return req.soulVersion === cur
        ? apiError('upstream_unavailable', 'The character is not available.', requestId, { retryAfterMs: 5000 })
        : apiError('conflict', 'The character has changed; reload the roster.', requestId, { details: { reason: 'soul_version', soulVersion: cur } });
    }
    blockA = await loadBlockA(env, loaded.compiled.rulesVersion);
  } catch {
    return apiError('upstream_unavailable', 'The character is not available.', requestId, { retryAfterMs: 5000 });
  }
  if (blockA === null) return apiError('upstream_unavailable', 'The character rules are not available.', requestId, { retryAfterMs: 5000 });

  const pre = preFilter(req.turn.text);
  if (pre.verdict === 'slur') return apiError('moderation_blocked', 'That cannot be said here.', requestId);

  const upstream = selectUpstream(env);
  if (upstream === null) return apiError('upstream_unavailable', 'Dialogue is not available.', requestId, { retryAfterMs: 30_000 });

  // The encounter: one instance per (player, NPC, encounter), addressed from the token, never from the body.
  const encounterId = req.encounterId ?? uuidv7();
  const stub = env.ENCOUNTER.get(env.ENCOUNTER.idFromName(`enc:${pid}:${npcId}:${encounterId}`)) as EncounterRpc;
  const compiled: CompiledSoul = loaded.compiled;
  const cap = Math.min(Math.max(compiled.dialogue.maxTurnsPerEncounter, 1), NPC_GUARDRAILS.encounter.turnCapHard);
  const status = await stub.status();
  if (status.killed) return apiError('kill_switched', 'This character is not available.', requestId);
  const lastTurn = status.turns + 1 >= cap;

  const mem = await memoryHook.retrieve({ profileId: pid, npcId });
  let userMessage = renderScene(req.context, mem, { ...(pre.text === '' ? {} : { text: pre.text }), ...(req.turn.intent === undefined ? {} : { intent: req.turn.intent }) });
  if (pre.piiRemoved) userMessage = userMessage.replace(/<player intent="([^"]*)"/, '<player intent="$1" pii_removed="true"');
  if (lastTurn) userMessage += `${WRAP_UP_NOTE}\n`;

  const begun = (await stub.begin({ profileId: pid, npcId, encounterId, soulVersion: req.soulVersion, turn: userMessage, turnCap: cap })) as BeginResult;
  if (!begun.ok) {
    if (begun.reason === 'killed') return apiError('kill_switched', 'This character is not available.', requestId);
    if (begun.reason === 'cadence') return apiError('rate_limited', 'Slow down a little.', requestId, { retryAfterMs: NPC_GUARDRAILS.encounter.cadenceMs });
    return apiError('conflict', begun.reason === 'busy' ? 'The character is still answering.' : 'This conversation is over.', requestId, { details: { reason: begun.reason } });
  }
  const turnIndex = begun.turnIndex;

  const routed = routeModel({ roles: compiled.roles, dialogue: compiled.dialogue }, gov, ks);
  const est = NPC_GUARDRAILS.estimates.turnUsdMicros * (routed.tier === 'sonnet' ? SONNET_ESTIMATE_FACTOR : 1);
  const quota = playerQuota(env, pid);
  const reserved = await quota.reserve({ kind: 'turn', npcId, estMicros: est });
  if (!reserved.ok) {
    await stub.abort(turnIndex, 'upstream');
    return apiError('quota_exhausted', 'You have talked a lot today. Come back tomorrow.', requestId, { retryAfterMs: Math.max(1000, nextUtcMidnight(now()) - now()), details: { reason: reserved.reason } });
  }

  const assembled = assemblePrompt({
    blockA,
    blockB: loaded.prompt,
    history: toHistory(begun.history),
    userMessage,
    routed,
    maxTokens: clampMaxTokens(req.maxTokens),
  });
  const headers = {
    'cf-aig-metadata': JSON.stringify({ pid: sha256Hex(pid), tier: 'anon', env: env.AIG_ENV ?? env.ENVIRONMENT }),
    'cf-aig-collect-log-payload': 'false',
  };
  const turnsLeft = Math.max(0, cap - (turnIndex + 1));
  const knot = inkKnotFor(req.context, req.turn.intent);
  const state: TurnState = { usage: null, model: undefined, assistantJson: null, cost: null, closed: false, endConversation: false };
  const scene: ExecutorScene = { mode: req.context.mode, offers: req.context.offers, ...(pre.verdict === 'self_harm' || lastTurn ? { forceEnd: true } : {}) };
  const crisis = begun.safety === 'crisis' || pre.verdict === 'self_harm';
  const meta: Extract<DialogueEvent, { event: 'meta' }> = {
    event: 'meta',
    data: {
      encounterId,
      turnIndex,
      npcId,
      soulVersion: req.soulVersion,
      model: routed.tier,
      voice: 'text',
      turnsLeft,
      disclosure: { aiCharacter: true, disclaimer: compiled.likeness.disclaimer },
      gov,
      ...(crisis ? { safety: 'crisis' as const } : {}),
    },
  };

  const timing = currentTiming();
  const watch = watchKill(() => stub.status(), 250, timing);
  let resolveWork: () => void = () => undefined;
  const work = new Promise<void>((resolve) => {
    resolveWork = resolve;
  });
  inflight.add(work);
  void work.finally(() => inflight.delete(work));
  ctx.exec?.waitUntil(work);
  // A stream that never reports back must not hold the invocation open: the work promise gives up after 2 minutes.
  const giveUp = setTimeout(() => resolveWork(), 120_000);
  void work.finally(() => clearTimeout(giveUp));

  let finished = false;
  const settle = async (micros: number): Promise<void> => {
    try {
      await quota.settle(reserved.reservationId, micros, { vendor: 'anthropic', model: state.model ?? String(assembled.body['model']) });
    } catch {
      // the answer never waits on the spend ledger
    }
  };
  const commit = async (outcome: 'done' | 'timeout' | 'refusal' | 'upstream' | 'client_gone'): Promise<void> => {
    if (finished) return;
    finished = true;
    watch.stop();
    try {
      if (outcome === 'done' && state.assistantJson !== null && state.usage !== null) {
        const u = state.usage;
        const micros = state.cost ?? 0;
        try {
          await stub.complete(turnIndex, state.assistantJson, { inTok: u.input, outTok: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite5m + u.cacheWrite1h, usdMicros: micros });
        } catch {
          // the turn is not stored (the encounter restarted); the money was still spent, so settlement goes on
        }
        await settle(micros);
        writeServerEvent(env, 'genai.cost', { vendor: 'anthropic', model: costMicros(u, state.model).label, usdMicros: micros, cacheHit: u.cacheRead > 0, tier: 'local' }, now());
        if (state.closed) await stub.close();
        await moderation.check(deps, { npcId, text: pre.text, flagCrisis: () => stub.flagSafety() });
      } else {
        await stub.abort(turnIndex, outcome === 'done' ? 'upstream' : outcome);
        const micros = state.cost ?? 0;
        await settle(micros);
        if (micros > 0 && state.usage !== null) {
          writeServerEvent(env, 'genai.cost', { vendor: 'anthropic', model: costMicros(state.usage, state.model).label, usdMicros: micros, cacheHit: state.usage.cacheRead > 0, tier: 'local' }, now());
        }
      }
    } catch {
      // the stream is already over; the encounter alarm and the nightly reconciliation catch a lost write
    } finally {
      resolveWork();
    }
  };

  const run: TurnRun = { ctx, upstream, assembled, headers, routed, loaded, req, turnIndex, turnsLeft, scene, knot, state };
  const stream = sseStream({
    meta,
    upstream: (signal) => turnEvents(run, signal),
    knot,
    onAbort: (reason) => commit(reason),
    onDone: () => commit('done'),
    killed: watch.signal,
    scheduler: timing,
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-DV-Npc-Mode': anthropicMode(env),
    },
  });
}
