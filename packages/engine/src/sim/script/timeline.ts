import type { EcsApi, EntityHandle, JsonObject, TimelineRecorder } from '@dv/shared';
import { Transform } from '../ecs/components.ts';

export interface TimelineEvent {
  t: string;
  tick: number;
  data: JsonObject;
}
export interface ExternalInput {
  src: 'talk' | 'intent' | 'cutscene' | 'mode';
  tick: number;
  data: JsonObject;
}
/** One sample of a tracked entity: ENU position and heading (radians). */
export type TrackSample = [tick: number, x: number, y: number, z: number];

export interface TimelineOptions {
  ecs: EcsApi;
  tick(): number;
  /** Events kept in memory (oldest dropped first). Default 8,192. */
  cap?: number;
}

/**
 * `TimelineRecorder` (C06 1.1) with an in-memory buffer: `emit` events, `external` recorded asynchronous inputs, and one position
 * sample every 2 ticks for each tracked entity (`track`; `update` is called in `SimStage.Script`). `export` returns the buffer as
 * UTF-8 JSON; the `.dvtl` binary format and the scrubber come with M05a2. Sim code under the C02 lint.
 */
export class TimelineRecorderImpl implements TimelineRecorder {
  readonly snapshotEvery = 2 as const;
  private readonly log: TimelineEvent[] = [];
  private readonly ext: ExternalInput[] = [];
  private readonly tracked = new Map<number, string>();
  private readonly samples = new Map<string, TrackSample[]>();
  private readonly cap: number;

  constructor(private readonly o: TimelineOptions) {
    this.cap = o.cap ?? 8192;
  }

  emit(e: { t: string; tick: number; data: JsonObject }): void {
    this.log.push({ t: e.t, tick: e.tick, data: e.data });
    if (this.log.length > this.cap) this.log.shift();
  }

  external(e: ExternalInput): void {
    this.ext.push({ src: e.src, tick: e.tick, data: e.data });
    if (this.ext.length > this.cap) this.ext.shift();
  }

  /** Follows an entity under `name` until `untrack`. */
  track(h: EntityHandle, name: string): void {
    this.tracked.set(h, name);
  }

  untrack(h: EntityHandle): void {
    this.tracked.delete(h);
  }

  /** Samples the tracked entities on even ticks. */
  update(tick: number): void {
    if (this.tracked.size === 0 || tick % this.snapshotEvery !== 0) return;
    const tr = this.o.ecs.store(Transform);
    for (const [h, name] of [...this.tracked].sort((a, b) => a[0] - b[0])) {
      const id = this.o.ecs.resolve(h as EntityHandle);
      if (id === null) {
        this.tracked.delete(h);
        continue;
      }
      let list = this.samples.get(name);
      if (!list) this.samples.set(name, (list = []));
      list.push([tick, tr.px[id] as number, tr.py[id] as number, tr.pz[id] as number]);
    }
  }

  events(sinceTick = 0): readonly TimelineEvent[] {
    return sinceTick <= 0 ? this.log : this.log.filter((e) => e.tick >= sinceTick);
  }

  externals(): readonly ExternalInput[] {
    return this.ext;
  }

  tracks(): ReadonlyMap<string, readonly TrackSample[]> {
    return this.samples;
  }

  clear(): void {
    this.log.length = 0;
    this.ext.length = 0;
    this.samples.clear();
  }

  export(): ArrayBuffer {
    const body = JSON.stringify({
      v: 0,
      events: this.log,
      external: this.ext,
      tracks: [...this.samples].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    });
    const bytes = new TextEncoder().encode(body);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
}
