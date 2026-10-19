import { DurableObject } from 'cloudflare:workers';

/**
 * Semaphore sized to the fal account's concurrent-request limit (starts at 2; `genai.falConcurrency` in
 * config/guardrails.yaml). One instance per environment. Slots carry a TTL so a crashed Workflow cannot hold one
 * forever; `release` is idempotent and always runs from the job's `finally`. No timers, so the object hibernates.
 */
export class FalGateDO extends DurableObject {
  async acquire(jobId: string, ttlMs: number, slots = 2): Promise<boolean> {
    const now = Date.now();
    const held = await this.ctx.storage.list<number>({ prefix: 'slot:' });
    let active = 0;
    for (const [k, expires] of held) {
      if (expires <= now) await this.ctx.storage.delete(k);
      else active++;
    }
    const mine = `slot:${jobId}`;
    if (held.has(mine) && (held.get(mine) ?? 0) > now) {
      await this.ctx.storage.put(mine, now + ttlMs);
      return true;
    }
    if (active >= slots) return false;
    await this.ctx.storage.put(mine, now + ttlMs);
    return true;
  }

  async release(jobId: string): Promise<void> {
    await this.ctx.storage.delete(`slot:${jobId}`);
  }

  async held(): Promise<number> {
    const now = Date.now();
    const held = await this.ctx.storage.list<number>({ prefix: 'slot:' });
    let n = 0;
    for (const expires of held.values()) if (expires > now) n++;
    return n;
  }
}
