import type { Env } from '../env.ts';
import type { NetKind, ReserveRequest, ReserveResult, SettleMeta } from './QuotaDO.ts';

/** The RPC surface of PlayerQuotaDO as the Worker calls it. */
export interface QuotaRpc {
  reserve(r: ReserveRequest): Promise<ReserveResult>;
  settle(reservationId: string, actualMicros: number, meta?: SettleMeta): Promise<void>;
  usage(): Promise<Record<string, number>>;
  take(kind: NetKind, cap: number): Promise<{ ok: boolean; n: number }>;
  peek(kind: NetKind, cap?: number): Promise<number>;
  bump(kind: NetKind): Promise<number>;
}

/** The quota object of a player (`q:p:<pid>`). */
export function playerQuota(env: Pick<Env, 'QUOTA'>, profileId: string): QuotaRpc {
  return env.QUOTA.get(env.QUOTA.idFromName(`q:p:${profileId}`)) as unknown as QuotaRpc;
}

/** The quota object of a network (`q:n:<netHash>`). */
export function netQuota(env: Pick<Env, 'QUOTA'>, netHash: string): QuotaRpc {
  return env.QUOTA.get(env.QUOTA.idFromName(`q:n:${netHash}`)) as unknown as QuotaRpc;
}
