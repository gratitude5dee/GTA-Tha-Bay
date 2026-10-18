/**
 * Spike plan types, registry resolution, endpoint guards and the cost ledger (all pure, no IO).
 * Guards follow spec/domains/05-assets.md section 4.5: production refuses anything not cleared, blocked endpoints are
 * callable only in env previs, banned ids are never callable. Money is integer USD micros.
 */
import { isBannedEndpoint, type GenAiRegistry } from '../../../packages/shared/src/genai/registry.ts';

export type SpikeEnv = 'production' | 'previs' | 'test';
export type GateCode = 'ENDPOINT_BANNED' | 'ENDPOINT_NOT_CLEARED' | 'BUDGET';
export type Verdict = { ok: true } | { ok: false; code: GateCode; detail: string };

export interface PlanStep {
  id: string;
  title: string;
  kind: 'fal' | 'local';
  /** Endpoint id in `endpoints`, or `<videoProviderKey>#<slot>`; null for local steps. */
  registryKey: string | null;
  alsoRegistryKeys?: string[];
  estimateMicros: number;
  params: Record<string, unknown>;
  droppable?: string[];
  storeIo0?: boolean;
  optional?: { env: string[] };
  dependsOn: string[];
  uItems: string[];
}

export interface PlanUItem { id: string; question: string; needs: string[]; operator?: boolean }

export interface SpikePlan {
  schema: 'genai-spike-plan/1';
  capMicros: number;
  plannedMaxMicros: number;
  env: SpikeEnv;
  lifecycleHeader: string;
  steps: PlanStep[];
  uItems: PlanUItem[];
}

export interface Resolved {
  endpointId: string;
  registryName: string;
  /** Registry status: `active`/`pending`/`blocked` for endpoints, the licence status for video providers. */
  status: 'active' | 'pending' | 'blocked' | 'cleared';
  video: boolean;
}

/** Resolves a plan registry key to an endpoint id and status; undefined when the registry has no such entry. */
export function resolveKey(reg: GenAiRegistry, key: string): Resolved | undefined {
  const hash = key.indexOf('#');
  if (hash >= 0) {
    const provider = reg.videoProviders[key.slice(0, hash)];
    const slot = key.slice(hash + 1) as 'i2v' | 'ref2v' | 'extend';
    const endpointId = provider?.endpoints[slot];
    if (!provider || !endpointId) return undefined;
    return { endpointId, registryName: key, status: provider.licence.status, video: true };
  }
  const e = reg.endpoints[key];
  return e ? { endpointId: e.id, registryName: key, status: e.status, video: false } : undefined;
}

/** Guard for one call. Env `test` behaves like `previs`; production needs `active` (endpoints) or `cleared` (providers). */
export function checkCallable(reg: GenAiRegistry, endpointId: string, status: Resolved['status'], env: SpikeEnv, role?: string): Verdict {
  if (isBannedEndpoint(reg, endpointId, role as never)) return { ok: false, code: 'ENDPOINT_BANNED', detail: `${endpointId} is banned` };
  if (env === 'production') {
    if (status !== 'active' && status !== 'cleared') return { ok: false, code: 'ENDPOINT_NOT_CLEARED', detail: `${endpointId} is ${status}; production needs a cleared endpoint` };
    return { ok: true };
  }
  return { ok: true };
}

/** Plan-level findings: every non-local step must resolve; estimates are integers. */
export function planFindings(plan: SpikePlan, reg: GenAiRegistry): string[] {
  const out: string[] = [];
  const ids = new Set(plan.steps.map((s) => s.id));
  for (const s of plan.steps) {
    if (!Number.isInteger(s.estimateMicros) || s.estimateMicros < 0) out.push(`${s.id}: estimate must be integer micros`);
    for (const d of s.dependsOn) if (!ids.has(d)) out.push(`${s.id}: depends on unknown step ${d}`);
    if (s.kind === 'fal') {
      for (const k of [s.registryKey, ...(s.alsoRegistryKeys ?? [])]) {
        if (!k || !resolveKey(reg, k)) out.push(`${s.id}: registry key ${String(k)} does not resolve`);
      }
    }
  }
  for (const u of plan.uItems) for (const n of u.needs) if (!ids.has(n)) out.push(`${u.id}: needs unknown step ${n}`);
  return out;
}

export function planTotalMicros(plan: SpikePlan): number {
  return plan.steps.reduce((a, s) => a + s.estimateMicros, 0);
}

export interface LedgerEntry { stepId: string; estimateMicros: number; outcome: 'submitted' | 'refused' }
export interface LedgerFile { schema: 'spike-ledger/1'; capMicros: number; totalMicros: number; entries: LedgerEntry[] }

/** Cumulative estimate ledger. A step is reserved before submit; a reservation that would pass the cap is refused. */
export class SpikeLedger {
  readonly entries: LedgerEntry[];
  constructor(readonly capMicros: number, prior: readonly LedgerEntry[] = []) {
    this.entries = [...prior];
  }
  get totalMicros(): number {
    return this.entries.filter((e) => e.outcome === 'submitted').reduce((a, e) => a + e.estimateMicros, 0);
  }
  reserve(stepId: string, estimateMicros: number): Verdict {
    if (this.totalMicros + estimateMicros > this.capMicros) {
      this.entries.push({ stepId, estimateMicros, outcome: 'refused' });
      return { ok: false, code: 'BUDGET', detail: `${stepId}: ${this.totalMicros} + ${estimateMicros} micros passes the cap ${this.capMicros}` };
    }
    this.entries.push({ stepId, estimateMicros, outcome: 'submitted' });
    return { ok: true };
  }
  toFile(): LedgerFile {
    return { schema: 'spike-ledger/1', capMicros: this.capMicros, totalMicros: this.totalMicros, entries: this.entries };
  }
}

export function microsToUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}
