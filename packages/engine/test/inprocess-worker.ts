import type { SimConfig } from '@dv/shared';
import { SimRuntime, type SimModule } from '../src/sim/runtime.ts';
import { isInitMessage, type WorkerLike } from '../src/sim/sim-host.ts';
import { attachPmWorker } from '../src/sim/transport/pm-transport.ts';
import { attachSabWorker } from '../src/sim/transport/sab-transport.ts';
import type { WorkerTransport } from '../src/sim/transport/types.ts';

type Listener = (event: { data: unknown }) => void;

/**
 * A `WorkerLike` that runs the sim runtime in the test's own thread. `postMessage(init)` boots a runtime; `pump()`
 * lets it handle what the page sent since. The SAB transport shares real SharedArrayBuffers, so the page side is the
 * production code. The postMessage transport is not supported here (it is covered through MessageChannel in
 * transport.spec.ts).
 */
export class InProcessWorker implements WorkerLike {
  runtime: SimRuntime | null = null;
  terminated = false;
  cfg: SimConfig | null = null;
  private readonly message: Listener[] = [];
  private readonly error: ((e: unknown) => void)[] = [];
  private booting: Promise<void> = Promise.resolve();

  constructor(private readonly modules: readonly SimModule[] = []) {}

  postMessage(message: unknown): void {
    if (!isInitMessage(message)) throw new Error('InProcessWorker only understands the init message');
    const { cfg, boot, sab, qa } = message.p;
    if (!sab) throw new Error('InProcessWorker needs the SAB transport');
    this.cfg = cfg;
    const transport: WorkerTransport = attachSabWorker(sab);
    const runtime = new SimRuntime(transport, { now: () => 0, blockFor: () => {}, qa, ...(this.modules.length > 0 ? { modules: this.modules } : {}) });
    this.runtime = runtime;
    this.booting = runtime.boot(cfg, boot).then(() => this.emit({ v: 1, t: 'ready', seq: 0, p: { physicsBuild: cfg.physicsBuild, transport: 'sab' } }));
  }

  /** Resolves once boot has finished. */
  ready(): Promise<void> {
    return this.booting;
  }

  pump(): number {
    if (this.terminated || !this.runtime?.sim) return 0;
    return this.runtime.pump();
  }

  emit(data: unknown): void {
    for (const l of this.message) l({ data });
  }

  fail(message: string): void {
    for (const l of this.error) l({ message });
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') this.message.push(listener as Listener);
    else if (type === 'error') this.error.push(listener as (e: unknown) => void);
  }

  terminate(): void {
    this.terminated = true;
    this.runtime?.dispose();
  }
}

export { attachPmWorker };
