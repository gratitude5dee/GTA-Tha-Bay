import { DurableObject } from 'cloudflare:workers';
import { NPC_GUARDRAILS } from '@dv/shared';
import { now } from '../clock.ts';
import { configuredDataPort } from '../data/index.ts';
import type { Env } from '../env.ts';
import { sendJob } from '../ops/queue.ts';

/**
 * Per-conversation Durable Object (`enc:<pid>:<npcId>:<encounterId>`, spec/domains/09-backend.md section 3.2 and spec/05 section 4.8):
 * the server holds the history, one turn at a time, so a client can never forge it. `begin` answers with the history or a refusal
 * (killed, busy, cadence, turn_cap, in that order); `complete` stores the user/assistant pair; `abort` drops the turn, so the stored
 * history always alternates. The alarm fires 60 s after the last activity: the transcript goes to PRIVATE `transcripts/<id>.jsonl`, an
 * `encounter_transcripts` row is written, and a `summarize` message goes to JOBS (its consumer is M06a4).
 *
 * An instance named `enc:index:<npcId>` plays a second role: it keeps the names of the open encounters of that NPC, so the roster
 * kill (route 46) can reach them at once (`indexKill`). Both roles are this one class, because the DO lifecycle tag covers two classes only.
 * Time comes from ../clock.ts so a test can drive it.
 */
export interface BeginArgs {
  profileId: string;
  npcId: string;
  /** UUIDv7 minted by the Worker; with the two ids above it forms the instance name `enc:<pid>:<npcId>:<encounterId>`. */
  encounterId: string;
  soulVersion: number;
  /** The new player turn (C10), opaque here. */
  turn: unknown;
  /** Turn cap for this encounter (the soul's value); clamped to the hard cap. Default 12. */
  turnCap?: number;
}
export type RefusalReason = 'busy' | 'turn_cap' | 'cadence' | 'killed';
export type BeginResult =
  | { ok: true; turnIndex: number; history: HistoryItem[]; /** Set once after `flagSafety` (M06a3): the turn's `meta` carries `safety: 'crisis'`. */ safety?: 'crisis' }
  | { ok: false; reason: RefusalReason };
export interface HistoryItem {
  role: 'user' | 'assistant';
  content: unknown;
}
export interface TurnUsage {
  inTok: number;
  outTok: number;
  cacheRead: number;
  cacheWrite: number;
  /** The turn's cost in USD micros, summed into the transcript row. */
  usdMicros?: number;
}
export interface EncounterStatus {
  killed: boolean;
  streaming: boolean;
  closed: boolean;
  turns: number;
}

const ENC = NPC_GUARDRAILS.encounter;
/** A stream that never reports back is treated as abandoned after this long, so one crashed request cannot block the conversation. */
const STREAM_STALE_MS = 90_000;
const DAY_MS = 86_400_000;

interface TurnRow extends Record<string, SqlStorageValue> {
  i: number;
  role: string;
  content: string;
  usage: string | null;
  at: number;
}

export class EncounterDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS turns (i INTEGER PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, usage TEXT, at INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS open_index (name TEXT PRIMARY KEY, at INTEGER NOT NULL)');
  }

  private sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private get(k: string): string | null {
    const r = this.sql().exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0];
    return r === undefined ? null : r.v;
  }

  private getNum(k: string): number {
    const v = this.get(k);
    return v === null ? 0 : Number(v);
  }

  private set(k: string, v: string | number): void {
    this.sql().exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', k, String(v));
  }

  private del(k: string): void {
    this.sql().exec('DELETE FROM meta WHERE k = ?', k);
  }

  private history(): HistoryItem[] {
    return this.sql()
      .exec<TurnRow>('SELECT i, role, content, usage, at FROM turns ORDER BY i')
      .toArray()
      .map((r) => ({ role: r.role as HistoryItem['role'], content: JSON.parse(r.content) as unknown }));
  }

  private completedTurns(): number {
    return Math.floor(Number(this.sql().exec<{ n: number }>('SELECT COUNT(*) AS n FROM turns').one().n) / 2);
  }

  private lastActivity(): number {
    return Math.max(this.getNum('lastBegin'), this.getNum('lastTurn'));
  }

  /** Starts a turn, or says why not. The new turn is held as pending and joins the history only when `complete` stores the pair. */
  async begin(a: BeginArgs): Promise<BeginResult> {
    const t = now();
    if (this.get('killed') === '1') return { ok: false, reason: 'killed' };
    if (this.get('closed') === '1') return { ok: false, reason: 'turn_cap' }; // an idle-closed encounter takes no more turns: the client opens a new one
    if (this.get('streaming') === '1') {
      if (t - this.getNum('lastBegin') < STREAM_STALE_MS) return { ok: false, reason: 'busy' };
      this.del('pending'); // abandoned stream: forget its turn and go on
      this.set('streaming', '0');
    }
    if (this.get('lastBegin') !== null && t - this.getNum('lastBegin') < ENC.cadenceMs) return { ok: false, reason: 'cadence' };
    const cap = Math.min(Math.max(Math.trunc(a.turnCap ?? ENC.turnCap), 1), ENC.turnCapHard);
    const done = this.completedTurns();
    if (done >= cap) return { ok: false, reason: 'turn_cap' };

    if (this.get('encounterId') === null) {
      this.set('pid', a.profileId);
      this.set('npcId', a.npcId);
      this.set('encounterId', a.encounterId);
      this.set('soulVersion', a.soulVersion);
      // Registered before the first turn runs, so a kill that lands now still reaches this conversation.
      await this.indexStub(a.npcId).indexAdd(this.name());
    }
    this.set('pending', JSON.stringify({ turnIndex: done, user: a.turn }));
    this.set('streaming', '1');
    this.set('lastBegin', t);
    const crisis = this.get('pendingSafety') === '1';
    if (crisis) this.del('pendingSafety');
    await this.ctx.storage.setAlarm(t + ENC.idleCloseMs);
    return { ok: true, turnIndex: done, history: this.history(), ...(crisis ? { safety: 'crisis' as const } : {}) };
  }

  /** Stores the finished turn: the pending user turn and the assistant answer, in that order. A repeated or stray call changes nothing. */
  async complete(turnIndex: number, assistant: unknown, usage: TurnUsage): Promise<void> {
    const pending = this.pending();
    if (pending === null || pending.turnIndex !== turnIndex) return;
    const t = now();
    this.ctx.storage.transactionSync(() => {
      const sql = this.sql();
      sql.exec('INSERT INTO turns (i, role, content, usage, at) VALUES (?, ?, ?, NULL, ?)', turnIndex * 2, 'user', JSON.stringify(pending.user), t);
      sql.exec('INSERT INTO turns (i, role, content, usage, at) VALUES (?, ?, ?, ?, ?)', turnIndex * 2 + 1, 'assistant', JSON.stringify(assistant), JSON.stringify(usage), t);
      this.set('usd', this.getNum('usd') + (usage.usdMicros ?? 0));
      this.del('pending');
      this.set('streaming', '0');
      this.set('lastTurn', t);
    });
    await this.ctx.storage.setAlarm(t + ENC.idleCloseMs);
  }

  /** Drops the turn in flight. Nothing of it reaches the history. */
  async abort(turnIndex: number, _reason: 'timeout' | 'refusal' | 'upstream' | 'client_gone'): Promise<void> {
    const pending = this.pending();
    if (pending === null || pending.turnIndex !== turnIndex) return;
    this.del('pending');
    this.set('streaming', '0');
    await this.ctx.storage.setAlarm(now() + ENC.idleCloseMs);
  }

  /** Roster kill (route 46): refuses new turns at once. A stream in flight sees `status().killed` and ends with `fallback{killed}`. */
  kill(_npcId: string): Promise<void> {
    this.set('killed', '1');
    return Promise.resolve();
  }

  /** Asynchronous moderation saw a self-harm intent (M06b1 calls this): the next turn's `meta` carries `safety: 'crisis'` and clears it. */
  flagSafety(): Promise<void> {
    this.set('pendingSafety', '1');
    return Promise.resolve();
  }

  /** The token counts and cost of each stored turn, oldest first (never content). The staging cache check (M06a3 AC-12) reads them through a test route. */
  usages(): Promise<TurnUsage[]> {
    return Promise.resolve(
      this.sql()
        .exec<TurnRow>("SELECT i, role, content, usage, at FROM turns WHERE role = 'assistant' ORDER BY i")
        .toArray()
        .flatMap((r) => (r.usage === null ? [] : [JSON.parse(r.usage) as TurnUsage])),
    );
  }

  status(): Promise<EncounterStatus> {
    return Promise.resolve({
      killed: this.get('killed') === '1',
      streaming: this.get('streaming') === '1',
      closed: this.get('closed') === '1',
      turns: this.completedTurns(),
    });
  }

  /** Ends the conversation now (`endConversation` effect): the same closing steps as the alarm. */
  async close(): Promise<void> {
    await this.closeNow();
  }

  /** 60 s after the last activity: write the transcript, index it and queue the summary. Early or repeated calls are harmless. */
  override async alarm(): Promise<void> {
    if (this.get('closed') === '1') return;
    if (this.get('encounterId') === null) {
      // the index instance, or an instance that never took a turn: prune the index and stop
      this.sql().exec('DELETE FROM open_index WHERE at < ?', now() - ENC.indexStaleMs);
      return;
    }
    const t = now();
    const due = this.lastActivity() + ENC.idleCloseMs;
    if (t < due || (this.get('streaming') === '1' && t - this.getNum('lastBegin') < STREAM_STALE_MS)) {
      await this.ctx.storage.setAlarm(Math.max(due, t + 1000));
      return;
    }
    await this.closeNow();
  }

  private pending(): { turnIndex: number; user: unknown } | null {
    const raw = this.get('pending');
    return raw === null ? null : (JSON.parse(raw) as { turnIndex: number; user: unknown });
  }

  private name(): string {
    return `enc:${this.get('pid')}:${this.get('npcId')}:${this.get('encounterId')}`;
  }

  private indexStub(npcId: string): DurableObjectStub<EncounterDO> {
    return this.env.ENCOUNTER.get(this.env.ENCOUNTER.idFromName(`enc:index:${npcId}`)) as DurableObjectStub<EncounterDO>;
  }

  private async closeNow(): Promise<void> {
    if (this.get('closed') === '1' || this.get('encounterId') === null) return;
    const pid = this.get('pid') as string;
    const npcId = this.get('npcId') as string;
    const encounterId = this.get('encounterId') as string;
    const rows = this.sql().exec<TurnRow>('SELECT i, role, content, usage, at FROM turns ORDER BY i').toArray();
    const t = now();
    if (rows.length > 0) {
      const r2Key = `transcripts/${encounterId}.jsonl`;
      const body = rows.map((r) => JSON.stringify({ i: r.i, role: r.role, content: JSON.parse(r.content) as unknown, usage: r.usage === null ? undefined : (JSON.parse(r.usage) as unknown), at: r.at })).join('\n') + '\n';
      await this.env.PRIVATE.put(r2Key, body, { httpMetadata: { contentType: 'application/x-ndjson' } });
      const port = configuredDataPort(this.env);
      if (port === null) {
        console.log('SKIP encounter transcript row: no database configured');
      } else {
        const result = await port.maintenance.recordTranscript({
          encounter_id: encounterId,
          profile_id: pid,
          npc_id: npcId,
          r2_key: r2Key,
          turns: Math.floor(rows.length / 2),
          usd_micros: this.getNum('usd'),
          closed_at: t,
          expires_at: t + ENC.transcriptRetentionDays * DAY_MS,
        });
        // The profile was forgotten while the conversation was open: nothing of it may remain.
        if (result === 'no_profile') await this.env.PRIVATE.delete(r2Key);
        else await sendJob(this.env, { type: 'summarize', encounterId, profileId: pid, npcId, soulVersion: this.getNum('soulVersion'), r2Key });
      }
    }
    await this.indexStub(npcId).indexRemove(this.name());
    this.set('closed', '1');
    this.sql().exec('DELETE FROM turns');
    this.del('pending');
    this.set('streaming', '0');
  }

  // ---- the open-set index (instances named `enc:index:<npcId>`) ----

  indexAdd(name: string): Promise<void> {
    const t = now();
    this.sql().exec('DELETE FROM open_index WHERE at < ?', t - ENC.indexStaleMs);
    this.sql().exec('INSERT INTO open_index (name, at) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET at = excluded.at', name, t);
    return Promise.resolve();
  }

  indexRemove(name: string): Promise<void> {
    this.sql().exec('DELETE FROM open_index WHERE name = ?', name);
    return Promise.resolve();
  }

  indexList(): Promise<string[]> {
    return Promise.resolve(this.sql().exec<{ name: string }>('SELECT name FROM open_index ORDER BY name').toArray().map((r) => r.name));
  }

  /** Kills every open encounter of the NPC; returns how many were reached. */
  async indexKill(npcId: string): Promise<number> {
    const names = await this.indexList();
    const results = await Promise.allSettled(names.map((n) => (this.env.ENCOUNTER.get(this.env.ENCOUNTER.idFromName(n)) as DurableObjectStub<EncounterDO>).kill(npcId)));
    return results.filter((r) => r.status === 'fulfilled').length;
  }
}
