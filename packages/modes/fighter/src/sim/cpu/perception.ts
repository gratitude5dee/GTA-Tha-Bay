/**
 * CPU perception (FC10.1): the CPU never reads the opponent's buttons. Each tick it records a copy of the opponent's PUBLIC state
 * (state, move and frame, position, facing, nearest enemy projectile) into a ring and reads that copy back `reaction` frames late.
 * The ring holds 64 ticks (the spec's 16 entries cannot cover the Easy delay of up to 41 frames; BD-M08a2-04). This file reads the
 * fighter and projectile words of the match buffer and nothing of the input rings. Sim code under the C02 lint.
 */
import { FF, FIGHTER_BASE, PROJ_BASE, PROJ_MAX, PROJ_WORDS, PW } from '@dv/shared/fight';

export const PERCEPT_RING = 64;
const W = 12;

/** What the CPU saw of the opponent `delay` ticks ago. */
export interface Percept {
  valid: boolean;
  state: number; move: number; moveFrame: number;
  x: number; y: number; facing: number;
  hitstun: number; blockstun: number;
  /** Enemy projectiles in flight at that moment, and the x of the nearest one to the CPU (0 when none). */
  projCount: number; projX: number; projDir: number;
}

const ST = 0, MV = 1, MF = 2, PX = 3, PY = 4, FC = 5, HS = 6, BS = 7, PC = 8, PPX = 9, PD = 10, TK = 11;

export class Perception {
  private readonly data = new Int32Array(PERCEPT_RING * W);
  private readonly out: Percept = {
    valid: false, state: 0, move: -1, moveFrame: 0, x: 0, y: 0, facing: 1, hitstun: 0, blockstun: 0, projCount: 0, projX: 0, projDir: 0,
  };

  constructor(readonly self: 0 | 1) {
    for (let i = 0; i < PERCEPT_RING; i++) this.data[i * W + TK] = -1;
  }

  /** Records the opponent's public state of this tick. */
  push(buf: Int32Array, tick: number): void {
    const opp = this.self === 0 ? 1 : 0;
    const o = FIGHTER_BASE[opp] as number, me = FIGHTER_BASE[this.self] as number;
    const base = (tick % PERCEPT_RING) * W;
    const d = this.data;
    d[base + ST] = buf[o + FF.State] as number;
    d[base + MV] = buf[o + FF.Move] as number;
    d[base + MF] = buf[o + FF.MoveFrame] as number;
    d[base + PX] = buf[o + FF.X] as number;
    d[base + PY] = buf[o + FF.Y] as number;
    d[base + FC] = buf[o + FF.Facing] as number;
    d[base + HS] = buf[o + FF.Hitstun] as number;
    d[base + BS] = buf[o + FF.Blockstun] as number;
    let n = 0, best = 0x7fffffff, bx = 0, bd = 0;
    const myX = buf[me + FF.X] as number;
    for (let p = 0; p < PROJ_MAX; p++) {
      const b = PROJ_BASE + p * PROJ_WORDS;
      if ((buf[b + PW.Owner] as number) !== opp + 1) continue;
      n++;
      const dist = Math.abs((buf[b + PW.X] as number) - myX);
      if (dist < best) { best = dist; bx = buf[b + PW.X] as number; bd = buf[b + PW.Dir] as number; }
    }
    d[base + PC] = n; d[base + PPX] = bx; d[base + PD] = bd;
    d[base + TK] = tick;
  }

  /** The record of tick `tick - delay`; `valid` is false while the ring does not reach that far back. The object is reused. */
  at(tick: number, delay: number): Percept {
    const t = tick - delay;
    const o = this.out;
    const base = (((t % PERCEPT_RING) + PERCEPT_RING) % PERCEPT_RING) * W;
    const d = this.data;
    if (t < 0 || d[base + TK] !== t) { o.valid = false; return o; }
    o.valid = true;
    o.state = d[base + ST] as number; o.move = d[base + MV] as number; o.moveFrame = d[base + MF] as number;
    o.x = d[base + PX] as number; o.y = d[base + PY] as number; o.facing = d[base + FC] as number;
    o.hitstun = d[base + HS] as number; o.blockstun = d[base + BS] as number;
    o.projCount = d[base + PC] as number; o.projX = d[base + PPX] as number; o.projDir = d[base + PD] as number;
    return o;
  }

  reset(): void {
    for (let i = 0; i < PERCEPT_RING; i++) this.data[i * W + TK] = -1;
  }
}
