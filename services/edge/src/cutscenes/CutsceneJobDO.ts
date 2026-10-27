import { DurableObject } from 'cloudflare:workers';
import type { CutsceneStatus, GenJob } from '@dv/shared';
import { cutsceneKeyOf, manifestKeyOf, modePairingError, PUBLISH_PHASE, publishWorkflowId, workflowId } from '@dv/pipeline/core';
import { finishKeyOf } from '@dv/shared';
import type { Env } from '../env.ts';

/**
 * Single-flight lock for one cutscene key (instance name `cut:<cacheKey>`). The ready test is `HEAD cutscenes/<key>/manifest.json`
 * (D-19). States: absent -> pending -> ready | failed (spec/domains/09-backend.md section 5.1). Concurrent `ensure` calls share the
 * one Workflow instance: the whole transition runs under `blockConcurrencyWhile`, so a second caller sees `pending`.
 * A failed key is re-armed by an alarm after 1 h, at most 3 times; after that only staff reset it.
 *
 * `handed_off` (M05c4, DL-745): the fal job finished and its output sits in PRIVATE; the operator's `--finish` does the transcode and
 * re-sign. Route 27 answers `pending`. The 2 h watchdog, the failed-key re-arm and `unquarantine` leave the state alone, so a key that
 * was paid for is never paid for twice. Route 28 starts no fal job for it: it waits for `finish.json` and then starts the publish phase.
 * Only a ready manifest, a kill purge (M10b, `quarantine`) or an operator `reset` ends the state.
 */
type State = 'absent' | 'pending' | 'ready' | 'failed' | 'blocked' | 'handed_off';

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
  /** The publish-phase Workflow instance of a handed-off key, while one runs. */
  publishInstanceId: string | null;
  publishSince: number | null;
}

const EMPTY: Persisted = {
  state: 'absent', key: null, attempt: 0, rearms: 0, instanceId: null, manifestKey: null, costUsdMicros: 0, error: null, pendingSince: null, blockedFrom: null, blockedScope: null,
  publishInstanceId: null, publishSince: null,
};
const HOUR_MS = 60 * 60 * 1000;
const MAX_REARMS = 3;
/** A workflow that never reports back is treated as failed after this long. */
const PENDING_WATCHDOG_MS = 2 * HOUR_MS;
/** A publish phase that never reported back (checked lazily at the next route 28 call; a handed-off key has no alarm). */
const PUBLISH_STALE_MS = 30 * 60 * 1000;

export class CutsceneJobDO extends DurableObject<Env> {
  private async load(): Promise<Persisted> {
    return { ...EMPTY, ...((await this.ctx.storage.get<Persisted>('s')) ?? {}) };
  }

  private async save(s: Persisted): Promise<void> {
    await this.ctx.storage.put('s', s);
  }

  private view(key: string, s: Persisted): CutsceneStatus {
    if (s.state === 'ready') return { key, state: 'ready', manifestUrl: `${this.env.HOST_MEDIA}/${manifestKeyOf(key)}` };
    // C12 has no handed-off state: from the client's side the clip is still being made.
    return { key, state: s.state === 'handed_off' ? 'pending' : s.state };
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
      if (s.state === 'handed_off') return this.advanceHandedOff(job, key, s);
      if (s.state === 'pending' || s.state === 'failed') return this.view(key, s);
      if (!opts.allowGenerate) return { key, state: 'absent' as const };
      // M05c4: a pairing that cannot work (live fal with the mock transcoder) starts nothing: no claim, no budget, no fal call.
      const pairing = modePairingError(this.env);
      if (pairing !== null) {
        console.error(`cutscene ${key.slice(0, 12)}: ${pairing}`);
        return { key, state: 'failed' as const };
      }

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

  /**
   * Route 28 on a handed-off key: no fal job. Nothing happens until `finish.json` exists; then one publish-phase instance starts (and only
   * one: a second call while it runs, or within PUBLISH_STALE_MS of its start, sees `pending`).
   */
  private async advanceHandedOff(job: GenJob, key: string, s: Persisted): Promise<CutsceneStatus> {
    const now = Date.now();
    if (s.publishInstanceId !== null && s.publishSince !== null && now - s.publishSince < PUBLISH_STALE_MS) return this.view(key, s);
    if ((await this.env.PRIVATE.head(finishKeyOf(key))) === null) return this.view(key, s);
    s.attempt += 1;
    s.publishInstanceId = publishWorkflowId(job.jobKey, s.attempt);
    s.publishSince = now;
    await this.save(s);
    try {
      await this.env.GEN_WF.create({ id: s.publishInstanceId, params: { ...job, params: { ...job.params, phase: PUBLISH_PHASE } } });
    } catch (e) {
      s.publishInstanceId = null;
      s.publishSince = null;
      s.error = `publish workflow create: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500);
      await this.save(s);
    }
    return this.view(key, s);
  }

  /** The fal job finished and its output is in PRIVATE (JobSinkPort.handoff). No alarm: nothing times a handed-off key out. */
  async handoff(r: { costUsdMicros: number }): Promise<void> {
    const s = await this.load();
    if (s.state === 'ready') return;
    s.costUsdMicros = Math.max(s.costUsdMicros, r.costUsdMicros);
    if (s.state === 'blocked') s.blockedFrom = 'handed_off';
    else {
      s.state = 'handed_off';
      s.error = null;
      s.pendingSince = null;
      s.publishInstanceId = null;
      s.publishSince = null;
      await this.ctx.storage.deleteAlarm();
    }
    await this.save(s);
  }

  async complete(r: { manifestKey: string; costUsdMicros: number }): Promise<void> {
    const s = await this.load();
    if (s.state === 'blocked') return;
    s.state = 'ready';
    s.manifestKey = r.manifestKey;
    s.costUsdMicros = r.costUsdMicros;
    s.error = null;
    s.pendingSince = null;
    s.publishInstanceId = null;
    s.publishSince = null;
    await this.save(s);
    await this.ctx.storage.deleteAlarm();
  }

  async fail(err: string, code?: string): Promise<void> {
    const s = await this.load();
    if (s.state === 'ready' || s.state === 'blocked') return;
    if (s.state === 'handed_off') {
      // A refused or failed publish keeps the hand-off: the spend is made and the original is stored. A kill blocks the key instead.
      s.error = err.slice(0, 500);
      s.publishInstanceId = null;
      s.publishSince = null;
      if (code === 'KILLED') {
        s.blockedFrom = 'handed_off';
        s.blockedScope = 'cutscene';
        s.state = 'blocked';
      }
      await this.save(s);
      return;
    }
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

  /** Staff reset: after the automatic re-arms are used up, or to end a hand-off (the operator also deletes `handoff.json`, or the next job stops at it). */
  async reset(): Promise<void> {
    const s = await this.load();
    if (s.state !== 'failed' && s.state !== 'handed_off') return;
    s.state = 'absent';
    s.rearms = 0;
    s.publishInstanceId = null;
    s.publishSince = null;
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
