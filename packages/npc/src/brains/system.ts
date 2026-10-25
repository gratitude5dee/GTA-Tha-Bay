/**
 * The ECS side of the named NPCs (M06c): one entity `npc:<id>` per roster soul with the components 768 to 775, mirrored from `BrainSim`
 * once per tick, and the scan of the filler pedestrians next to the player (the Talk prompt and the bark triggers). Sim code; C02 lint applies.
 *
 * A named NPC is drawn by the pedestrian renderer: the entity carries `Ambient` (so the publisher flags it instanced) and one of the eight
 * gray-box bodies, with an outfit that no ambient pedestrian is likely to share. It is hidden at LOD C and when the kill-switch removed it.
 */
import { dcos, dsin, dsqrt, fnv32, NULL_HANDLE, type EntityHandle, type EntityId, type StableKey } from '@dv/shared';
import type { BarkTag } from '@dv/shared/contracts/c10-npc';
import {
  Ambient, Anim, Interactable, INTERACT_KIND, LocalPlayer, RenderKey, Transform, type EcsWorld,
} from '@dv/engine/sim';
import { LOD, UTILITY, type NpcAgent } from './agent.ts';
import { BarkEmitter, IntentGoal, NpcBrain, NpcIdentity, NpcLod, ScheduleCursor, Talkable, TALK_FLAG, UtilityScores } from './components.ts';
import type { BrainSim } from './sim.ts';

/** Ambient slots of pedestrians (the pedestrian layer allots 256 to 511). */
export const PED_SLOT_MIN = 256;
export const PED_SLOT_MAX = 512;
/** Ped anim states: the ragdoll of a hit, the run of a dodge or a flight, the emote of a filming or cheering crowd. */
const ANIM_RAGDOLL = 12;
const ANIM_RUN = 2;
const ANIM_EMOTE = 21;

const BODY_ASSET = (n: number): string => `character/ped.ambient.${String.fromCharCode(97 + (n % 8))}`;
/** Outfits (palette indices) named NPCs wear: warm, saturated ones. */
const NPC_OUTFITS = [3, 11, 0, 8, 9, 17] as const;

export const NPC_PREFAB = 'npc.named';
/** QA only: a pedestrian that only stands where it was put, so a spec can talk to one (`mode.cmd npc qa.filler`). */
export const QA_FILLER_PREFAB = 'npc.qa.filler';

export const H = (n: number): EntityHandle => n as EntityHandle;

export interface PedBark {
  tag: BarkTag;
  key: string;
  x: number;
  z: number;
}

export interface FillerScanOptions {
  /** Distance within which a pedestrian becomes talkable. */
  talkM: number;
  /** Pedestrians this near the player are watched for barks. */
  watchM: number;
}

/** Mirrors `BrainSim` into entities and watches the ambient pedestrians. */
export class NpcEntities {
  private readonly handles: number[] = [];
  private readonly lastAnim = new Map<number, number>();
  private strings: EcsWorld['strings'];
  /** Talk prompts given to pedestrians so far (QA panel). */
  grants = 0;

  constructor(private readonly ecs: EcsWorld) {
    this.strings = ecs.strings;
  }

  definePrefab(): void {
    this.ecs.definePrefab({
      id: NPC_PREFAB,
      components: [
        { def: Transform, init: { qw: 1 } },
        { def: RenderKey, init: { asset: 0, visible: 0 } },
        { def: Anim },
        { def: Ambient },
        { def: Interactable },
        { def: NpcIdentity },
        { def: ScheduleCursor },
        { def: NpcBrain },
        { def: UtilityScores },
        { def: Talkable },
        { def: BarkEmitter },
        { def: IntentGoal },
        { def: NpcLod },
      ],
    });
    this.ecs.definePrefab({
      id: QA_FILLER_PREFAB,
      components: [
        { def: Transform, init: { qw: 1 } },
        { def: RenderKey, init: { asset: this.strings.intern(BODY_ASSET(0)), visible: 1 } },
        { def: Anim },
        { def: Ambient },
      ],
    });
  }

  /** Stands a QA filler `ahead` metres in front of the player. Returns its key, or null without a player. */
  spawnQaFiller(slot: number, ahead: number): { key: StableKey; handle: number } | null {
    const ecs = this.ecs;
    const ids = ecs.query([LocalPlayer, Transform]);
    const pid = ids[0];
    if (pid === undefined) return null;
    const tr = ecs.store(Transform);
    const qx = tr.qx[pid] as number;
    const qy = tr.qy[pid] as number;
    const qz = tr.qz[pid] as number;
    const qw = tr.qw[pid] as number;
    const fx = -2 * (qx * qz + qw * qy);
    const fz = -(1 - 2 * (qx * qx + qy * qy));
    const len = dsqrt(fx * fx + fz * fz) || 1;
    const x = (tr.px[pid] as number) + (fx / len) * ahead;
    const z = (tr.pz[pid] as number) + (fz / len) * ahead;
    const key = `amb:npc-qa:${slot}` as StableKey;
    const handle = ecs.commands.spawn(
      QA_FILLER_PREFAB,
      {
        'Transform.px': x, 'Transform.py': tr.py[pid] as number, 'Transform.pz': z,
        'Ambient.cell': this.strings.intern('npc-qa'), 'Ambient.slot': slot,
      },
      key,
    ) as unknown as number;
    return { key, handle };
  }

  /** QA: sets the anim state of an entity (the ragdoll of a knocked-down pedestrian is 12). */
  setAnim(handle: number, state: number): void {
    const id = this.ecs.resolve(H(handle));
    if (id === null || !this.ecs.hasId(id, Anim)) return;
    this.ecs.store(Anim).state[id] = state;
  }

  /** The entity of an agent, 0 before it is spawned. */
  handleOf(a: NpcAgent): number {
    return this.handles[a.slot] ?? 0;
  }

  /** Spawns the entities of agents that have none (a hit of `byKey` after a restore adopts the restored one). */
  ensure(sim: BrainSim): void {
    const ecs = this.ecs;
    for (const a of sim.agents) {
      if ((this.handles[a.slot] ?? 0) !== 0) continue;
      const existing = ecs.byKey(a.key as StableKey);
      if (existing !== NULL_HANDLE) {
        this.handles[a.slot] = existing as unknown as number;
        continue;
      }
      const body = fnv32(a.id) % 8;
      this.handles[a.slot] = ecs.commands.spawn(
        NPC_PREFAB,
        {
          'Transform.px': a.x, 'Transform.py': a.y, 'Transform.pz': a.z,
          'RenderKey.asset': this.strings.intern(BODY_ASSET(body)), 'RenderKey.visible': 0,
          'Anim.p1': NPC_OUTFITS[a.slot % NPC_OUTFITS.length] as number,
          'Ambient.cell': this.strings.intern('npc'), 'Ambient.slot': a.slot,
          'Interactable.kind': INTERACT_KIND.Talk, 'Interactable.radius': 2.5, 'Interactable.coneDeg': 140, 'Interactable.priority': 1,
          'Interactable.prompt': this.strings.intern('interact.talk'),
          'NpcIdentity.npc': this.strings.intern(a.id), 'NpcIdentity.soulVersion': a.soul.soulVersion, 'NpcIdentity.slot': a.slot,
        },
        a.key as StableKey,
      ) as unknown as number;
    }
  }

  /** Copies the brains into the components. */
  sync(sim: BrainSim, playerDist: (a: NpcAgent) => number): void {
    const ecs = this.ecs;
    const tr = ecs.store(Transform);
    const an = ecs.store(Anim);
    const rk = ecs.store(RenderKey);
    const ia = ecs.store(Interactable);
    const sc = ecs.store(ScheduleCursor);
    const br = ecs.store(NpcBrain);
    const us = ecs.store(UtilityScores);
    const tk = ecs.store(Talkable);
    const ig = ecs.store(IntentGoal);
    const lo = ecs.store(NpcLod);
    for (const a of sim.agents) {
      const h = this.handles[a.slot] ?? 0;
      if (h === 0) continue;
      const id = ecs.resolve(H(h));
      if (id === null || !ecs.hasId(id, Transform)) continue;
      const shown = a.enabled && a.lod !== LOD.C && a.placed;
      rk.visible[id] = shown ? 1 : 0;
      ia.cooldown[id] = 0;
      lo.tier[id] = a.lod;
      lo.dist[id] = playerDist(a);
      tk.flags[id] = (a.talking ? TALK_FLAG.talking : 0) | (a.locks > 0 ? TALK_FLAG.locked : 0) | (a.enabled ? TALK_FLAG.enabled : 0);
      tk.locks[id] = a.locks > 255 ? 255 : a.locks;
      sc.block[id] = a.block;
      sc.day[id] = a.gameDay;
      if (!shown) continue;
      tr.px[id] = a.x;
      tr.py[id] = a.y;
      tr.pz[id] = a.z;
      tr.qx[id] = 0;
      tr.qy[id] = dsin(a.yaw / 2);
      tr.qz[id] = 0;
      tr.qw[id] = dcos(a.yaw / 2);
      an.state[id] = a.anim;
      an.p0[id] = dsqrt(a.vx * a.vx + a.vz * a.vz);
      br.tree[id] = a.tree;
      br.leaf[id] = a.leafId;
      br.s0[id] = a.stack[0] as number;
      br.s1[id] = a.stack[1] as number;
      br.s2[id] = a.stack[2] as number;
      br.s3[id] = a.stack[3] as number;
      br.t[id] = a.leafT;
      br.aux[id] = a.leafAux;
      us.winner[id] = a.winner;
      us.s0[id] = a.scores[UTILITY.Talk] as number;
      us.s1[id] = a.scores[UTILITY.Hold] as number;
      us.s2[id] = a.scores[UTILITY.Flee] as number;
      us.s3[id] = a.scores[UTILITY.Intent] as number;
      us.s4[id] = a.scores[UTILITY.Greet] as number;
      us.s5[id] = a.scores[UTILITY.Schedule] as number;
      const it = a.intent;
      ig.goal[id] = it ? this.strings.intern(it.goal) : 0;
      ig.target[id] = it && it.target ? this.strings.intern(it.target) : 0;
      ig.urgency[id] = it ? it.urgency : 0;
      ig.until[id] = it ? it.until : 0;
      ig.block[id] = it ? it.block : -1;
    }
  }

  /** Records the tick and tag of a bark on the entity. */
  markBark(slot: number, tick: number, tagIndex: number): void {
    const h = this.handles[slot] ?? 0;
    if (h === 0) return;
    const id = this.ecs.resolve(H(h));
    if (id === null || !this.ecs.hasId(id, BarkEmitter)) return;
    const be = this.ecs.store(BarkEmitter);
    be.lastTick[id] = tick;
    be.lastTag[id] = tagIndex;
  }

  /** The local player's position, or null. */
  player(): { x: number; y: number; z: number } | null {
    const ids = this.ecs.query([LocalPlayer, Transform]);
    const id = ids[0];
    if (id === undefined) return null;
    const tr = this.ecs.store(Transform);
    return { x: tr.px[id] as number, y: tr.py[id] as number, z: tr.pz[id] as number };
  }

  /**
   * Watches the ambient pedestrians near the player: the ones within `talkM` get a Talk prompt (an `Interactable`, priority -1 so anything
   * else wins), the ones that left lose it, and a pedestrian that was knocked down, dodged, fled or started to film gets a bark request.
   * Returns the requests.
   */
  scanFillers(player: { x: number; z: number }, o: FillerScanOptions, out: PedBark[]): void {
    const ecs = this.ecs;
    const ids = ecs.query([Ambient, Transform, Anim]);
    const am = ecs.store(Ambient);
    const tr = ecs.store(Transform);
    const an = ecs.store(Anim);
    const talk2 = o.talkM * o.talkM;
    const watch2 = o.watchM * o.watchM;
    const seen = new Set<number>();
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as number;
      const slot = am.slot[id] as number;
      if (slot < PED_SLOT_MIN || slot >= PED_SLOT_MAX) continue;
      const dx = (tr.px[id] as number) - player.x;
      const dz = (tr.pz[id] as number) - player.z;
      const d2 = dx * dx + dz * dz;
      const h = ecs.handle(id as EntityId) as unknown as number;
      const has = ecs.hasId(id, Interactable);
      if (d2 <= talk2) {
        if (!has) {
          this.grants++;
          ecs.commands.add(H(h), Interactable, {
            kind: INTERACT_KIND.Talk, radius: 2.5, coneDeg: 140, priority: -1, prompt: this.strings.intern('interact.talk'),
          });
        }
      } else if (has && d2 > talk2 * 1.8 && (ecs.store(Interactable).kind[id] as number) === INTERACT_KIND.Talk) {
        ecs.commands.remove(H(h), Interactable);
      }
      if (d2 > watch2) continue;
      seen.add(h);
      const now = an.state[id] as number;
      const prev = this.lastAnim.get(h);
      this.lastAnim.set(h, now);
      if (prev === undefined || prev === now) continue;
      const key = ecs.keyOf(H(h)) ?? `amb:ped:${slot}`;
      const x = tr.px[id] as number;
      const z = tr.pz[id] as number;
      if (now === ANIM_RAGDOLL) out.push({ tag: 'bump', key, x, z });
      else if (now === ANIM_RUN) out.push({ tag: 'flee', key, x, z });
      else if (now === ANIM_EMOTE) out.push({ tag: 'sideshow', key, x, z });
    }
    if (this.lastAnim.size > seen.size + 64) {
      for (const k of [...this.lastAnim.keys()]) if (!seen.has(k)) this.lastAnim.delete(k);
    }
  }

  /** QA: the anim state the bark watcher last saw for `handle` (-1 before its first pass), so a spec bumps only an entity the watcher has seen standing. */
  seenAnim(handle: number): number {
    return this.lastAnim.get(handle) ?? -1;
  }

  /** Whether the pedestrian under `target` is too busy to talk: knocked down or running. */
  fillerBusy(target: EntityHandle): boolean {
    const id = this.ecs.resolve(target);
    if (id === null || !this.ecs.hasId(id, Anim)) return true;
    const s = this.ecs.store(Anim).state[id] as number;
    return s === ANIM_RAGDOLL || s === ANIM_RUN;
  }

  /** The nearest pedestrian to the player within `maxM`, or null: the speaker of a bark the player's actions cause. */
  nearestPed(player: { x: number; z: number }, maxM: number): PedBark | null {
    const ecs = this.ecs;
    const ids = ecs.query([Ambient, Transform]);
    const am = ecs.store(Ambient);
    const tr = ecs.store(Transform);
    let best = -1;
    let bestD = maxM * maxM;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as number;
      const slot = am.slot[id] as number;
      if (slot < PED_SLOT_MIN || slot >= PED_SLOT_MAX) continue;
      const dx = (tr.px[id] as number) - player.x;
      const dz = (tr.pz[id] as number) - player.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD || (d2 === bestD && best >= 0 && id < best)) {
        best = id;
        bestD = d2;
      }
    }
    if (best < 0) return null;
    const h = ecs.handle(best as EntityId);
    return { tag: 'idle', key: ecs.keyOf(h) ?? `amb:ped:${am.slot[best] as number}`, x: tr.px[best] as number, z: tr.pz[best] as number };
  }
}
