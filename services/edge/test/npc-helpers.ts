import { InMemoryDataPort } from '@dv/shared/data-port.memory';
import { dropRosterCache } from '../src/flags/roster.ts';
import { resetBoundCache } from '../src/id/bind.ts';
import { createApp } from '../src/index.ts';
import { setClockForTests } from '../src/clock.ts';
import { setDataPortForTests } from '../src/data/index.ts';
import { setQueueSinksForTests, type JobMessage } from '../src/ops/queue.ts';
import { setServerEventSinkForTests } from '../src/telemetry/server.ts';
import type { Env } from '../src/env.ts';
import { call } from './helpers.ts';

/** Fixed secrets of the M06a1 suites. */
export const OPS_TOKEN = 'ops-test-token';
export const PLAY_SECRET = `k1:${btoa(String.fromCharCode(...new Uint8Array(32).fill(9))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

export interface Harness {
  port: InMemoryDataPort;
  app: ReturnType<typeof createApp>;
  /** Mocked time shared by the app (deps.now), the Durable Objects (clock.ts) and the in-memory port. */
  clock: { t: number };
  jobs: JobMessage[];
  logs: string[];
  /** Calls the app with the ops token and the test secrets in the environment. */
  api(path: string, init?: RequestInit & { env?: Partial<Env>; country?: string; ops?: boolean; bearer?: string }): Promise<Response>;
  dispose(): void;
}

/**
 * A Worker app wired to one InMemoryDataPort and one mocked clock, with the queue and the data seams of the Durable Objects pointed at the same
 * objects. `t0` defaults to a time in the real future so alarms set against the mocked clock are not run by workerd on their own.
 */
export function harness(opts: { t0?: number; env?: Partial<Env> } = {}): Harness {
  const clock = { t: opts.t0 ?? Date.UTC(2031, 0, 1, 12, 0, 0) };
  const port = new InMemoryDataPort({ now: () => clock.t, env: 'test' });
  const jobs: JobMessage[] = [];
  const logs: string[] = [];
  setClockForTests(() => clock.t);
  setDataPortForTests(port);
  setQueueSinksForTests({ jobs: (m) => jobs.push(m), spend: () => undefined });
  setServerEventSinkForTests(() => undefined);
  dropRosterCache();
  resetBoundCache();
  const app = createApp({ data: () => port, now: () => clock.t, log: (l) => logs.push(l) });
  return {
    port,
    app,
    clock,
    jobs,
    logs,
    api(path, init = {}) {
      const { env, country, ops, bearer, ...rest } = init;
      const headers = new Headers(rest.headers);
      if (ops && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${OPS_TOKEN}`);
      if (bearer !== undefined) headers.set('Authorization', bearer);
      return call(path, { ...rest, headers, app, country: country ?? 'US', env: { OPS_TOKEN, PLAY_TOKEN_HMAC: PLAY_SECRET, ...opts.env, ...env } });
    },
    dispose() {
      setClockForTests(null);
      setDataPortForTests(undefined);
      setQueueSinksForTests({ jobs: null, spend: null });
      setServerEventSinkForTests(null);
      dropRosterCache();
      resetBoundCache();
    },
  };
}

/** A valid play token for `pid` under the key thumbprint `dkt`, issued at `now`. */
export async function playToken(pid: string, dkt: string, now: number, over: { secret?: string; age?: string; ttlMs?: number } = {}): Promise<string> {
  const { mint } = await import('../src/id/playtoken.ts');
  const token = await mint(
    { PLAY_TOKEN_HMAC: over.secret ?? PLAY_SECRET },
    { pid, dkt, age: (over.age ?? '18p') as '18p', iat: now, exp: now + (over.ttlMs ?? 86_400_000) },
  );
  if (token === null) throw new Error('mint failed');
  return token;
}
