import type { ApiErrorCode, RosterFlags } from '@dv/shared';
import type { AssetRef } from '@dv/shared/assets';
import type { CompiledSoulPublic, DialogueEvent, FallbackReason, InkKnot, NPCDialogueContext, NPCDialogueRequest, NpcId } from '@dv/shared/contracts/c10-npc';
import { inkKnotFor } from '@dv/shared/npc';
import { InkRunner } from '../ink/ink-runner.ts';
import { DialogueClient } from './dialogue-client.ts';

/**
 * NpcRuntime (04-npc.md section 3, M06a3): what the dialogue panel, the missions and the debug overlay call.
 *
 *  - `talk` goes to route 31 and streams `DialogueEvent`s to `on`. On a `fallback` event, a network failure, `/boot` failure or any of
 *    the four offline ApiError codes it continues with the NPC's ink from the returned knot, or the knot of the intent, and shows no
 *    error. With the setting `ProfileSettings.npc.aiDialogue = false` or without a play token it goes straight to ink.
 *  - `playKnot` plays a knot of the NPC's ink and never touches the network (missions use only this).
 *  - `refreshFlags` reads route 30 (`RosterFlags`) with its ETag: on start, on mode entry, every 30 s while the page is visible, on
 *    return to visible and after a `kill_switched`. A killed NPC leaves `roster()`.
 *  - Each turn records `npc.turn.client`, each closed encounter `npc.encounter.client` (counts and enums only, never text).
 */
export interface NpcRuntime {
  roster(): ReadonlyMap<NpcId, CompiledSoulPublic>;
  refreshFlags(): Promise<RosterFlags>;
  talk(
    npcId: NpcId,
    turn: NPCDialogueRequest['turn'],
    ctx: NPCDialogueContext,
    on: (e: DialogueEvent) => void,
    signal?: AbortSignal,
  ): Promise<{ encounterId: string | null; source: 'llm' | 'ink' }>;
  playKnot(npcId: NpcId, knot: InkKnot): AsyncIterable<{ text: string; audio: AssetRef | null }>;
  endEncounter(npcId: NpcId): void;
  voiceSetting(): 'all' | 'heroes' | 'off';
}

export interface NpcRuntimeOptions {
  /** Origin of the API (`BootConfig.hosts.api`); empty for the page's own origin. */
  apiBase?: string;
  fetch?: typeof fetch;
  /** The play-token header from the identity service, or null (offline, under 18). */
  auth: () => Promise<{ Authorization: string } | null>;
  /** The public souls of `data/npc-roster`. */
  souls?: () => readonly CompiledSoulPublic[];
  /** The soul version to send for an NPC when the roster does not hold it (the debug overlay uses this). */
  soulVersionOf?: (npcId: NpcId) => number | null;
  /** The compiled ink of an NPC (`data/ink.<id>`): JSON text or the parsed object. */
  loadInk: (npcId: NpcId) => Promise<string | object>;
  /** Profile settings: `npc.aiDialogue` and `npc.voice` (C05 1.1). Default: AI dialogue on, voice all. */
  settings?: () => { aiDialogue: boolean; voice: 'all' | 'heroes' | 'off' };
  telemetry?: { emit(name: 'npc.turn.client' | 'npc.encounter.client', props: Record<string, string | number | boolean>): void };
  now?: () => number;
  /** Sees each talk response before its body is read (the QA overlay reads `X-DV-Npc-Mode` here). */
  onResponse?: (res: Response) => void;
  timers?: { setInterval(fn: () => void, ms: number): unknown; clearInterval(handle: unknown): void };
  /** Page visibility; default is `document.visibilityState` when a document exists. */
  visibility?: { visible(): boolean; onChange(fn: () => void): () => void };
}

export interface NpcRuntimeHandle extends NpcRuntime {
  /** Starts the flag poll: one read now, then every 30 s while visible and on return to visible. */
  start(): void;
  /** Mode entry: one more flag read. */
  onModeEnter(): void;
  stop(): void;
}

const POLL_MS = 30_000;
const EMPTY_FLAGS: RosterFlags = { etag: '0', killed: {}, updatedAt: 0 };

interface Encounter {
  id: string | null;
  turns: number;
  fallbacks: number;
  model: 'haiku' | 'sonnet' | 'ink';
}

const wordsOf = (text: string): number => (text.trim() === '' ? 0 : text.trim().split(/\s+/).length);

/** The fallback reason that goes into telemetry for a refusal the server or the network gave. */
function refusalReason(code: ApiErrorCode | 'network' | 'no_auth'): FallbackReason | 'offline' | 'network' {
  return code === 'network' ? 'network' : 'offline';
}

export function createNpcRuntime(options: NpcRuntimeOptions): NpcRuntimeHandle {
  const client = new DialogueClient({
    auth: options.auth,
    ...(options.apiBase === undefined ? {} : { apiBase: options.apiBase }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.onResponse === undefined ? {} : { onResponse: options.onResponse }),
  });
  const settings = options.settings ?? ((): { aiDialogue: boolean; voice: 'all' | 'heroes' | 'off' } => ({ aiDialogue: true, voice: 'all' }));
  const encounters = new Map<NpcId, Encounter>();
  const runners = new Map<NpcId, Promise<InkRunner | null>>();
  let flags: RosterFlags = EMPTY_FLAGS;
  let timer: unknown = null;
  let unwatch: (() => void) | null = null;
  const timers = options.timers ?? { setInterval: (fn: () => void, ms: number): unknown => setInterval(fn, ms), clearInterval: (h: unknown): void => clearInterval(h as ReturnType<typeof setInterval>) };
  const visibility =
    options.visibility ??
    (typeof document === 'undefined'
      ? { visible: (): boolean => true, onChange: (): (() => void) => () => undefined }
      : {
          visible: (): boolean => document.visibilityState !== 'hidden',
          onChange: (fn: () => void): (() => void) => {
            document.addEventListener('visibilitychange', fn);
            return () => document.removeEventListener('visibilitychange', fn);
          },
        });

  const encounter = (npcId: NpcId): Encounter => {
    let e = encounters.get(npcId);
    if (e === undefined) {
      e = { id: null, turns: 0, fallbacks: 0, model: 'ink' };
      encounters.set(npcId, e);
    }
    return e;
  };

  const runnerFor = (npcId: NpcId): Promise<InkRunner | null> => {
    let p = runners.get(npcId);
    if (p === undefined) {
      p = options.loadInk(npcId).then((json) => InkRunner.create(json)).catch(() => null);
      runners.set(npcId, p);
    }
    return p;
  };

  /** Plays a knot as dialogue events: each line as `line.delta` + `line.done`, then `effects` and `done`. No error UI, whatever fails. */
  async function playInk(npcId: NpcId, knot: InkKnot, on: (e: DialogueEvent) => void): Promise<void> {
    const runner = await runnerFor(npcId);
    const lines = runner === null ? [] : runner.play(knot);
    lines.forEach((l, i) => {
      on({ event: 'line.delta', data: { seq: i, text: l.text } });
      on({ event: 'line.done', data: { text: l.text, words: wordsOf(l.text) } });
    });
    on({ event: 'effects', data: {} });
    on({ event: 'done', data: { costMicros: 0, turnsLeft: 0, closed: false } });
  }

  const soulVersion = (npcId: NpcId): number | null => {
    const fromRoster = options.souls?.().find((s) => s.id === npcId)?.soulVersion;
    return fromRoster ?? options.soulVersionOf?.(npcId) ?? null;
  };

  const turnEvent = (ttftMs: number, reason: FallbackReason | 'offline' | 'network' | 'setting_off' | null): void => {
    options.telemetry?.emit('npc.turn.client', { ttftMs: Math.max(0, Math.min(60_000, ttftMs)), fallback: reason !== null, ...(reason === null ? {} : { reason }) });
  };

  async function refreshFlags(): Promise<RosterFlags> {
    const doFetch = options.fetch ?? fetch;
    try {
      const res = await doFetch(`${options.apiBase ?? ''}/api/v1/roster`, { headers: { 'If-None-Match': `"${flags.etag}"` } });
      if (res.status === 200) {
        const body = (await res.json()) as RosterFlags;
        if (typeof body.etag === 'string' && typeof body.killed === 'object' && body.killed !== null) flags = body;
      }
    } catch {
      // offline or the Worker is down: the last flags stand
    }
    return flags;
  }

  async function talk(
    npcId: NpcId,
    turn: NPCDialogueRequest['turn'],
    ctx: NPCDialogueContext,
    on: (e: DialogueEvent) => void,
    signal?: AbortSignal,
    retried = false,
  ): Promise<{ encounterId: string | null; source: 'llm' | 'ink' }> {
    const enc = encounter(npcId);
    const knot = inkKnotFor(ctx, turn.intent);
    const asInk = async (k: InkKnot, reason: FallbackReason | 'offline' | 'network' | 'setting_off'): Promise<{ encounterId: string | null; source: 'ink' }> => {
      enc.fallbacks++;
      turnEvent(0, reason);
      await playInk(npcId, k, on);
      return { encounterId: enc.id, source: 'ink' };
    };
    if (!settings().aiDialogue) return asInk(knot, 'setting_off');
    const version = soulVersion(npcId);
    if (version === null) return asInk(knot, 'offline');
    const req: NPCDialogueRequest = { npcId, ...(enc.id === null ? {} : { encounterId: enc.id }), soulVersion: version, turn, context: ctx, maxTokens: 512 };
    const end = await client.talk(npcId, req, on, signal);
    switch (end.kind) {
      case 'aborted':
        return { encounterId: enc.id, source: 'llm' };
      case 'done':
        enc.id = end.encounterId ?? enc.id;
        enc.turns++;
        enc.model = end.model ?? enc.model;
        turnEvent(end.ttftMs, null);
        if (end.closed) closeEncounter(npcId);
        return { encounterId: end.encounterId, source: 'llm' };
      case 'fallback':
        enc.id = end.encounterId ?? enc.id;
        enc.fallbacks++;
        turnEvent(end.ttftMs, end.reason);
        if (end.reason === 'killed') await refreshFlags();
        await playInk(npcId, end.knot, on);
        return { encounterId: enc.id, source: 'ink' };
      case 'refused': {
        const reason = end.details?.['reason'];
        if (end.code === 'conflict' && reason === 'turn_cap' && !retried) {
          // the encounter is over on the server: open a new one for this turn
          enc.id = null;
          return talk(npcId, turn, ctx, on, signal, true);
        }
        if (end.code === 'kill_switched') await refreshFlags();
        if (end.code === 'rate_limited' || end.code === 'conflict') return asInk('busy', 'offline');
        if (end.code === 'moderation_blocked') return asInk('deflect', 'offline');
        if (end.code === 'network') return asInk(knot, 'network');
        // quota_exhausted, budget_offline, kill_switched, upstream_unavailable and every other refusal: ink from the intent's knot
        return asInk(knot, refusalReason(end.code));
      }
    }
  }

  function closeEncounter(npcId: NpcId): void {
    const e = encounters.get(npcId);
    if (e === undefined) return;
    encounters.delete(npcId);
    if (e.turns + e.fallbacks === 0) return;
    options.telemetry?.emit('npc.encounter.client', { turns: Math.min(40, e.turns), fallbacks: Math.min(40, e.fallbacks), voiceTier: 'text', model: e.model });
  }

  const runtime: NpcRuntimeHandle = {
    roster() {
      const out = new Map<NpcId, CompiledSoulPublic>();
      for (const s of options.souls?.() ?? []) {
        const k = flags.killed[s.id];
        if (k !== undefined && (k.scope.includes('all') || k.scope.includes('spawn'))) continue;
        out.set(s.id, s);
      }
      return out;
    },
    refreshFlags,
    talk: (npcId, turn, ctx, on, signal) => talk(npcId, turn, ctx, on, signal),
    async *playKnot(npcId, knot) {
      const runner = await runnerFor(npcId);
      if (runner === null) return;
      for (const line of runner.play(knot)) yield { text: line.text, audio: null };
    },
    endEncounter: closeEncounter,
    voiceSetting: () => settings().voice,
    start() {
      if (timer !== null) return;
      void refreshFlags();
      timer = timers.setInterval(() => {
        if (visibility.visible()) void refreshFlags();
      }, POLL_MS);
      unwatch = visibility.onChange(() => {
        if (visibility.visible()) void refreshFlags();
      });
    },
    onModeEnter() {
      void refreshFlags();
    },
    stop() {
      if (timer !== null) timers.clearInterval(timer);
      timer = null;
      unwatch?.();
      unwatch = null;
    },
  };
  return runtime;
}
