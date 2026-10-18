import { decodeEnvelope, encodeEnvelope, isFromWorkerMessage, type Envelope, type FromWorkerMessage } from './envelope.ts';
import type { SpscRing } from './command-ring.ts';

/** Default ring sizes: a frame signal is about 100 bytes, so 64 KiB holds several seconds of backlog. */
export const COMMAND_RING_BYTES = 64 * 1024;
export const EVENT_RING_BYTES = 64 * 1024;

/**
 * Worker to main events (audio cues, view-model patches, stats, log lines) over an `SpscRing`. When the ring is full
 * the event is dropped and counted in `dropped`; the worker never waits for the page.
 */
export class EventRing {
  constructor(private readonly ring: SpscRing) {}

  /** Worker side. False when the event was dropped. */
  post(env: Envelope<string, unknown>): boolean {
    return this.ring.push(encodeEnvelope(env));
  }

  /** Main side. Calls `handler` for every valid event, in order; returns how many it delivered. */
  drain(handler: (m: FromWorkerMessage) => void): number {
    let n = 0;
    for (let bytes = this.ring.pop(); bytes !== null; bytes = this.ring.pop()) {
      const msg = decodeEnvelope(bytes);
      if (isFromWorkerMessage(msg)) {
        handler(msg);
        n++;
      }
    }
    return n;
  }

  get dropped(): number {
    return this.ring.dropped;
  }
}
