/**
 * Fetch priority lanes (11-platform-pwa.md section 5, "Fetch layer"): `now` up to 8 at once, `soon` up to `LANES`
 * (16 on desktop, 8 on mobile and XR), `idle` up to 2. Each lane has its own limit and its own FIFO queue.
 */
export type Priority = 'now' | 'soon' | 'idle';

export interface LaneLimits {
  now: number;
  soon: number;
  idle: number;
}

export const NOW_LANE = 8;
export const IDLE_LANE = 2;

export function laneLimits(mobileOrXr: boolean): LaneLimits {
  return { now: NOW_LANE, soon: mobileOrXr ? 8 : 16, idle: IDLE_LANE };
}

export interface LaneHandle<T> {
  promise: Promise<T>;
  /** Moves a job that is still queued to a higher-priority lane; a running job is unaffected. */
  promote(to: Priority): void;
}

interface Job {
  run: () => void;
  priority: Priority;
}

const ORDER: readonly Priority[] = ['now', 'soon', 'idle'];
const RANK: Record<Priority, number> = { now: 0, soon: 1, idle: 2 };

export class Lanes {
  readonly limits: LaneLimits;
  private readonly active: Record<Priority, number> = { now: 0, soon: 0, idle: 0 };
  /** Highest occupancy each lane has reached (tests and the bridge read it). */
  readonly peak: Record<Priority, number> = { now: 0, soon: 0, idle: 0 };
  private readonly queues: Record<Priority, Job[]> = { now: [], soon: [], idle: [] };

  constructor(limits: LaneLimits) {
    this.limits = limits;
  }

  occupancy(): Readonly<Record<Priority, number>> {
    return { ...this.active };
  }

  queued(): Readonly<Record<Priority, number>> {
    return { now: this.queues.now.length, soon: this.queues.soon.length, idle: this.queues.idle.length };
  }

  schedule<T>(priority: Priority, task: () => Promise<T>): LaneHandle<T> {
    let started = false;
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const job: Job = {
      priority,
      run: () => {
        started = true;
        const lane = job.priority;
        this.active[lane]++;
        if (this.active[lane] > this.peak[lane]) this.peak[lane] = this.active[lane];
        task().then(resolve, reject).finally(() => {
          this.active[lane]--;
          this.pump();
        });
      },
    };
    this.queues[priority].push(job);
    this.pump();
    return {
      promise,
      promote: (to) => {
        if (started || RANK[to] >= RANK[job.priority]) return;
        const q = this.queues[job.priority];
        const i = q.indexOf(job);
        if (i < 0) return;
        q.splice(i, 1);
        job.priority = to;
        this.queues[to].push(job);
        this.pump();
      },
    };
  }

  private pump(): void {
    for (const lane of ORDER) {
      const q = this.queues[lane];
      while (q.length > 0 && this.active[lane] < this.limits[lane]) {
        const job = q.shift();
        if (job) job.run();
      }
    }
  }
}
