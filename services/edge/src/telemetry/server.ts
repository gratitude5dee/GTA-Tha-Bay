import namesSchema from '@dv/shared/schemas/telemetry/names.schema.json' with { type: 'json' };
import type { Env } from '../env.ts';

/**
 * Server-only telemetry (C16 1.1: `quota.block`, ...). Never accepted from clients (the ingest route drops names outside
 * CLIENT_TELEMETRY_NAMES). Props are enums and numbers from the per-name schema; strings go to blobs and numbers to doubles in
 * schema order, behind the environment name and the timestamp. No profile id, net hash or free text is ever passed here.
 */
type Scalar = string | number | boolean;

interface NameSpec {
  properties: Record<string, unknown>;
}
const SPECS = namesSchema.$defs as unknown as Record<string, NameSpec>;

let sink: ((name: string, props: Record<string, Scalar>) => void) | null = null;

/** Test seam: a function that sees every server event, instead of Analytics Engine (which a test cannot read). Null restores the default. */
export function setServerEventSinkForTests(fn: ((name: string, props: Record<string, Scalar>) => void) | null): void {
  sink = fn;
}

export function writeServerEvent(env: Pick<Env, 'AE' | 'ENVIRONMENT'>, name: string, props: Record<string, Scalar>, ts: number): void {
  if (sink !== null) {
    sink(name, props);
    return;
  }
  const spec = SPECS[name];
  if (!spec || !env.AE) return;
  const blobs: string[] = [env.ENVIRONMENT];
  const doubles: number[] = [ts];
  for (const key of Object.keys(spec.properties)) {
    const value = props[key];
    if (value === undefined) continue;
    if (typeof value === 'string') blobs.push(value);
    else doubles.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
  }
  try {
    env.AE.writeDataPoint({ indexes: [name], blobs, doubles });
  } catch {
    // Telemetry is never on the critical path.
  }
}
