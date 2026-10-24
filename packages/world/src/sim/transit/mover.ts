/**
 * One transit mover (M03b2): a bus, a Metro train, a cable car or a ferry as a point on a route. The route position, the dwell and
 * the direction are sim state, hashed and checkpointed in order of key; a mover's place on its route never depends on the player or on
 * which chunks are resident, only its pose does. Pure; C02 lint applies.
 */
import type { Fnv64 } from '@dv/shared';
import type { ByteReader, ByteWriter } from '@dv/engine/sim';
import type { MoverKind } from './components.ts';
import type { Path } from './path.ts';

export class TransitMover {
  readonly key: string;
  readonly kind: MoverKind;
  /** Index into the route list of its kind. */
  route = 0;
  /** Number of the vehicle among all of its kind. */
  n = 0;
  /** Metres along the route. */
  s = 0;
  /** 1 forward, -1 back (shuttles only). */
  dir = 1;
  /** Ticks left of the stop. */
  dwell = 0;
  /** Index of the next stop (buses). */
  stop = 0;
  speed = 0;
  /** The ECS entity handle once the system made one (not hashed). */
  handle = 0;
  // derived
  x = 0;
  y = 0;
  z = 0;
  hx = 0;
  hz = -1;
  yaw = 0;

  constructor(key: string, kind: MoverKind) {
    this.key = key;
    this.kind = kind;
  }
}

/**
 * Advances a mover that runs back and forth along `path` at `cruise` m/s and waits `endDwell` ticks at each end. `step` is the AI
 * step in seconds, `stepTicks` the ticks it stands for.
 */
export function stepShuttle(m: TransitMover, path: Path, cruise: number, endDwell: number, step: number, stepTicks: number): void {
  if (m.dwell > 0) {
    m.dwell = m.dwell > stepTicks ? m.dwell - stepTicks : 0;
    m.speed = 0;
    return;
  }
  m.speed = cruise;
  m.s += m.dir * cruise * step;
  if (m.s >= path.length) {
    m.s = path.length;
    m.dir = -1;
    m.dwell = endDwell;
  } else if (m.s <= 0) {
    m.s = 0;
    m.dir = 1;
    m.dwell = endDwell;
  }
}

const byKey = (a: TransitMover, b: TransitMover): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** The movers in ascending key order (the order of every pass and of the hash). */
export function sortedMovers(list: readonly TransitMover[]): TransitMover[] {
  return [...list].sort(byKey);
}

export function hashMovers(h: Fnv64, movers: readonly TransitMover[]): void {
  h.u32(movers.length);
  for (const m of movers) {
    h.str(m.key).u32(m.route).u32(m.n).f64(m.s).u8(m.dir > 0 ? 1 : 0).u32(m.dwell).u32(m.stop).f64(m.speed);
  }
}

export function saveMovers(w: ByteWriter, movers: readonly TransitMover[]): void {
  w.u32(movers.length);
  for (const m of movers) {
    w.str(m.key);
    w.str(m.kind);
    w.u32(m.route);
    w.u32(m.n);
    w.f64(m.s);
    w.u8(m.dir > 0 ? 1 : 0);
    w.u32(m.dwell);
    w.u32(m.stop);
    w.f64(m.speed);
    w.u32(m.handle);
  }
}

export function loadMovers(r: ByteReader): TransitMover[] {
  const out: TransitMover[] = [];
  for (let n = r.u32(); n > 0; n--) {
    const m = new TransitMover(r.str(), r.str() as MoverKind);
    m.route = r.u32();
    m.n = r.u32();
    m.s = r.f64();
    m.dir = r.u8() !== 0 ? 1 : -1;
    m.dwell = r.u32();
    m.stop = r.u32();
    m.speed = r.f64();
    m.handle = r.u32();
    out.push(m);
  }
  return out;
}
