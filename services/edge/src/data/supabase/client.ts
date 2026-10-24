import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@dv/shared/data-port';

/** The typed service-path client the Supabase DataPort uses. */
export type Db = SupabaseClient<Database>;

export interface SupabaseConfig {
  /** https://<ref>.supabase.co, or the local stack's API URL. */
  url: string;
  /** `sb_secret_...` (F-032), never the legacy service_role key. Bypasses RLS: service path only. */
  secretKey: string;
  /** The `env` column of rows the port writes where the caller gives none (the Worker's ENVIRONMENT var). */
  env: string;
  /** Test seam: a fetch that replaces the global one. */
  fetch?: typeof fetch;
}

/** Why a database call failed. Carries the PostgREST code and the table, never a row, a key or a filter value. */
export class DataPortError extends Error {
  readonly code: string | undefined;
  readonly table: string;
  /** PostgREST's own message (a generic text; the details field, which can quote values, is not kept). Not logged by this code. */
  readonly pgMessage: string | undefined;
  constructor(table: string, code: string | undefined, pgMessage?: string) {
    super(`database call failed on ${table}${code === undefined ? '' : ` (${code})`}`);
    this.name = 'DataPortError';
    this.code = code;
    this.table = table;
    this.pgMessage = pgMessage;
  }
}

/** The shape supabase-js returns for a failed call. */
export interface PgError {
  code?: string;
  message?: string;
}

/** Throws a DataPortError unless the call succeeded. Only the code of the error is kept. */
export function must<T>(table: string, res: { data: T; error?: PgError | null }): NonNullable<T> {
  if (res.error) throw new DataPortError(table, res.error.code, res.error.message);
  return res.data as NonNullable<T>;
}

/** `must` for a call whose success may carry no row (`maybeSingle`). */
export function mustMaybe<T>(table: string, res: { data: T; error?: PgError | null }): T {
  if (res.error) throw new DataPortError(table, res.error.code, res.error.message);
  return res.data;
}

export const isUniqueViolation = (error: PgError | null | undefined): boolean => !!error && error.code === '23505';

export function createServiceClient(cfg: SupabaseConfig): Db {
  return createClient<Database>(cfg.url, cfg.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(cfg.fetch === undefined ? {} : { global: { fetch: cfg.fetch } }),
  });
}

/** Epoch ms to the ISO string a timestamptz column takes. */
export const toIso = (ms: number): string => new Date(ms).toISOString();
/** A timestamptz as returned by PostgREST to epoch ms. */
export const fromIso = (iso: string): number => Date.parse(iso);
export const fromIsoOrNull = (iso: string | null): number | null => (iso === null ? null : Date.parse(iso));
