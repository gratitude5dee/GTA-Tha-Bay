import { DurableObject } from 'cloudflare:workers';
import { GENAI_GUARDRAILS, type BudgetGovernor, type GovLevel, type SpendEvent, type Vendor } from '@dv/shared';
import type { Env } from '../env.ts';

/**
 * Minimal BudgetGovernorDO (M05b1): the DL-OWN-01 fal program cap in integer USD micros, one instance per environment.
 * Levels: L1 at 70 %, L2 at 85 %, L3 at 100 % of the cap (L3 turns new generation off; cache hits are always served).
 * Alarms at 50/80/100 % are written once each as log events. Per-vendor daily ceilings, the 60 s KV heartbeat and the
 * reconciliation cron arrive with M06a and M14b1.
 *
 * Money rules: `reserve` is idempotent by jobId and refuses a reservation that would pass the cap; `settle` is idempotent
 * by jobId (the first settle wins); `ingest` takes batches from the SPEND queue and is idempotent by jobId or requestId.
 */
const VENDORS: readonly Vendor[] = ['anthropic', 'fal', 'elevenlabs', 'workers_ai', 'openai_moderation'];
const LEVEL_FRACTIONS = [0.7, 0.85, 1] as const;

interface LedgerRow extends Record<string, SqlStorageValue> {
  job_id: string;
  vendor: string;
  est: number;
  actual: number;
  settled: number;
  ts: number;
  request_id: string | null;
}

/** Money is integer USD micros everywhere; a fractional or negative amount is a bug in the caller. */
export function assertMicros(n: number, name: string): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer (USD micros)`);
}

export class BudgetGovernorDO extends DurableObject<Env> implements BudgetGovernor {
  private readonly capMicros = GENAI_GUARDRAILS.programCapUsdMicros;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS ledger (
      job_id TEXT PRIMARY KEY, vendor TEXT NOT NULL, est INTEGER NOT NULL, actual INTEGER NOT NULL DEFAULT 0,
      settled INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL, request_id TEXT)`);
    // M05d: the nightly export to genai_ledger needs the model and kind of an event and whether a settled row has been exported.
    // ALTER TABLE ... ADD COLUMN is applied once to a ledger created by M05b1; this is a storage change, not a class lifecycle change.
    const cols = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(ledger)').toArray().map((c) => c.name);
    if (!cols.includes('model')) ctx.storage.sql.exec('ALTER TABLE ledger ADD COLUMN model TEXT');
    if (!cols.includes('kind')) ctx.storage.sql.exec('ALTER TABLE ledger ADD COLUMN kind TEXT');
    if (!cols.includes('exported')) ctx.storage.sql.exec('ALTER TABLE ledger ADD COLUMN exported INTEGER NOT NULL DEFAULT 0');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS alarms (threshold TEXT PRIMARY KEY, ts INTEGER NOT NULL, spent INTEGER NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS gov_state (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  }

  private sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  /** Micros counted against the cap for a vendor: the actual amount once settled, the estimate until then. */
  private spent(vendor: Vendor): number {
    const row = this.sql().exec<{ t: number }>("SELECT COALESCE(SUM(CASE WHEN settled = 1 THEN actual ELSE est END), 0) AS t FROM ledger WHERE vendor = ?", vendor).one();
    return Number(row.t);
  }

  private forced(): GovLevel {
    const rows = this.sql().exec<{ v: string }>("SELECT v FROM gov_state WHERE k = 'forced'").toArray();
    const v = rows[0] ? Number((JSON.parse(rows[0].v) as { level: number }).level) : 0;
    return (v >= 3 ? 3 : v >= 2 ? 2 : v >= 1 ? 1 : 0) as GovLevel;
  }

  private computed(): GovLevel {
    const spent = this.spent('fal');
    const [l1, l2, l3] = LEVEL_FRACTIONS.map((f) => Math.round(f * this.capMicros)) as [number, number, number];
    return (spent >= l3 ? 3 : spent >= l2 ? 2 : spent >= l1 ? 1 : 0) as GovLevel;
  }

  private currentLevel(): GovLevel {
    return Math.max(this.computed(), this.forced()) as GovLevel;
  }

  private byVendor(): Record<Vendor, number> {
    const out = {} as Record<Vendor, number>;
    for (const v of VENDORS) out[v] = v === 'fal' ? (this.spent('fal') / this.capMicros) * 100 : 0;
    return out;
  }

  /** Records threshold alarms once each and publishes `gov:level` to KV when the level moved. */
  private async afterChange(before: GovLevel): Promise<void> {
    const spent = this.spent('fal');
    for (const t of GENAI_GUARDRAILS.alarms) {
      if (spent < Math.round(t * this.capMicros)) continue;
      const fresh = this.sql().exec("INSERT OR IGNORE INTO alarms (threshold, ts, spent) VALUES (?, ?, ?) RETURNING threshold", String(t), Date.now(), spent).toArray();
      if (fresh.length > 0) console.log(JSON.stringify({ event: 'genai.budget.alarm', threshold: t, spentUsdMicros: spent, capUsdMicros: this.capMicros }));
    }
    const after = this.currentLevel();
    if (after !== before) {
      console.log(JSON.stringify({ event: 'genai.budget.level', from: before, to: after }));
      try {
        await this.env.FLAGS.put('gov:level', JSON.stringify({ level: after, at: Date.now(), byVendor: this.byVendor() }));
      } catch {
        // KV allows one write per second per key; the DO stays authoritative
      }
    }
  }

  level(): Promise<{ level: GovLevel; byVendor: Record<Vendor, number> }> {
    return Promise.resolve({ level: this.currentLevel(), byVendor: this.byVendor() });
  }

  async reserve(v: Vendor, estMicros: number, jobId: string): Promise<{ ok: boolean; level: GovLevel }> {
    assertMicros(estMicros, 'estMicros');
    const before = this.currentLevel();
    const existing = this.sql().exec<LedgerRow>('SELECT * FROM ledger WHERE job_id = ?', jobId).toArray();
    if (existing.length > 0) return { ok: true, level: before };
    if (before >= 3 || this.spent(v) + estMicros > this.capMicros) return { ok: false, level: before };
    this.sql().exec('INSERT INTO ledger (job_id, vendor, est, actual, settled, ts) VALUES (?, ?, ?, 0, 0, ?)', jobId, v, estMicros, Date.now());
    await this.afterChange(before);
    return { ok: true, level: this.currentLevel() };
  }

  async settle(jobId: string, actualMicros: number, requestId?: string): Promise<void> {
    assertMicros(actualMicros, 'actualMicros');
    const before = this.currentLevel();
    const rows = this.sql().exec<LedgerRow>('SELECT * FROM ledger WHERE job_id = ?', jobId).toArray();
    if (rows.length === 0) {
      this.sql().exec('INSERT INTO ledger (job_id, vendor, est, actual, settled, ts, request_id) VALUES (?, ?, ?, ?, 1, ?, ?)', jobId, 'fal', actualMicros, actualMicros, Date.now(), requestId ?? null);
    } else if (rows[0]!.settled === 0) {
      this.sql().exec('UPDATE ledger SET actual = ?, settled = 1, request_id = ? WHERE job_id = ?', actualMicros, requestId ?? null, jobId);
    } else {
      return; // a repeated settle changes nothing
    }
    await this.afterChange(before);
  }

  async ingest(batch: SpendEvent[]): Promise<void> {
    const before = this.currentLevel();
    for (const [i, ev] of batch.entries()) {
      const id = ev.jobId ?? ev.requestId ?? `ev:${ev.ts}:${ev.vendor}:${ev.model}:${ev.kind}:${ev.usdMicros}:${i}`;
      this.sql().exec(
        `INSERT INTO ledger (job_id, vendor, est, actual, settled, ts, request_id, model, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET actual = excluded.actual, settled = 1, model = excluded.model, kind = excluded.kind
         WHERE ledger.settled = 0 AND excluded.settled = 1`,
        id, ev.vendor, ev.usdMicros, ev.settled ? ev.usdMicros : 0, ev.settled ? 1 : 0, ev.ts, ev.requestId ?? null, ev.model, ev.kind,
      );
    }
    await this.afterChange(before);
  }

  async forceLevel(l: GovLevel, by: string, reason: string): Promise<void> {
    const before = this.currentLevel();
    this.sql().exec("INSERT OR REPLACE INTO gov_state (k, v) VALUES ('forced', ?)", JSON.stringify({ level: l, by, reason, at: Date.now() }));
    console.log(JSON.stringify({ event: 'genai.budget.force', level: l, by, reason }));
    await this.afterChange(before);
  }

  /** Alarm records, oldest first; read by tests and the ops dashboard. */
  alarmLog(): Promise<{ threshold: string; spent: number }[]> {
    return Promise.resolve(this.sql().exec<{ threshold: string; spent: number }>('SELECT threshold, spent FROM alarms ORDER BY rowid').toArray());
  }

  spentMicros(vendor: Vendor): Promise<number> {
    return Promise.resolve(this.spent(vendor));
  }

  /**
   * Settled rows not yet exported to genai_ledger, oldest first (M05d). The amount is the settled `actual`; `env` is left empty and
   * stamped by the caller. A reservation that has not settled is not exported: its amount may still change.
   */
  exportBatch(limit = 500): Promise<SpendEvent[]> {
    const rows = this.sql()
      .exec<LedgerRow & { model: string | null; kind: string | null }>('SELECT * FROM ledger WHERE settled = 1 AND exported = 0 ORDER BY ts, rowid LIMIT ?', Math.max(1, Math.min(limit, 1000)))
      .toArray();
    return Promise.resolve(
      rows.map((r) => ({
        ts: r.ts,
        vendor: r.vendor as Vendor,
        model: r.model ?? 'unknown',
        kind: r.kind ?? 'unknown',
        usdMicros: r.actual,
        settled: true,
        ...(r.request_id === null ? {} : { requestId: r.request_id }),
        jobId: r.job_id,
        env: '',
      })),
    );
  }

  /** Marks rows exported by job id; returns how many changed. Idempotent. */
  markExported(jobIds: string[]): Promise<number> {
    let changed = 0;
    for (const id of jobIds) {
      const hit = this.sql().exec('UPDATE ledger SET exported = 1 WHERE job_id = ? AND settled = 1 AND exported = 0 RETURNING job_id', id).toArray();
      changed += hit.length;
    }
    return Promise.resolve(changed);
  }
}
