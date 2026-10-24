import type { FrameSignal, InputFrame, SimControlMessage, UiCommand } from '@dv/shared';
import type { InputBlock } from './input-block.ts';
import type { DebugCommand, FromWorkerMessage, ToWorkerMessage } from './envelope.ts';
import type { SnapshotRead, SnapshotWriter } from './snapshot-buffer.ts';

export type TransportKind = 'sab' | 'postMessage';

export interface TransportCounters {
  /** Frame, control or debug messages the page could not send because the command ring was full. */
  commandsDropped: number;
  /** Events the worker could not post because the event ring was full. */
  eventsDropped: number;
  /** `readSnapshot` calls that returned the previous snapshot. */
  snapshotReuse: number;
}

/** The page's end of the channel. */
export interface MainTransport {
  readonly kind: TransportKind;
  /** Written by the input binders on the page. */
  readonly input: InputBlock;
  /** Never blocks. False when the message was dropped. */
  sendFrame(sig: FrameSignal): boolean;
  sendControl(msg: SimControlMessage): boolean;
  sendDebug(cmd: DebugCommand): boolean;
  /** A `UiCommand` over the command ring (M04a2). */
  sendUi(cmd: UiCommand): boolean;
  readSnapshot(): SnapshotRead | null;
  /** Calls `handler` for every event received since the last call. */
  drainEvents(handler: (m: FromWorkerMessage) => void): number;
  readonly counters: TransportCounters;
  dispose(): void;
}

/** What the worker is told to do, in arrival order; input messages are applied by the transport itself. */
export type WorkerCommand = Exclude<ToWorkerMessage, { t: 'input' }>;

/** sim.worker's end of the channel. */
export interface WorkerTransport {
  readonly kind: TransportKind;
  /** Hands every pending command to `handler`, in order, and returns how many there were. */
  drain(handler: (m: WorkerCommand) => void): number;
  /** The InputFrame for `tick`; consumes the latched edges. */
  sampleInput(tick: number): InputFrame;
  readonly snapshots: SnapshotWriter;
  /** Posts an event to the page. False when it was dropped. */
  postEvent(m: FromWorkerMessage): boolean;
  /** Resolves when a command is pending; null when the platform cannot wait asynchronously (the caller polls). */
  waitForCommand(): Promise<void> | null;
  readonly eventsDropped: number;
  dispose(): void;
}
