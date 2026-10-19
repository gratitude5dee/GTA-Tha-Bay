import { DurableObject } from 'cloudflare:workers';
import type { CutsceneStatus, GenJob } from '@dv/shared';
import { cutsceneKeyOf, manifestKeyOf, workflowId } from '@dv/pipeline/core';
import type { Env } from '../env.ts';

/**
 * Single-flight lock for one cutscene key (instance name `cut:<cacheKey>`). The ready test is `HEAD cutscenes/<key>/manifest.json`
 * (D-19). States: absent -> pending -> ready | failed (spec/domains/09-backend.md section 5.1). Concurrent `ensure` calls share the
 * one Workflow instance: the whole transition runs under `blockConcurrencyWhile`, so a second caller sees `pending`.
 * A failed key is re-armed by an alarm after 1 h, at most 3 times; after that only staff reset it.
 */
type State = 'absent' | 'pending' | 'ready' | 'failed' | 'blocked';

interface Persisted {
  state: State;
  key: string | null;
  /** Workflow attempts started so far; part of the instance id. */
  attempt: number;
  rearms: number;
  instanceId: string | null;
  manifestKey: string | null;
  costUsdMicros: number;
  error: string | null;
  pendingSince: number | null;
  /** State to restore when a quarantine is lifted. */
  blockedFrom: State | null;
  blockedScope: string | null;
}

const EMPTY: Persisted = { state: 'absent', key: null, attempt: 0, rearms: 0, instanceId: null, manifestKey: null, costUsdMicros: 0, error: null, pendingSince: null, blockedFrom: null, blockedScope: null };
const HOUR_MS = 60 * 60 * 1000;
const MAX_REARMS = 3;
/** A workflow that never reports back is treated as failed after this long. */
const PENDING_WATCHDOG_MS = 2 * HOUR_MS;

export class CutsceneJobDO extends DurableObject<Env> {
  private async load(): Promise<Persisted> {
    return { ...EMPTY, ...((await this.ctx.storage.get<Persisted>('s')) ?? {}) };
  }

  private async save(s: Persisted): Promise<void> {
    await this.ctx.storage.put('s', s);
  }

  private view(key: string, s: Persisted): CutsceneStatus {
    if (s.state === 'ready') return { key, state: 'ready', manifestUrl: `${this.env.HOST_MEDIA}/${manifestKeyOf(key)}` };
    return { key, state: s.state };
  }

  /** Promotes the state to `ready` when the manifest exists in MEDIA (the ready test), whatever the stored state says. */
  private async detectReady(key: string, s: Persisted): Promise<boolean> {
    if (s.state === 'ready') return true;
    if ((await this.env.MEDIA.head(manifestKeyOf(key))) === null) return false;
    s.state = 'ready';
    s.key = key;
    s.manifestKey = manifestKeyOf(key);
    s.error = null;
    s.pendingSince = null;
    await this.save(s);
    return true;
  }

  /** Read-only status (route 27): never starts generation. */
  status(key: string): Promise<CutsceneStatus> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.load();
      if (s.state === 'blocked') return { key, state: 'blocked' as const };
      await this.detectReady(key, s);
      return this.view(key, s);
    });
  }

  ensure(job: GenJob, opts: { allowGenerate: boolean }): Promise<CutsceneStatus> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const key = cutsceneKeyOf(job);
      const s = await this.load();
      if (s.state === 'blocked') return { key, state: 'blocked' as const };
      if (await this.detectReady(key, s)) return this.view(key, s);
      if (s.state === 'pending' || s.state === 'failed') return this.view(key, s);
      if (!opts.allowGenerate) return { key, state: 'absent' as const };

      // absent and allowed: claim the key before any other await, then start exactly one Workflow instance
      s.attempt += 1;
      s.key = key;
      s.state = 'pending';
      s.instanceId = workflowId(job.jobKey, s.attempt);
      s.pendingSince = Date.now();
      s.error = null;
      await this.save(s);
      try {
        await this.env.GEN_WF.create({ id: s.instanceId, params: job });
      } catch (e) {
        s.state = 'failed';
        s.error = `workflow create: ${e instanceof Error ? e.message : String(e)}`;
        s.pendingSince = null;
        await this.save(s);
        await this.armRearm(s);
        return { key, state: 'failed' as const };
      }
      await this.ctx.storage.setAlarm(Date.now() + PENDING_WATCHDOG_MS);
      return { key, state: 'pending' as const };
    });
  }

  async complete(r: { manifestKey: string; costUsdMicros: number }): Promise<void> {
    const s = await this.load();
    if (s.state === 'blocked') return;
    s.state = 'ready';
    s.manifestKey = r.manifestKey;
    s.costUsdMicros = r.costUsdMicros;
    s.error = null;
    s.pendingSince = null;
    await this.save(s);
    await this.ctx.storage.deleteAlarm();
  }

  async fail(err: string): Promise<void> {
    const s = await this.load();
    if (s.state === 'ready' || s.state === 'blocked') return;
    s.state = 'failed';
    s.error = err.slice(0, 500);
    s.pendingSince = null;
    await this.save(s);
    await this.armRearm(s);
  }

  /** Kill purge (M10b) and kill scopes make the route answer `blocked` while the object is quarantined. */
  async quarantine(scope: string): Promise<void> {
    const s = await this.load();
    if (s.state === 'blocked') return;
    s.blockedFrom = s.state;
    s.blockedScope = scope;
    s.state = 'blocked';
    await this.save(s);
  }

  async unquarantine(): Promise<void> {
    const s = await this.load();
    if (s.state !== 'blocked') return;
    s.state = s.blockedFrom === 'pending' ? 'absent' : (s.blockedFrom ?? 'absent');
    s.blockedFrom = null;
    s.blockedScope = null;
    await this.save(s);
  }

  /** Staff reset after the automatic re-arms are used up. */
  async reset(): Promise<void> {
    const s = await this.load();
    if (s.state !== 'failed') return;
    s.state = 'absent';
    s.rearms = 0;
    await this.save(s);
  }

  private async armRearm(s: Persisted): Promise<void> {
    if (s.rearms < MAX_REARMS) await this.ctx.storage.setAlarm(Date.now() + HOUR_MS);
    else await this.ctx.storage.deleteAlarm();
  }

  /** Re-arms a failed key (back to absent, at most 3 times) and fails a pending key whose workflow never reported. */
  override async alarm(): Promise<void> {
    const s = await this.load();
    if (s.state === 'failed' && s.rearms < MAX_REARMS) {
      s.rearms += 1;
      s.state = 'absent';
      await this.save(s);
    } else if (s.state === 'pending' && s.pendingSince !== null && Date.now() - s.pendingSince >= PENDING_WATCHDOG_MS) {
      await this.fail('workflow did not report within 2 h');
    }
  }

  /** Test and ops view of the stored record. */
  inspect(): Promise<Persisted> {
    return this.load();
  }
}
