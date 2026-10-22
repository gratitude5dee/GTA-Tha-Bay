import { DurableObject } from 'cloudflare:workers';
import { NPC_GUARDRAILS, type PlayerQuota, type SpendEvent, type Tier } from '@dv/shared';
import { now, utcDay } from '../clock.ts';
import type { Env } from '../env.ts';
import { sendSpend } from '../ops/queue.ts';
import { writeServerEvent } from '../telemetry/server.ts';

/**
 * PlayerQuotaDO (M06a1): the exact per-player and per-network daily caps behind the Rate Limiting binding, which is spam control only
 * (spec/domains/09-backend-ops.md sections 3.1 and 5.2). Instances: `q:p:<pid>` per player, `q:n:<netHash>` per network (4x the P0 row).
 * The day is UTC and rolls over at 00:00. `reserve` happens before a model call, `settle` after it with the actual cost; a settled turn
 * enqueues one SpendEvent on the SPEND queue (BudgetGovernorDO.ingest consumes it). Every refusal writes the server-only event `quota.block`.
 * Time comes from ../clock.ts so a test can drive the day by hand.
 */
export type QuotaKind = Parameters<PlayerQuota['reserve']>[0]['kind'];
export type RefusalReason = 'quota' | 'cost_cap' | 'per_npc';
/** `PlayerQuota.reserve` with the caller's tier and the instance scope (the instance cannot tell a player from a network by itself). */
export type ReserveRequest = Parameters<PlayerQuota['reserve']>[0] & { tier?: Tier; scope?: 'player' | 'net' };
export type ReserveResult = { ok: true; reservationId: string } | { ok: false; reason: RefusalReason };
/** Counters a network keeps beside the dialogue quotas. */
export type NetKind = 'play_token' | 'signup';
export interface SettleMeta {
  vendor?: SpendEvent['vendor'];
  model?: string;
}

const Q = NPC_GUARDRAILS.quotas;
type Row = Record<keyof (typeof Q)["p0"], number>;
const COST_CAPPED: ReadonlySet<QuotaKind> = new Set(['turn', 'voice_line']);
const LIMIT_KEY: Record<QuotaKind, keyof Row> = {
  turn: 'turns',
  voice_line: 'voiceLines',
  builder_text: 'builderText',
  builder_job: 'builderJob',
  upload: 'uploads',
  post: 'posts',
  report: 'reports',
};
const COST = 'cost_micros';

/** The limits row of a tier and scope: tier local and device use the P0 row, linked its own, a network 4x the P0 row. */
export function limitsFor(tier: Tier, scope: 'player' | 'net'): Row {
  if (scope === 'net') {
    const m = NPC_GUARDRAILS.netMultiplier;
    return Object.fromEntries(Object.entries(Q.p0).map(([k, v]) => [k, v * m])) as Row;
  }
  return tier === 'linked' ? Q.linked : Q.p0;
}


export class PlayerQuotaDO extends DurableObject<Env> implements PlayerQuota {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS counters (day TEXT NOT NULL, kind TEXT NOT NULL, npc_id TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, kind, npc_id))');
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, kind TEXT NOT NULL, npc_id TEXT NOT NULL, est INTEGER NOT NULL, actual INTEGER NOT NULL DEFAULT 0, settled INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, day TEXT NOT NULL)',
    );
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS reservations_kind_npc ON reservations (kind, npc_id, at)');
  }

  private sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  private count(day: string, kind: string, npcId = ''): number {
    const rows = this.sql().exec<{ n: number }>('SELECT n FROM counters WHERE day = ? AND kind = ? AND npc_id = ?', day, kind, npcId).toArray();
    return rows[0] ? Number(rows[0].n) : 0;
  }

  private add(day: string, kind: string, npcId: string, by: number): void {
    this.sql().exec(
      'INSERT INTO counters (day, kind, npc_id, n) VALUES (?, ?, ?, ?) ON CONFLICT (day, kind, npc_id) DO UPDATE SET n = MAX(0, n + excluded.n)',
      day, kind, npcId, by,
    );
  }

  /** Counter rows of earlier days and settled reservations of earlier days are dropped on the first call of a new day. */
  private rollover(day: string): void {
    this.sql().exec('DELETE FROM counters WHERE day < ?', day);
    this.sql().exec('DELETE FROM reservations WHERE day < ? AND settled = 1', day);
  }

  private block(kind: string, reason: string, scope: 'player' | 'net', tier: Tier): void {
    writeServerEvent(this.env, 'quota.block', { kind, reason, scope, tier }, now());
  }

  reserve(r: ReserveRequest): Promise<ReserveResult> {
    if (!Number.isInteger(r.estMicros) || r.estMicros < 0) throw new Error('estMicros must be a non-negative integer (USD micros)');
    const tier: Tier = r.tier ?? 'local';
    const scope = r.scope ?? 'player';
    const limits = limitsFor(tier, scope);
    const t = now();
    const day = utcDay(t);
    const refuse = (reason: RefusalReason): ReserveResult => {
      this.block(r.kind, reason, scope, tier);
      return { ok: false, reason };
    };
    return Promise.resolve(
      this.ctx.storage.transactionSync((): ReserveResult => {
        this.rollover(day);
        const limit = limits[LIMIT_KEY[r.kind]];
        if (this.count(day, r.kind) + 1 > limit) return refuse('quota');
        if (r.kind === 'turn' && r.npcId !== undefined && this.count(day, 'turn', r.npcId) + 1 > limits.perNpc) return refuse('per_npc');
        if (r.kind === 'builder_text' && r.npcId !== undefined) {
          // One reservation per draft per hour (npcId carries the draft id for this kind).
          const since = t - NPC_GUARDRAILS.builderTextPerDraftMs;
          const recent = this.sql().exec('SELECT 1 FROM reservations WHERE kind = ? AND npc_id = ? AND at > ? LIMIT 1', 'builder_text', r.npcId, since).toArray();
          if (recent.length > 0) return refuse('quota');
        }
        if (COST_CAPPED.has(r.kind) && this.count(day, COST) + r.estMicros > limits.costCapUsdMicros) return refuse('cost_cap');
        const id = crypto.randomUUID();
        this.sql().exec('INSERT INTO reservations (id, kind, npc_id, est, at, day) VALUES (?, ?, ?, ?, ?, ?)', id, r.kind, r.npcId ?? '', r.estMicros, t, day);
        this.add(day, r.kind, '', 1);
        if (r.kind === 'turn' && r.npcId !== undefined) this.add(day, 'turn', r.npcId, 1);
        if (COST_CAPPED.has(r.kind)) this.add(day, COST, '', r.estMicros);
        return { ok: true, reservationId: id };
      }),
    );
  }

  async settle(reservationId: string, actualMicros: number, meta: SettleMeta = {}): Promise<void> {
    if (!Number.isInteger(actualMicros) || actualMicros < 0) throw new Error('actualMicros must be a non-negative integer (USD micros)');
    const row = this.sql()
      .exec<{ kind: QuotaKind; est: number; settled: number; day: string }>('SELECT kind, est, settled, day FROM reservations WHERE id = ?', reservationId)
      .toArray()[0];
    if (row === undefined || row.settled === 1) return; // unknown or repeated: nothing changes
    this.ctx.storage.transactionSync(() => {
      this.sql().exec('UPDATE reservations SET actual = ?, settled = 1 WHERE id = ?', actualMicros, reservationId);
      if (COST_CAPPED.has(row.kind)) this.add(row.day, COST, '', actualMicros - Number(row.est));
    });
    const ev = spendEventFor(row.kind, actualMicros, meta, reservationId, this.env.ENVIRONMENT, now());
    if (ev === null) return;
    try {
      if (!(await sendSpend(this.env, ev))) await (this.env.GOVERNOR.get(this.env.GOVERNOR.idFromName(`gov:${this.env.ENVIRONMENT}`)) as unknown as { ingest(b: SpendEvent[]): Promise<void> }).ingest([ev]);
    } catch {
      // The player's answer never waits on the spend ledger; the nightly reconciliation (M14b1) catches a lost event.
    }
  }

  /** Today's counters: `turn`, `voice_line`, ... (reservations made), `cost_micros`, and `npc:<id>` (turns per NPC). */
  usage(): Promise<Record<string, number>> {
    const day = utcDay(now());
    const out: Record<string, number> = {};
    for (const r of this.sql().exec<{ kind: string; npc_id: string; n: number }>('SELECT kind, npc_id, n FROM counters WHERE day = ?', day)) {
      out[r.npc_id === '' ? r.kind : `npc:${r.npc_id}`] = Number(r.n);
    }
    return Promise.resolve(out);
  }

  /** Atomic counter with a cap, for the per-net daily caps (play tokens, route 5). */
  take(kind: NetKind, cap: number): Promise<{ ok: boolean; n: number }> {
    const day = utcDay(now());
    return Promise.resolve(
      this.ctx.storage.transactionSync(() => {
        this.rollover(day);
        const n = this.count(day, kind);
        if (n >= cap) {
          this.block(kind, 'net_cap', 'net', 'local');
          return { ok: false, n };
        }
        this.add(day, kind, '', 1);
        return { ok: true, n: n + 1 };
      }),
    );
  }

  /** Today's count of a net counter without changing it. */
  peek(kind: NetKind, cap?: number): Promise<number> {
    const n = this.count(utcDay(now()), kind);
    if (cap !== undefined && n >= cap) this.block(kind, 'net_cap', 'net', 'local');
    return Promise.resolve(n);
  }

  /** Counts one success of a net counter (route 58 sign-ups are counted after the upstream accepts them). */
  bump(kind: NetKind): Promise<number> {
    const day = utcDay(now());
    this.rollover(day);
    this.add(day, kind, '', 1);
    return Promise.resolve(this.count(day, kind));
  }
}

function spendEventFor(kind: QuotaKind, actual: number, meta: SettleMeta, requestId: string, env: string, ts: number): SpendEvent | null {
  if (actual === 0) return null;
  switch (kind) {
    case 'turn':
      return { ts, vendor: meta.vendor ?? 'anthropic', model: meta.model ?? 'unknown', kind: 'dialogue', usdMicros: actual, settled: true, requestId, env };
    case 'voice_line':
      return { ts, vendor: meta.vendor ?? 'workers_ai', model: meta.model ?? 'unknown', kind: 'tts', usdMicros: actual, settled: true, requestId, env };
    case 'builder_text':
      return { ts, vendor: meta.vendor ?? 'anthropic', model: meta.model ?? 'unknown', kind: 'builder', usdMicros: actual, settled: true, requestId, env };
    default:
      return null;
  }
}
