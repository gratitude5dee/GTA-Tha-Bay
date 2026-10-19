import type { FrameSignal, InputFrame, SimControlMessage } from '@dv/shared';
import {
  isFromWorkerMessage, isToWorkerMessage, makeEnvelope,
  type DebugCommand, type FromWorkerMessage, type ToWorkerMessage,
} from './envelope.ts';
import { InputBlock } from './input-block.ts';
import { PmSnapshotReader, PmSnapshotSink, type SnapshotRead } from './snapshot-buffer.ts';
import type { MainTransport, TransportCounters, WorkerCommand, WorkerTransport } from './types.ts';

/**
 * The part of a Worker, a DedicatedWorkerGlobalScope or a Node MessagePort that the fallback uses. Declared
 * structurally because the sim tsconfig has no DOM lib.
 */
export interface PortLike {
  postMessage(message: unknown, transfer?: unknown[]): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener?(type: 'message', listener: (event: { data: unknown }) => void): void;
  start?(): void;
}

class PmMain implements MainTransport {
  readonly kind = 'postMessage' as const;
  readonly input = InputBlock.create();
  readonly counters: TransportCounters = { commandsDropped: 0, eventsDropped: 0, snapshotReuse: 0 };
  private readonly inbox: FromWorkerMessage[] = [];
  private readonly reader = new PmSnapshotReader();
  private seq = 0;
  private readonly listener = (ev: { data: unknown }): void => {
    const m = ev.data;
    if (!isFromWorkerMessage(m)) return;
    if (m.t === 'snap') this.reader.push(m.p);
    else this.inbox.push(m);
  };

  constructor(private readonly port: PortLike) {
    port.addEventListener('message', this.listener);
    port.start?.();
  }

  private post(m: ToWorkerMessage): boolean {
    this.port.postMessage(m);
    return true;
  }

  sendFrame(sig: FrameSignal): boolean {
    // The input state rides ahead of the frame it belongs to, in the same order the SAB block would be read.
    this.post(makeEnvelope('input', this.seq++, this.input.drain()));
    return this.post(makeEnvelope('frame', this.seq++, sig));
  }
  sendControl(msg: SimControlMessage): boolean {
    return this.post(makeEnvelope('ctl', this.seq++, msg));
  }
  sendDebug(cmd: DebugCommand): boolean {
    return this.post(makeEnvelope('dbg', this.seq++, cmd));
  }

  readSnapshot(): SnapshotRead | null {
    const r = this.reader.read();
    this.counters.snapshotReuse = this.reader.reuse;
    return r;
  }

  drainEvents(handler: (m: FromWorkerMessage) => void): number {
    const batch = this.inbox.splice(0, this.inbox.length);
    for (const m of batch) handler(m);
    return batch.length;
  }

  dispose(): void {
    this.port.removeEventListener?.('message', this.listener);
  }
}

class PmWorker implements WorkerTransport {
  readonly kind = 'postMessage' as const;
  readonly snapshots: PmSnapshotSink;
  eventsDropped = 0;
  private readonly input = InputBlock.create();
  private readonly inbox: WorkerCommand[] = [];
  private waiter: (() => void) | null = null;
  private seq = 0;
  private readonly listener = (ev: { data: unknown }): void => {
    const m = ev.data;
    if (!isToWorkerMessage(m)) return;
    if (m.t === 'input') {
      this.input.apply(m.p);
      return;
    }
    this.inbox.push(m);
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w();
    }
  };

  constructor(private readonly port: PortLike) {
    this.snapshots = new PmSnapshotSink((payload, transfer) => {
      this.port.postMessage(makeEnvelope('snap', this.seq++, payload), transfer);
    });
    port.addEventListener('message', this.listener);
    port.start?.();
  }

  drain(handler: (m: WorkerCommand) => void): number {
    const batch = this.inbox.splice(0, this.inbox.length);
    for (const m of batch) handler(m);
    return batch.length;
  }

  sampleInput(tick: number): InputFrame {
    return this.input.sample(tick);
  }

  postEvent(m: FromWorkerMessage): boolean {
    this.port.postMessage(makeEnvelope(m.t, this.seq++, m.p));
    return true;
  }

  waitForCommand(): Promise<void> | null {
    if (this.inbox.length > 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiter = resolve;
    });
  }

  dispose(): void {
    this.port.removeEventListener?.('message', this.listener);
  }
}

export function createPmMain(port: PortLike): MainTransport {
  return new PmMain(port);
}

export function attachPmWorker(port: PortLike): WorkerTransport {
  return new PmWorker(port);
}
