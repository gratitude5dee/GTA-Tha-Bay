// C12 1.1 — budget types. Copied from spec/domains/09-backend-ops.md section 5.3 (verbatim).
// Pure (no IO) so that services/pipeline's BudgetPort imports them from @dv/shared without importing services/edge (DL-056).
// The DO implementations stay in services/edge/src/budget/.

export type Vendor = 'anthropic' | 'fal' | 'elevenlabs' | 'workers_ai' | 'openai_moderation';
export type GovLevel = 0 | 1 | 2 | 3;           // L1 ≥ 70 %: Sonnet→Haiku · L2 ≥ 85 %: voice→T1 · L3 ≥ 100 %: genAI off (cache hits still served)
export interface PlayerQuota {                  // PlayerQuotaDO RPC
  reserve(r: { kind: 'turn' | 'voice_line' | 'builder_text' | 'builder_job' | 'upload' | 'post' | 'report'; npcId?: string; estMicros: number }):   // 'builder_text' from C12 1.1 (09-backend-contracts-1.1.md §2, DL-119)
    Promise<{ ok: true; reservationId: string } | { ok: false; reason: 'quota' | 'cost_cap' | 'per_npc' }>;
  settle(reservationId: string, actualMicros: number): Promise<void>;   // also enqueues to SPEND queue
  usage(): Promise<Record<string, number>>;
}
export interface BudgetGovernor {               // BudgetGovernorDO RPC (singleton per env)
  level(): Promise<{ level: GovLevel; byVendor: Record<Vendor, number /* % of daily ceiling */> }>;
  reserve(v: Vendor, estMicros: number, jobId: string): Promise<{ ok: boolean; level: GovLevel }>;   // synchronous for fal/builder jobs
  settle(jobId: string, actualMicros: number, requestId?: string): Promise<void>;
  ingest(batch: SpendEvent[]): Promise<void>;   // from SPEND queue (dialogue path, batched 100 / 5 s)
  forceLevel(l: GovLevel, by: string, reason: string): Promise<void>;
}
export interface SpendEvent { ts: number; vendor: Vendor; model: string; kind: string; usdMicros: number; settled: boolean; requestId?: string; jobId?: string; env: string }
