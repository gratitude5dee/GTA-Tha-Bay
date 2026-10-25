import { NPC_GUARDRAILS, type GovLevel, type Tier } from '@dv/shared';
import type { NPCDialogueRequest } from '@dv/shared/contracts/c10-npc';
import type { DraftPatch, NpcDraftRow, ServerDataPort } from '@dv/shared/data-port';
import {
  cleanSectionText,
  inkKnotFor,
  lintBuilderSoul,
  parseSoul,
  renderScene,
  validateDialogueRequest,
  writeSoulMd,
  BUILDER_SECTIONS,
  type CreateDraftReq,
  type DraftFields,
  type DraftView,
  type JobAccepted,
  type UpdateDraftReq,
} from '@dv/shared/npc';
import { now, nextUtcMidnight } from '../clock.ts';
import { apiError, json } from '../errors.ts';
import { activeKillSwitches, featureOn, governorLevel } from '../flags/ks.ts';
import { authenticatePlayer, type PlayerAuth } from '../id/tofu.ts';
import { turnEvents, type TurnRun, type TurnState } from '../npc/dialogue.ts';
import { assemblePrompt } from '../npc/prompt.ts';
import { clampMaxTokens, offlineReason, routeModel } from '../npc/router.ts';
import { sseStream } from '../npc/sse.ts';
import { loadBlockA, loadSoul } from '../npc/souls.ts';
import { anthropicMode, currentTiming } from '../npc/upstream.ts';
import type { Ctx } from '../router.ts';
import { UUIDV7_PATTERN, uuidv7 } from '../uuidv7.ts';
import { BUILDER, lintEnvFor, realNameMatchers } from './data.ts';
import { checkFields, cleanBackstory } from './fields.ts';
import { builderUpstream, BuilderUnavailable, recordBuilderSpend } from './llm.ts';
import { limitsLeft, liveDraftLimit, reserveSoulGeneration, takePreviewTurn } from './limits.ts';
import { stepEvent, withJob } from './jobs.ts';
import { builderPort } from './port.ts';
import { neutralContext } from './probes.ts';
import { enqueueBuilderJob } from './queue.ts';
import { REQUEST_FROM, move } from './states.ts';
import { draftView, type StoredJob } from './view.ts';
import { playerQuota } from '../budget/quota.ts';

/**
 * Route 33, the P0 sub-paths (`/api/v1/npc-builder/...`, 04-npc-builder.md section C3; M06b1). Every route needs a play token and the flag
 * `npc.builder` (kill switch `ks:npc_builder`); a draft that is not the caller's answers `not_found`. Images and submit are `tier_required` for a P0
 * player (M06b2 serves them), assets and the community list are `feature_disabled` for now (M06b4, M06b2).
 */
const PREFIX = '/api/v1/npc-builder';
const BODY_CAP = 256 * 1024;
const PLAYER_TIER: Tier = 'local';
const IDEM_TTL_MS = 24 * 60 * 60 * 1000;

async function readJson(request: Request): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false }> {
  const text = await request.text();
  if (text.length === 0 || text.length > BODY_CAP) return { ok: false };
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? { ok: true, value: v as Record<string, unknown> } : { ok: false };
  } catch {
    return { ok: false };
  }
}

const conflict = (ctx: Ctx, state: string, extra: Record<string, unknown> = {}): Response =>
  apiError('conflict', `That is not possible while the draft is ${state}.`, ctx.requestId, { details: { reason: 'state', state, ...extra } });

interface Scope {
  ctx: Ctx;
  auth: PlayerAuth;
  port: ServerDataPort;
}

async function view(s: Scope, row: NpcDraftRow): Promise<DraftView> {
  return draftView(row, await limitsLeft(s.ctx.env, s.auth.profileId, PLAYER_TIER, row.id));
}

async function owned(s: Scope, id: string): Promise<NpcDraftRow | Response> {
  if (!UUIDV7_PATTERN.test(id)) return apiError('not_found', 'No such draft.', s.ctx.requestId);
  const row = await s.port.builder.getDraft(id);
  if (row === null || row.owner_profile_id !== s.auth.profileId) return apiError('not_found', 'No such draft.', s.ctx.requestId);
  return row;
}

function newNpcId(): string {
  return `u_${uuidv7().replace(/-/g, '').slice(-16)}`;
}

// ---- handlers --------------------------------------------------------------------------------------------------------------------------

async function createDraft(s: Scope): Promise<Response> {
  const { ctx } = s;
  const key = ctx.request.headers.get('Idempotency-Key');
  if (key !== null && !UUIDV7_PATTERN.test(key)) return apiError('bad_request', 'Idempotency-Key must be a UUIDv7.', ctx.requestId);
  const idemKey = key === null ? null : `idem/builder/${s.auth.profileId}/${key}`;
  if (idemKey !== null) {
    const hit = await ctx.env.PRIVATE.get(idemKey);
    if (hit !== null) {
      const rec = JSON.parse(await hit.text()) as { draftId: string; at: number };
      const row = rec.at + IDEM_TTL_MS > now() ? await s.port.builder.getDraft(rec.draftId) : null;
      if (row !== null) return json(await view(s, row), { status: 200 });
    }
  }
  const body = await readJson(ctx.request);
  if (!body.ok) return apiError('bad_request', 'The body must be a JSON object.', ctx.requestId);
  const req = body.value as Partial<CreateDraftReq>;
  if (req.attestation !== 'original') return apiError('bad_request', 'The attestation must be "original": a character you made up.', ctx.requestId);
  const fields = checkFields(req.fields, false);
  if (!fields.ok) return apiError('bad_request', fields.message, ctx.requestId);
  const created = await s.port.builder.createDraft(
    { id: uuidv7(), npcId: newNpcId(), ownerProfileId: s.auth.profileId, fields: fields.value as unknown as NpcDraftRow['fields'], attestation: 'original' },
    liveDraftLimit(PLAYER_TIER),
  );
  if (created === 'limit') return apiError('quota_exhausted', 'You have as many drafts as you can keep. Delete one to start another.', ctx.requestId, { details: { reason: 'live_drafts' } });
  if (idemKey !== null) await ctx.env.PRIVATE.put(idemKey, JSON.stringify({ draftId: created.id, at: now() }));
  stepEvent(ctx.env, 'create', true);
  return json(await view(s, created), { status: 201 });
}

async function listDrafts(s: Scope): Promise<Response> {
  const rows = await s.port.builder.listDrafts(s.auth.profileId);
  return json(await Promise.all(rows.map((r) => view(s, r))));
}

/** Applies the author's soul edits to the written soul. Returns the new bytes, or the lint issues that refuse them. */
async function applySoulEdits(s: Scope, row: NpcDraftRow, edits: NonNullable<UpdateDraftReq['soulEdits']>): Promise<{ ok: true; md: string; clean: boolean } | { ok: false; issues: unknown; message: string }> {
  if (row.soul_md === null) return { ok: false, issues: [], message: 'There is no written character to edit yet.' };
  const parsed = parseSoul(row.soul_md);
  const front = structuredClone(parsed.front) as unknown as Record<string, unknown>;
  const allowed = ['shortBio', 'speech', 'personality', 'schedule', 'goals', 'visual_brief', 'rails'];
  for (const [k, v] of Object.entries(edits.frontmatter ?? {})) {
    if (!allowed.includes(k)) return { ok: false, issues: [], message: `${k} cannot be edited` };
    const old = front[k];
    front[k] = typeof v === 'object' && v !== null && !Array.isArray(v) && typeof old === 'object' && old !== null && !Array.isArray(old) ? { ...(old as object), ...(v as object) } : v;
  }
  const sections = { ...parsed.sections };
  for (const [k, v] of Object.entries(edits.sections ?? {})) {
    if (!(BUILDER_SECTIONS as readonly string[]).includes(k) || typeof v !== 'string') return { ok: false, issues: [], message: `${k} is not a section that can be edited` };
    sections[k] = v;
  }
  const clean: Record<string, string> = {};
  for (const n of BUILDER_SECTIONS) clean[n] = n === 'Example lines' ? (sections[n] ?? '') : cleanSectionText(sections[n] ?? '');
  const md = writeSoulMd(front as never, clean);
  const lint = lintBuilderSoul(md, await lintEnvFor(s.ctx.env, (parsed.front.locations.districts[0] ?? '') as string));
  if (lint.issues.length > 0) return { ok: false, issues: lint.issues, message: 'The edited character does not pass the checks.' };
  const { matchers } = await realNameMatchers(s.ctx.env);
  return { ok: true, md, clean: !matchers.some((m) => m.re.test(md)) };
}

async function updateDraft(s: Scope, id: string): Promise<Response> {
  const { ctx } = s;
  const row = await owned(s, id);
  if (row instanceof Response) return row;
  const body = await readJson(ctx.request);
  if (!body.ok) return apiError('bad_request', 'The body must be a JSON object.', ctx.requestId);
  const req = body.value as Partial<UpdateDraftReq>;
  const header = ctx.request.headers.get('If-Match');
  const fromHeader = header === null ? null : Number(header.replace(/"/g, ''));
  if (fromHeader !== null && !Number.isInteger(fromHeader)) return apiError('bad_request', 'If-Match must be the revision number.', ctx.requestId);
  if (req.rev !== undefined && (!Number.isInteger(req.rev) || (fromHeader !== null && fromHeader !== req.rev))) return apiError('bad_request', 'rev and If-Match disagree.', ctx.requestId);
  const rev = fromHeader ?? req.rev;
  if (rev === undefined) return apiError('bad_request', 'Send the revision you are editing as If-Match or rev.', ctx.requestId);
  if (rev !== row.rev) return apiError('conflict', 'The draft changed. Reload it and edit again.', ctx.requestId, { details: { reason: 'rev', rev: row.rev } });
  if (!(REQUEST_FROM.edit as readonly string[]).includes(row.state)) return conflict(ctx, row.state);
  if (req.soulEdits !== undefined && (req.fields !== undefined || req.backstory !== undefined)) return apiError('bad_request', 'Edit the text or the written character, not both at once.', ctx.requestId);

  if (req.soulEdits !== undefined) {
    if (typeof req.soulEdits !== 'object' || req.soulEdits === null) return apiError('bad_request', 'soulEdits must be an object.', ctx.requestId);
    if (row.soul_md === null || !['soul_failed', 'soul_ready', 'private'].includes(row.state)) return conflict(ctx, row.state);
    const r = await applySoulEdits(s, row, req.soulEdits);
    if (!r.ok) return apiError('bad_request', r.message, ctx.requestId, { details: { lint: r.issues } });
    const jobId = uuidv7();
    const patch: DraftPatch = {
      state: move(row.state as 'soul_failed', 'soul_ready'),
      soul_md: r.md,
      lint: [],
      probes: null,
      publishable: row.publishable && r.clean,
      jobs: withJob(row.jobs, { id: jobId, kind: 'soul', state: 'queued' } satisfies StoredJob) as unknown as NpcDraftRow['jobs'],
    };
    const upd = await s.port.builder.updateDraft(row.id, patch, { ifRev: row.rev, fromStates: ['soul_failed', 'soul_ready', 'private'], bumpRev: true });
    if (upd === 'conflict') return apiError('conflict', 'The draft changed. Reload it and edit again.', ctx.requestId, { details: { reason: 'rev' } });
    if (upd === 'state' || upd === null) return conflict(ctx, 'busy');
    await enqueueBuilderJob(ctx.env, ctx.deps, ctx.exec, { type: 'probe', draftId: row.id, jobId }, ctx.requestId);
    return json(await view(s, upd));
  }

  const patch: DraftPatch = {};
  let textChanged = false;
  if (req.fields !== undefined) {
    const f = checkFields(req.fields, true);
    if (!f.ok) return apiError('bad_request', f.message, ctx.requestId);
    const merged = { ...(row.fields as unknown as DraftFields), ...f.value };
    if (JSON.stringify(merged) !== JSON.stringify(row.fields)) {
      patch.fields = merged as unknown as NpcDraftRow['fields'];
      textChanged = true;
    }
  }
  if (req.backstory !== undefined) {
    if (typeof req.backstory !== 'string') return apiError('bad_request', 'The backstory must be text.', ctx.requestId);
    const text = cleanBackstory(req.backstory);
    if (Array.from(text).length > NPC_GUARDRAILS.builder.backstoryCharsMax) return apiError('payload_too_large', 'The backstory can be 20,000 characters at most.', ctx.requestId);
    if (text !== row.backstory) {
      patch.backstory = text;
      textChanged = true;
    }
  }
  if (!textChanged) return json(await view(s, row));
  // New text has to be validated again: the moderation, the written character and the probes belonged to the old text.
  Object.assign(patch, { state: move(row.state as 'draft', 'draft'), moderation: {}, publishable: true, lint: [], probes: null });
  const upd = await s.port.builder.updateDraft(row.id, patch, { ifRev: row.rev, fromStates: REQUEST_FROM.edit, bumpRev: true });
  if (upd === 'conflict') return apiError('conflict', 'The draft changed. Reload it and edit again.', ctx.requestId, { details: { reason: 'rev' } });
  if (upd === 'state' || upd === null) return conflict(ctx, 'busy');
  return json(await view(s, upd));
}

async function deleteDraft(s: Scope, id: string): Promise<Response> {
  const row = await owned(s, id);
  if (row instanceof Response) return row;
  if (!(REQUEST_FROM.delete as readonly string[]).includes(row.state)) return conflict(s.ctx, row.state);
  const gone = await s.port.builder.deleteDraft(row.id, s.auth.profileId);
  if (gone === null) return apiError('not_found', 'No such draft.', s.ctx.requestId);
  for (const key of gone.promptKeys) {
    const base = key.replace(/\/soul\.prompt\.txt$/, '');
    await s.ctx.env.PRIVATE.delete([`${base}/soul.prompt.txt`, `${base}/soul.compiled.json`, `${base}/soul.ink`]);
  }
  return new Response(null, { status: 204 });
}

async function startValidate(s: Scope, id: string): Promise<Response> {
  const { ctx } = s;
  const row = await owned(s, id);
  if (row instanceof Response) return row;
  if (!(REQUEST_FROM.validate as readonly string[]).includes(row.state)) return conflict(ctx, row.state);
  if (Array.from(row.backstory).length < 10) return apiError('bad_request', 'Write a backstory first.', ctx.requestId);
  const jobId = uuidv7();
  const upd = await s.port.builder.updateDraft(
    row.id,
    { state: move('draft', 'validating'), jobs: withJob(row.jobs, { id: jobId, kind: 'validate', state: 'queued' } satisfies StoredJob) as unknown as NpcDraftRow['jobs'] },
    { fromStates: REQUEST_FROM.validate },
  );
  if (typeof upd !== 'object' || upd === null) return conflict(ctx, 'busy');
  await enqueueBuilderJob(ctx.env, ctx.deps, ctx.exec, { type: 'validate', draftId: row.id, jobId }, ctx.requestId);
  return json({ jobId, state: 'queued' } satisfies JobAccepted, { status: 202 });
}

async function offline(ctx: Ctx): Promise<Response | null> {
  const [ks, gov] = await Promise.all([activeKillSwitches(ctx.env, ['ks:anthropic', 'ks:genai:all'], now()), governorLevel(ctx.env)]);
  return offlineReason(gov as GovLevel, ks) === null ? null : apiError('budget_offline', 'Character writing is offline for now.', ctx.requestId, { retryAfterMs: 60_000 });
}

async function startSoul(s: Scope, id: string): Promise<Response> {
  const { ctx } = s;
  const row = await owned(s, id);
  if (row instanceof Response) return row;
  if (!(REQUEST_FROM.soul as readonly string[]).includes(row.state)) return conflict(ctx, row.state);
  const off = await offline(ctx);
  if (off !== null) return off;
  const reserved = await reserveSoulGeneration(ctx.env, s.auth.profileId, PLAYER_TIER, row.id);
  if (!reserved.ok) {
    return apiError('quota_exhausted', 'No more characters can be written for this draft right now. Come back later.', ctx.requestId, {
      retryAfterMs: Math.max(1000, nextUtcMidnight(now()) - now()),
      details: { reason: 'soul_generations' },
    });
  }
  const jobId = uuidv7();
  const upd = await s.port.builder.updateDraft(
    row.id,
    { state: move(row.state as 'text_ok', 'soul_generating'), lint: [], jobs: withJob(row.jobs, { id: jobId, kind: 'soul', state: 'queued' } satisfies StoredJob) as unknown as NpcDraftRow['jobs'] },
    { fromStates: REQUEST_FROM.soul },
  );
  if (typeof upd !== 'object' || upd === null) {
    await playerQuota(ctx.env, s.auth.profileId).release(reserved.reservationId);
    return conflict(ctx, 'busy');
  }
  await enqueueBuilderJob(ctx.env, ctx.deps, ctx.exec, { type: 'soul', draftId: row.id, jobId, reservationId: reserved.reservationId }, ctx.requestId);
  return json({ jobId, state: 'queued' } satisfies JobAccepted, { status: 202 });
}

/** A manual re-run of the probes on a written soul (they run by themselves after every soul change; this is the way out when they could not run). */
async function startProbe(s: Scope, id: string): Promise<Response> {
  const { ctx } = s;
  const row = await owned(s, id);
  if (row instanceof Response) return row;
  if (row.state !== 'soul_ready' || row.soul_md === null) return conflict(ctx, row.state);
  const jobId = uuidv7();
  await enqueueBuilderJob(ctx.env, ctx.deps, ctx.exec, { type: 'probe', draftId: row.id, jobId }, ctx.requestId);
  return json({ jobId, state: 'queued' } satisfies JobAccepted, { status: 202 });
}

async function preview(s: Scope, id: string): Promise<Response> {
  const { ctx } = s;
  const { env, requestId } = ctx;
  const row = await owned(s, id);
  if (row instanceof Response) return row;
  if (row.state !== 'private' || row.soul_version === null) return conflict(ctx, row.state);
  const body = await readJson(ctx.request);
  if (!body.ok) return apiError('bad_request', 'The body must be a JSON object.', requestId);
  const raw = body.value as { turn?: unknown; context?: unknown };
  const req = {
    npcId: row.npc_id,
    soulVersion: row.soul_version,
    turn: raw.turn,
    context: raw.context ?? neutralContext(),
    maxTokens: BUILDER.config.preview.maxTokens,
  };
  const issues = validateDialogueRequest(req);
  if (issues.length > 0) return apiError('bad_request', `Invalid preview request: ${issues[0]?.path ?? ''} ${issues[0]?.message ?? ''}`.trim(), requestId);
  const talkReq = req as unknown as NPCDialogueRequest;
  if (talkReq.turn.text === undefined && talkReq.turn.intent === undefined) return apiError('bad_request', 'A turn needs text or an intent.', requestId);
  const off = await offline(ctx);
  if (off !== null) return off;

  const loaded = await loadSoul(env, row.npc_id, row.soul_version);
  const blockA = await loadBlockA(env, BUILDER.config.rulesVersion);
  if (loaded === null || blockA === null) return apiError('upstream_unavailable', 'The character is not available.', requestId, { retryAfterMs: 5000 });
  let upstream;
  try {
    upstream = builderUpstream(env);
  } catch (e) {
    if (e instanceof BuilderUnavailable) return apiError('upstream_unavailable', 'Preview is not available.', requestId, { retryAfterMs: 30_000 });
    throw e;
  }
  // The turn is counted before the model is called: the twenty-first of the day is refused with no upstream request.
  if (!(await takePreviewTurn(env, s.auth.profileId, row.id))) {
    return apiError('quota_exhausted', 'No more preview turns for this draft today.', requestId, { retryAfterMs: Math.max(1000, nextUtcMidnight(now()) - now()), details: { reason: 'preview_turns' } });
  }
  const left = (await limitsLeft(env, s.auth.profileId, PLAYER_TIER, row.id)).previewTurnsLeft;
  const routed = routeModel({ roles: loaded.compiled.roles, dialogue: { modelTier: 'haiku' } }, 0, new Set());
  const scene = { mode: talkReq.context.mode, offers: talkReq.context.offers };
  const assembled = assemblePrompt({
    blockA,
    blockB: loaded.prompt,
    history: [],
    userMessage: renderScene(talkReq.context, { summary: '', hits: [] }, talkReq.turn),
    routed,
    maxTokens: clampMaxTokens(talkReq.maxTokens),
  });
  const state: TurnState = { memoryWrites: [], usage: null, model: undefined, assistantJson: null, cost: null, closed: false, endConversation: false };
  const knot = inkKnotFor(talkReq.context, talkReq.turn.intent);
  const run: TurnRun = {
    ctx,
    upstream,
    assembled,
    headers: { 'cf-aig-metadata': JSON.stringify({ workspace: 'npc-builder', env: env.AIG_ENV ?? env.ENVIRONMENT }), 'cf-aig-collect-log-payload': 'false' },
    routed,
    loaded,
    req: talkReq,
    turnIndex: 0,
    turnsLeft: left,
    scene,
    knot,
    state,
    tts: null,
  };
  const timing = currentTiming();
  let release: () => void = () => undefined;
  const work = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The spend of the turn is booked after the last byte, so the invocation is kept open for it (and given up after two minutes).
  ctx.exec?.waitUntil(work);
  const giveUp = setTimeout(() => release(), 120_000);
  const finish = async (ok: boolean): Promise<void> => {
    clearTimeout(giveUp);
    try {
      if (state.cost !== null) await recordBuilderSpend(env, ctx.deps, state.cost, state.model, requestId);
      stepEvent(env, 'preview', ok);
    } finally {
      release();
    }
  };
  const stream = sseStream({
    meta: {
      event: 'meta',
      data: {
        encounterId: uuidv7(),
        turnIndex: 0,
        npcId: row.npc_id,
        soulVersion: row.soul_version,
        model: 'haiku',
        voice: 'text',
        turnsLeft: left,
        disclosure: { aiCharacter: true, disclaimer: loaded.compiled.likeness.disclaimer },
        gov: 0,
      },
    },
    upstream: (signal) => turnEvents(run, signal),
    knot,
    onAbort: () => finish(false),
    onDone: () => finish(true),
    scheduler: timing,
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-DV-Npc-Mode': anthropicMode(env) },
  });
}

// ---- dispatch --------------------------------------------------------------------------------------------------------------------------

export async function handleNpcBuilder(ctx: Ctx): Promise<Response> {
  const { env, requestId, request } = ctx;
  const rest = ctx.url.pathname.startsWith(`${PREFIX}/`) ? ctx.url.pathname.slice(PREFIX.length + 1).split('/').filter((x) => x !== '') : [];
  const method = request.method.toUpperCase();
  const [a, id, action] = rest;
  const notAllowed = (allow: string): Response => apiError('bad_request', 'Method not allowed.', requestId, { status: 405, headers: { Allow: allow } });

  if (a === 'community') return apiError('feature_disabled', 'The community list is not open yet.', requestId);
  if (a !== 'drafts' || rest.length > 3) return apiError('not_found', 'No such route.', requestId);

  const auth = await authenticatePlayer(ctx);
  if (auth instanceof Response) return auth;
  if (!(await featureOn(env, 'npc.builder')) || (await activeKillSwitches(env, ['ks:npc_builder'], now())).has('ks:npc_builder')) {
    return apiError('feature_disabled', 'The character builder is off.', requestId);
  }
  // P0 players have no images, no submit; assets are a later milestone. The phase is answered before any lookup.
  if (action === 'images' || action === 'submit') {
    if (method !== 'POST') return notAllowed('POST');
    return apiError('tier_required', 'Sign in with an account to add images or submit a character.', requestId, { details: { needs: action === 'images' ? 'P1' : 'P2' } });
  }
  if (action === 'assets') return method === 'POST' ? apiError('feature_disabled', 'Looks for characters are not open yet.', requestId) : notAllowed('POST');

  const p = builderPort(env, ctx.deps);
  if (p === null) return apiError('upstream_unavailable', 'The builder is temporarily unavailable.', requestId, { retryAfterMs: 5000 });
  if (p.ephemeral) await p.port.profiles.ensureLocal(auth.profileId, auth.dkt);
  const s: Scope = { ctx, auth, port: p.port };

  try {
    if (id === undefined) {
      if (method === 'POST') return await createDraft(s);
      if (method === 'GET') return await listDrafts(s);
      return notAllowed('GET, POST');
    }
    if (action === undefined) {
      if (method === 'GET') {
        const row = await owned(s, id);
        return row instanceof Response ? row : json(await view(s, row));
      }
      if (method === 'PUT') return await updateDraft(s, id);
      if (method === 'DELETE') return await deleteDraft(s, id);
      return notAllowed('GET, PUT, DELETE');
    }
    if (method !== 'POST') return notAllowed('POST');
    if (action === 'validate') return await startValidate(s, id);
    if (action === 'soul') return await startSoul(s, id);
    if (action === 'preview') return await preview(s, id);
    if (action === 'probe') return await startProbe(s, id);
    return apiError('not_found', 'No such route.', requestId);
  } catch (e) {
    if (e instanceof Error && e.name === 'DataPortError') return apiError('upstream_unavailable', 'The builder is temporarily unavailable.', requestId, { retryAfterMs: 5000 });
    throw e;
  }
}

