import type { FrameSignal, InputFrame, SimControlMessage, UiCommand } from '@dv/shared';
import { SpscRing } from './command-ring.ts';
import {
  decodeEnvelope, encodeEnvelope, isToWorkerMessage, makeEnvelope,
  type DebugCommand, type FromWorkerMessage,
} from './envelope.ts';
import { COMMAND_RING_BYTES, EVENT_RING_BYTES, EventRing } from './event-ring.ts';
import { InputBlock } from './input-block.ts';
import { SabSnapshotReader, SabSnapshotWriter, snapshotBufferBytes, type SnapshotRead } from './snapshot-buffer.ts';
import type { MainTransport, TransportCounters, WorkerCommand, WorkerTransport } from './types.ts';

/** The four SharedArrayBuffers the page hands to the worker at start-up. */
export interface SabInit {
  input: SharedArrayBuffer;
  commands: SharedArrayBuffer;
  events: SharedArrayBuffer;
  snapshots: SharedArrayBuffer;
}

export function createSabInit(): SabInit {
  const commands = new SharedArrayBuffer(SpscRing.byteLength(COMMAND_RING_BYTES));
  const events = new SharedArrayBuffer(SpscRing.byteLength(EVENT_RING_BYTES));
  SpscRing.init(commands, COMMAND_RING_BYTES);
  SpscRing.init(events, EVENT_RING_BYTES);
  return {
    input: new SharedArrayBuffer(InputBlock.byteLength()),
    commands,
    events,
    snapshots: new SharedArrayBuffer(snapshotBufferBytes()),
  };
}

class SabMain implements MainTransport {
  readonly kind = 'sab' as const;
  readonly input: InputBlock;
  readonly counters: TransportCounters = { commandsDropped: 0, eventsDropped: 0, snapshotReuse: 0 };
  private readonly commands: SpscRing;
  private readonly events: EventRing;
  private readonly reader: SabSnapshotReader;
  private seq = 0;

  constructor(init: SabInit) {
    this.input = InputBlock.create(init.input);
    this.commands = new SpscRing(init.commands);
    this.events = new EventRing(new SpscRing(init.events));
    this.reader = new SabSnapshotReader(init.snapshots);
  }

  private send(t: 'frame' | 'ctl' | 'dbg' | 'ui', p: FrameSignal | SimControlMessage | DebugCommand | UiCommand): boolean {
    const ok = this.commands.push(encodeEnvelope(makeEnvelope(t, this.seq++, p)));
    if (!ok) this.counters.commandsDropped++;
    return ok;
  }

  sendFrame(sig: FrameSignal): boolean {
    return this.send('frame', sig);
  }
  sendControl(msg: SimControlMessage): boolean {
    return this.send('ctl', msg);
  }
  sendDebug(cmd: DebugCommand): boolean {
    return this.send('dbg', cmd);
  }
  sendUi(cmd: UiCommand): boolean {
    return this.send('ui', cmd);
  }

  readSnapshot(): SnapshotRead | null {
    const r = this.reader.read();
    this.counters.snapshotReuse = this.reader.reuse;
    return r;
  }

  drainEvents(handler: (m: FromWorkerMessage) => void): number {
    const n = this.events.drain(handler);
    this.counters.eventsDropped = this.events.dropped;
    return n;
  }

  dispose(): void {}
}

class SabWorker implements WorkerTransport {
  readonly kind = 'sab' as const;
  readonly snapshots: SabSnapshotWriter;
  private readonly input: InputBlock;
  private readonly commands: SpscRing;
  private readonly events: EventRing;
  private readonly eventRing: SpscRing;
  private seq = 0;

  constructor(init: SabInit) {
    this.input = InputBlock.create(init.input);
    this.commands = new SpscRing(init.commands);
    this.eventRing = new SpscRing(init.events);
    this.events = new EventRing(this.eventRing);
    this.snapshots = new SabSnapshotWriter(init.snapshots);
  }

  drain(handler: (m: WorkerCommand) => void): number {
    let n = 0;
    for (let bytes = this.commands.pop(); bytes !== null; bytes = this.commands.pop()) {
      const msg = decodeEnvelope(bytes);
      if (!isToWorkerMessage(msg) || msg.t === 'input') continue;
      handler(msg);
      n++;
    }
    return n;
  }

  sampleInput(tick: number): InputFrame {
    return this.input.sample(tick);
  }

  postEvent(m: FromWorkerMessage): boolean {
    return this.events.post(makeEnvelope(m.t, this.seq++, m.p));
  }

  waitForCommand(): Promise<void> | null {
    const waitAsync = (Atomics as unknown as {
      waitAsync?: (a: Int32Array, i: number, v: number) => { async: boolean; value: Promise<string> | string };
    }).waitAsync;
    if (typeof waitAsync !== 'function') return null;
    const write = this.commands.writePos;
    if (write !== this.commands.readPos) return Promise.resolve();
    const r = waitAsync.call(Atomics, this.commands.header, 0, write | 0);
    return r.async ? (r.value as Promise<string>).then(() => undefined) : Promise.resolve();
  }

  get eventsDropped(): number {
    return this.events.dropped;
  }

  dispose(): void {}
}

/** The page's end plus the buffers to hand to the worker. */
export function createSabMain(init: SabInit = createSabInit()): { main: MainTransport; init: SabInit } {
  return { main: new SabMain(init), init };
}

/** The worker's end over the buffers the page created. */
export function attachSabWorker(init: SabInit): WorkerTransport {
  return new SabWorker(init);
}
