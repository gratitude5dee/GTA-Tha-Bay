/**
 * Open-world melee (M05c1): the `CombatApi` of `ModeContext` and the system that runs it in `SimStage.Rules`. A move is started by
 * `startMove` (a mode, a script) or by the local player's Attack button; hits are capsule tests at 60 Hz against every character with
 * `Health`. Damage goes into `Health`; a `takedown` on a damaged target, or any hit that would take a target to 0, sets `Health.ko`
 * (non-lethal: nothing is despawned). Each hit by the local player reports one `assault` infraction to the pursuit director.
 *
 * The state of a move in progress (move id, frame, victims already hit) lives in this service, not in the `Combat` component:
 * the component would have to be added to every character prefab, which would change the state hash of every session, and a move
 * lasts at most 36 ticks. It is derived from the inputs of the ticks it spans, so replays agree. Sim code under the C02 lint.
 */
import { datan2, dcos, dsin, dsqrt, type CombatApi, type EcsApi, type EntityHandle, type EntityId, type InputFrame } from '@dv/shared';
import { Control, Health, LocalPlayer, Transform } from '../ecs/components.ts';
import { CONTROL_OWNER } from '../control/states.ts';
import {
  BASIC_MOVE_SET, HITBOX_Y_M, KO_TICKS, MOVES, TAKEDOWN_BELOW, VICTIM_HEIGHT_M, VICTIM_RADIUS_M, WAKE_FRACTION, isMoveId, type MoveDef, type MoveId,
} from './moves.ts';

const ATTACK_BIT = 1 << 4;
const ABILITY_BIT = 1 << 9;
/** Aim assist reach in metres and the smallest cosine between facing and target (cos 100 degrees). */
const ASSIST_RANGE_M = 3;
const ASSIST_MIN_DOT = -0.17;

export interface HitEvent {
  attacker: EntityHandle;
  victim: EntityHandle;
  move: string;
  damage: number;
  ko: boolean;
}

export interface CombatPorts {
  ecs: EcsApi;
  tick(): number;
  /** The local player's input of this tick, or null (no input yet). */
  input(): InputFrame | null;
  /** One infraction for the player's hit: called as `report('assault', [x, y, z])`. */
  report?(kind: 'assault', at: [number, number, number]): void;
  /** A hit as a sim event, for the timeline and the page. */
  emit?(t: string, tick: number, attacker: EntityHandle, victim: EntityHandle, move: string, damage: number, ko: boolean): void;
}

interface Active {
  move: MoveDef;
  frame: number;
  hit: Set<number>;
}

export class CombatImpl implements CombatApi {
  private readonly active = new Map<number, Active>();
  private readonly moveSets = new Map<number, string>();
  private readonly listeners: ((e: HitEvent) => void)[] = [];

  constructor(private readonly p: CombatPorts) {}

  setMoveSet(h: EntityHandle, moveSetId: string): void {
    this.moveSets.set(h as number, moveSetId);
  }

  moveSetOf(h: EntityHandle): string {
    return this.moveSets.get(h as number) ?? BASIC_MOVE_SET;
  }

  /** Starts a move. False when the move is unknown, the character is gone or knocked out, or a move is still running. */
  startMove(h: EntityHandle, moveId: string): boolean {
    if (!isMoveId(moveId)) return false;
    const ecs = this.p.ecs;
    const id = ecs.resolve(h);
    if (id === null || !ecs.has(h, Transform)) return false;
    if (ecs.has(h, Health) && (ecs.store(Health).ko[id] as number) !== 0) return false;
    if (this.active.has(h as number)) return false;
    this.active.set(h as number, { move: MOVES[moveId], frame: 0, hit: new Set() });
    return true;
  }

  onHit(cb: (e: HitEvent) => void): () => void {
    this.listeners.push(cb);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** The move a character is in, for tests and the debug overlay. */
  current(h: EntityHandle): { move: MoveId; frame: number } | null {
    const a = this.active.get(h as number);
    return a ? { move: a.move.id, frame: a.frame } : null;
  }

  /** One tick: the player's button, the moves in progress, the wake-ups. */
  update(): void {
    const tick = this.p.tick();
    this.playerInput();
    for (const [key, a] of [...this.active]) {
      const h = key as EntityHandle;
      const ecs = this.p.ecs;
      const id = ecs.resolve(h);
      if (id === null || (ecs.has(h, Health) && (ecs.store(Health).ko[id] as number) !== 0)) {
        this.active.delete(key);
        continue;
      }
      const f = a.frame;
      if (f >= a.move.startup && f < a.move.startup + a.move.active) this.strike(h, a, tick);
      a.frame = f + 1;
      if (a.frame >= a.move.startup + a.move.active + a.move.recovery) this.active.delete(key);
    }
    this.wake(tick);
  }

  private pose(id: EntityId): { x: number; y: number; z: number; yaw: number } {
    const tr = this.p.ecs.store(Transform);
    return { x: tr.px[id] as number, y: tr.py[id] as number, z: tr.pz[id] as number, yaw: 2 * datan2(tr.qy[id] as number, tr.qw[id] as number) };
  }

  private playerInput(): void {
    const frame = this.p.input();
    if (!frame || (frame.pressed & ATTACK_BIT) === 0) return;
    const ecs = this.p.ecs;
    const ids = ecs.query([LocalPlayer, Transform, Control]);
    const pid = ids[0] as EntityId | undefined;
    if (pid === undefined) return;
    if ((ecs.store(Control).owner[pid] as number) === CONTROL_OWNER.Vehicle) return;
    const h = ecs.handle(pid);
    if (this.active.has(h as number)) return;
    this.assistAim(pid);
    let move: MoveId = 'jab';
    if ((frame.buttons & ABILITY_BIT) !== 0) move = 'shove';
    else if (this.nearestDamaged(pid) !== null) move = 'takedown';
    this.startMove(h, move);
  }

  /**
   * Aim assist: an attack turns the player toward the nearest standing character within `ASSIST_RANGE_M` that is in the half-plane
   * the player faces or beside it (the cone is 200 degrees), so a swing at someone close lands without pixel-perfect facing.
   */
  private assistAim(attacker: EntityId): void {
    const ecs = this.p.ecs;
    const me = this.pose(attacker);
    const fx = -dsin(me.yaw);
    const fz = -dcos(me.yaw);
    const hp = ecs.store(Health);
    const tr = ecs.store(Transform);
    let best: EntityId | null = null;
    let bestD = ASSIST_RANGE_M;
    for (const v0 of ecs.query([Health, Transform])) {
      const v = v0 as EntityId;
      if (v === attacker || (hp.ko[v] as number) !== 0) continue;
      const dx = (tr.px[v] as number) - me.x;
      const dz = (tr.pz[v] as number) - me.z;
      const d = dsqrt(dx * dx + dz * dz);
      if (d > bestD || d < 1e-6) continue;
      if ((dx * fx + dz * fz) / d < ASSIST_MIN_DOT) continue;
      best = v;
      bestD = d;
    }
    if (best === null) return;
    const yaw = datan2(-((tr.px[best] as number) - me.x), -((tr.pz[best] as number) - me.z));
    tr.qy[attacker] = dsin(yaw / 2);
    tr.qw[attacker] = dcos(yaw / 2);
  }

  /** The nearest standing character in front of `attacker` within takedown reach whose health is at or below `TAKEDOWN_BELOW`. */
  private nearestDamaged(attacker: EntityId): EntityId | null {
    const ecs = this.p.ecs;
    const me = this.pose(attacker);
    const fx = -dsin(me.yaw);
    const fz = -dcos(me.yaw);
    const hp = ecs.store(Health);
    const tr = ecs.store(Transform);
    let best: EntityId | null = null;
    let bestD = Infinity;
    for (const v0 of ecs.query([Health, Transform])) {
      const v = v0 as EntityId;
      if (v === attacker || (hp.ko[v] as number) !== 0) continue;
      if ((hp.hp[v] as number) > (hp.max[v] as number) * TAKEDOWN_BELOW) continue;
      const dx = (tr.px[v] as number) - me.x;
      const dz = (tr.pz[v] as number) - me.z;
      const d = dsqrt(dx * dx + dz * dz);
      if (d > 2.2 || d < 1e-6) continue;
      if ((dx * fx + dz * fz) / d < 0.2) continue;
      if (d < bestD) {
        best = v;
        bestD = d;
      }
    }
    return best;
  }

  private strike(attacker: EntityHandle, a: Active, tick: number): void {
    const ecs = this.p.ecs;
    const aid = ecs.resolve(attacker);
    if (aid === null) return;
    const me = this.pose(aid);
    const fx = -dsin(me.yaw);
    const fz = -dcos(me.yaw);
    const cx = me.x + fx * a.move.reachM;
    const cz = me.z + fz * a.move.reachM;
    const cy = me.y + HITBOX_Y_M;
    const hp = ecs.store(Health);
    const tr = ecs.store(Transform);
    const isPlayer = ecs.has(attacker, LocalPlayer);
    for (const v0 of ecs.query([Health, Transform])) {
      const v = v0 as EntityId;
      if (v === aid || a.hit.has(v) || (hp.ko[v] as number) !== 0) continue;
      const dx = (tr.px[v] as number) - cx;
      const dz = (tr.pz[v] as number) - cz;
      if (dsqrt(dx * dx + dz * dz) > a.move.radiusM + VICTIM_RADIUS_M) continue;
      const feet = tr.py[v] as number;
      if (cy < feet - a.move.radiusM || cy > feet + VICTIM_HEIGHT_M + a.move.radiusM) continue;
      const max = hp.max[v] as number;
      const damaged = (hp.hp[v] as number) < max;
      if (a.move.needsDamaged && !damaged) continue;
      a.hit.add(v);
      this.hurt(attacker, ecs.handle(v), v, a.move, fx, fz, tick, isPlayer);
    }
  }

  private hurt(attacker: EntityHandle, victim: EntityHandle, v: EntityId, move: MoveDef, fx: number, fz: number, tick: number, byPlayer: boolean): void {
    const ecs = this.p.ecs;
    const hp = ecs.store(Health);
    const tr = ecs.store(Transform);
    let next = (hp.hp[v] as number) - move.damage;
    let ko = move.id === 'takedown';
    if (next <= 0) {
      next = 1;
      ko = true;
    }
    hp.hp[v] = next;
    if (ko) {
      hp.ko[v] = 1;
      hp.koUntilTick[v] = tick + KO_TICKS;
    }
    if (move.pushM > 0) {
      tr.px[v] = (tr.px[v] as number) + fx * move.pushM;
      tr.pz[v] = (tr.pz[v] as number) + fz * move.pushM;
    }
    if (byPlayer && !ecs.has(victim, LocalPlayer)) {
      this.p.report?.('assault', [tr.px[v] as number, tr.py[v] as number, tr.pz[v] as number]);
    }
    this.p.emit?.('combat.hit', tick, attacker, victim, move.id, move.damage, ko);
    const e: HitEvent = { attacker, victim, move: move.id, damage: move.damage, ko };
    for (const cb of [...this.listeners]) cb(e);
  }

  private wake(tick: number): void {
    const ecs = this.p.ecs;
    const hp = ecs.store(Health);
    for (const v0 of ecs.query([Health])) {
      const v = v0 as EntityId;
      if ((hp.ko[v] as number) === 0) continue;
      if (tick < (hp.koUntilTick[v] as number)) continue;
      hp.ko[v] = 0;
      hp.koUntilTick[v] = 0;
      const max = hp.max[v] as number;
      if ((hp.hp[v] as number) < max * WAKE_FRACTION) hp.hp[v] = max * WAKE_FRACTION;
    }
  }
}

export { MOVES, BASIC_MOVE_SET, type MoveDef, type MoveId } from './moves.ts';
