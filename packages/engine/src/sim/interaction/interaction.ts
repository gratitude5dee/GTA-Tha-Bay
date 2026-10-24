/**
 * Interaction system v1 (owner S01; 01-engine-save-modes.md "Interaction system"; M03a1).
 *
 * Each tick in `Rules`, the candidates are the `Interactable` entities within their radius (default 2.5 m) and cone (default
 * 100 degrees, a total angle: half of it on each side of the player's heading) of the on-foot player. The score is
 * `priority * 10 - distance - angle / 45`; ties go to the lower handle. The best candidate is published as the prompt. The
 * press of `sim.Enter` (for vehicles) or `sim.Interact` (everything else) begins it; a `hold` prompt needs the button held for
 * 30 ticks (0.5 s). `setEnabled(kind, false)` removes a kind from the candidates.
 *
 * Builder additions to the spec'd shapes (BD-M03a1-04): `InteractionPrompt.reason` carries the localisation key of an
 * unavailable reason, and handlers receive an `InteractionContext` instead of `ModeContext` (C06's `ModeContext` lands with M04a2).
 *
 * Sim code under the C02 lint.
 */
import {
  datan2, dsqrt, PI, SimButton, SimStage, type EcsApi, type EntityHandle, type EntityId, type Fnv64, type SystemDef,
} from '@dv/shared';
import {
  Control, Interactable, LocalPlayer, PlayerControlled, Transform, Vehicle,
} from '../ecs/components.ts';
import type { EcsWorld } from '../ecs/world.ts';
import { CONTROL_OWNER, CONTROL_PHASE, phaseOf } from '../control/states.ts';
import type { ByteReader, ByteWriter } from '../bytes.ts';
import type { EngineServices, SimResource } from '../services.ts';
import { INTERACT_KIND, type InteractKind } from './kinds.ts';

export const INTERACTION_ID = 'engine.rules.interaction';
export const INTERACTION_RESOURCE = 'interaction';
export const DEFAULT_RADIUS_M = 2.5;
export const DEFAULT_CONE_DEG = 100;
/** A hold prompt completes after this many ticks held: 0.5 s. */
export const HOLD_TICKS = 30;

export interface InteractionPrompt {
  target: EntityHandle;
  kind: InteractKind;
  promptKey: string;
  hold: boolean;
  /** 0..1 while a hold is in progress. */
  progress: number;
  /** Localisation key of why the interaction is unavailable right now; absent when it can begin. */
  reason?: string;
}

export interface InteractionContext {
  ecs: EcsApi;
  services: EngineServices;
  tick: number;
}

export interface InteractionHandler {
  kind: InteractKind;
  canInteract(ctx: InteractionContext, actor: EntityHandle, target: EntityHandle): true | string;
  begin(ctx: InteractionContext, actor: EntityHandle, target: EntityHandle): void;
}

export interface InteractionApi {
  register(h: InteractionHandler): void;
  current(player?: number): InteractionPrompt | null;
  setEnabled(kind: InteractKind, on: boolean): void;
}

const RAD_TO_DEG = 180 / PI;

/** Candidate anchors of an interactable: a vehicle's two door points, otherwise its position. */
function anchorsOf(ecs: EcsWorld, id: number, out: number[]): number {
  const tr = ecs.store(Transform);
  const x = tr.px[id] as number;
  const y = tr.py[id] as number;
  const z = tr.pz[id] as number;
  if (!ecs.hasId(id, Vehicle)) {
    out[0] = x; out[1] = y; out[2] = z;
    return 1;
  }
  // door points at the side of the body: right axis from the quaternion, half track + 0.5 m
  const qx = tr.qx[id] as number;
  const qy = tr.qy[id] as number;
  const qz = tr.qz[id] as number;
  const qw = tr.qw[id] as number;
  const rx = 1 - 2 * (qy * qy + qz * qz);
  const rz = 2 * (qx * qz - qw * qy);
  const side = 1.45;
  out[0] = x - rx * side; out[1] = y; out[2] = z - rz * side;
  out[3] = x + rx * side; out[4] = y; out[5] = z + rz * side;
  return 2;
}

export class InteractionService implements InteractionApi {
  private readonly handlers = new Map<number, InteractionHandler>();
  private readonly disabled = new Set<number>();
  private prompt: InteractionPrompt | null = null;
  private held = 0;
  private heldTarget = 0;
  private readonly anchors: number[] = [0, 0, 0, 0, 0, 0];

  constructor(private readonly ecs: EcsWorld, private readonly services: EngineServices) {}

  register(h: InteractionHandler): void {
    this.handlers.set(h.kind, h);
  }

  current(player = 0): InteractionPrompt | null {
    return player === 0 ? this.prompt : null;
  }

  setEnabled(kind: InteractKind, on: boolean): void {
    if (on) this.disabled.delete(kind);
    else this.disabled.add(kind);
  }

  isEnabled(kind: InteractKind): boolean {
    return !this.disabled.has(kind);
  }

  /** The button that begins an interaction of `kind`. */
  static buttonFor(kind: number): number {
    return kind === INTERACT_KIND.EnterVehicle ? 1 << SimButton.Enter : 1 << SimButton.Interact;
  }

  /** The Rules-stage system. */
  system(): SystemDef {
    return {
      id: INTERACTION_ID, owner: 'S01', stage: SimStage.Rules, order: 0,
      run: ({ tick }) => this.update(tick),
    };
  }

  private update(tick: number): void {
    const ecs = this.ecs;
    const players = ecs.query([LocalPlayer, Transform, Control, PlayerControlled]);
    const ids = ecs.query([Interactable, Transform]);
    const ia = ecs.store(Interactable);
    // cooldowns tick down whether or not a player is around
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as number;
      const c = ia.cooldown[id] as number;
      if (c > 0) ia.cooldown[id] = c - 1;
    }
    if (players.length === 0) {
      this.prompt = null;
      this.held = 0;
      return;
    }
    const pid = players[0] as number;
    const co = ecs.store(Control);
    if (co.owner[pid] !== CONTROL_OWNER.OnFoot || phaseOf(co.pending[pid] as number) !== CONTROL_PHASE.Ready) {
      this.prompt = null;
      this.held = 0;
      return;
    }
    const tr = ecs.store(Transform);
    const px = tr.px[pid] as number;
    const py = tr.py[pid] as number;
    const pz = tr.pz[pid] as number;
    const qx = tr.qx[pid] as number;
    const qy = tr.qy[pid] as number;
    const qz = tr.qz[pid] as number;
    const qw = tr.qw[pid] as number;
    const fx = -2 * (qx * qz + qw * qy);
    const fz = -(1 - 2 * (qx * qx + qy * qy));
    const flen = dsqrt(fx * fx + fz * fz) || 1;

    let best = -1;
    let bestScore = -Infinity;
    let bestHandle = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as number;
      const kind = ia.kind[id] as number;
      if (this.disabled.has(kind) || !this.handlers.has(kind) || (ia.cooldown[id] as number) > 0) continue;
      const radius = (ia.radius[id] as number) > 0 ? (ia.radius[id] as number) : DEFAULT_RADIUS_M;
      const cone = (ia.coneDeg[id] as number) > 0 ? (ia.coneDeg[id] as number) : DEFAULT_CONE_DEG;
      const n = anchorsOf(ecs, id, this.anchors);
      let dist = Infinity;
      let angle = 0;
      for (let a = 0; a < n; a++) {
        const dx = (this.anchors[a * 3] as number) - px;
        const dy = (this.anchors[a * 3 + 1] as number) - py;
        const dz = (this.anchors[a * 3 + 2] as number) - pz;
        const horiz = dsqrt(dx * dx + dz * dz);
        const dyAbs = dy < 0 ? -dy : dy;
        const d = horiz + (dyAbs > 1.5 ? dyAbs - 1.5 : 0);
        if (d >= dist) continue;
        dist = d;
        if (horiz < 0.05) angle = 0;
        else {
          const dot = (fx * dx + fz * dz) / flen;
          const cross = (fx * dz - fz * dx) / flen;
          angle = datan2(cross < 0 ? -cross : cross, dot) * RAD_TO_DEG;
        }
      }
      if (dist > radius) continue;
      if (cone < 360 && angle > cone / 2) continue;
      const score = (ia.priority[id] as number) * 10 - dist - angle / 45;
      const handle = ecs.handle(id as EntityId);
      if (score > bestScore || (score === bestScore && handle < bestHandle)) {
        best = id;
        bestScore = score;
        bestHandle = handle;
      }
    }

    if (best < 0) {
      this.prompt = null;
      this.held = 0;
      this.heldTarget = 0;
      return;
    }

    const kind = ia.kind[best] as number;
    const handler = this.handlers.get(kind) as InteractionHandler;
    const target = ecs.handle(best as EntityId);
    const actor = ecs.handle(pid as EntityId);
    const ctx: InteractionContext = { ecs, services: this.services, tick };
    const can = handler.canInteract(ctx, actor, target);
    const hold = ((ia.flags[best] as number) & 1) !== 0;
    if (this.heldTarget !== target) {
      this.heldTarget = target;
      this.held = 0;
    }
    const frame = this.services.input;
    const bit = InteractionService.buttonFor(kind);
    let begin = false;
    if (can === true && frame) {
      if (hold) {
        if ((frame.buttons & bit) !== 0) {
          this.held++;
          if (this.held >= HOLD_TICKS) {
            begin = true;
            this.held = 0;
          }
        } else this.held = 0;
      } else if ((frame.pressed & bit) !== 0) begin = true;
    } else this.held = 0;

    const prompt: InteractionPrompt = {
      target,
      kind: kind as InteractKind,
      promptKey: ecs.strings.get(ia.prompt[best] as number),
      hold,
      progress: hold ? Math.min(1, this.held / HOLD_TICKS) : 0,
    };
    if (can !== true) prompt.reason = can;
    this.prompt = prompt;
    if (begin) handler.begin(ctx, actor, target);
    else if (typeof can === 'string' && frame && (frame.pressed & bit) !== 0) {
      // the reason is shown as text next to the prompt, and reported once when the button is pressed
      this.services.events.push({ t: 'control.refused', tick, a: actor, b: target, s: can });
    }
  }

  /** The hashed, checkpointed part: hold progress, its target and the disabled kinds. */
  resource(): SimResource {
    return {
      name: INTERACTION_RESOURCE,
      hash: (h: Fnv64) => {
        h.u32(this.held).u32(this.heldTarget);
        for (const k of [...this.disabled].sort((a, b) => a - b)) h.u32(k);
      },
      save: (w: ByteWriter) => {
        w.u32(this.held);
        w.u32(this.heldTarget);
        const list = [...this.disabled].sort((a, b) => a - b);
        w.u32(list.length);
        for (const k of list) w.u16(k);
      },
      load: (r: ByteReader) => {
        this.held = r.u32();
        this.heldTarget = r.u32();
        this.disabled.clear();
        for (let n = r.u32(); n > 0; n--) this.disabled.add(r.u16());
        this.prompt = null;
      },
    };
  }

  /** Side-block entry for the snapshot: the prompt as plain JSON, or null. */
  side(): { target: number; kind: number; key: string; hold: boolean; progress: number; reason?: string } | null {
    const p = this.prompt;
    if (!p) return null;
    const out: { target: number; kind: number; key: string; hold: boolean; progress: number; reason?: string } = {
      target: p.target, kind: p.kind, key: p.promptKey, hold: p.hold, progress: p.progress,
    };
    if (p.reason !== undefined) out.reason = p.reason;
    return out;
  }
}
