import type { SimResource } from '../services.ts';
import type { ByteReader, ByteWriter } from '../bytes.ts';
import type { PhysicsSystemsBackend, Vec3 } from '../physics/backend.ts';
import { GROUP_BIT } from '../physics/groups.ts';

/**
 * The vault (M01b2, spec/domains/01-engine.md section 2.5, control state 120 / anim state 7). Jump pressed while running
 * into an obstacle at most 1.2 m tall starts a scripted move of 24 ticks that ends beyond the obstacle; a taller one blocks.
 * The obstacle is found with forward `castSphere` probes (a low probe for the obstacle, a head probe that rejects anything
 * the player could not get over), then downward rays read its top and its far edge. Everything here is + - x / and
 * comparisons on collision query results, so it replays identically.
 */
export const VAULT_TICKS = 24;
export const VAULT_MAX_HEIGHT_M = 1.2;
/** Obstacles this low or lower are stepped over by the character controller (autostep 0.4 m); no vault. */
export const VAULT_MIN_HEIGHT_M = 0.45;
/** How far ahead the low probe looks for the obstacle, metres from the capsule axis. */
export const VAULT_REACH_M = 0.9;
/** The deepest obstacle that can be vaulted, metres. */
export const VAULT_MAX_DEPTH_M = 2.4;
/** Clearance kept above the top of the obstacle at the middle of the move, metres. */
const CLEARANCE_M = 0.45;
/** Distance past the far edge where the player lands, metres. */
const LANDING_MARGIN_M = 0.4;
const PROBE_RADIUS_M = 0.2;
const DEPTH_STEP_M = 0.2;
const RAY_TOP_ABOVE_FEET_M = 1.9;

/** The scripted path of one vault in progress. */
export interface VaultPlan {
  startTick: number;
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  /** Extra height of the arc over the straight line, metres (reached halfway). */
  lift: number;
}

export interface VaultProbeInput {
  backend: Pick<PhysicsSystemsBackend, 'castRay' | 'castSphere'>;
  /** Feet, ENU metres. */
  x: number; y: number; z: number;
  /** Unit heading on the ground plane. */
  dirX: number; dirZ: number;
}

/**
 * Finds the vault for a player running along (dirX, dirZ) from the feet (x, y, z), or null when there is nothing to vault:
 * no obstacle in reach, an obstacle low enough to step over, one taller than 1.2 m, or one deeper than 2.4 m.
 */
export function probeVault(p: VaultProbeInput, tick: number): VaultPlan | null {
  const { backend, x, y, z, dirX, dirZ } = p;
  const mask = GROUP_BIT.static;
  const fwd: Vec3 = [dirX, 0, dirZ];
  const from: Vec3 = [x, y + 0.7, z];
  const low = backend.castSphere(from, fwd, PROBE_RADIUS_M, VAULT_REACH_M, mask);
  if (!low) return null;

  // Anything the head probe touches within reach is taller than the player can get over.
  const head: Vec3 = [x, y + VAULT_MAX_HEIGHT_M + PROBE_RADIUS_M + 0.05, z];
  if (backend.castSphere(head, fwd, PROBE_RADIUS_M, low.toi + 0.6, mask)) return null;

  const down: Vec3 = [0, -1, 0];
  const topAt = (d: number): number | null => {
    const o: Vec3 = [x + dirX * d, y + RAY_TOP_ABOVE_FEET_M, z + dirZ * d];
    const hit = backend.castRay(o, down, RAY_TOP_ABOVE_FEET_M + 2, mask);
    return hit ? o[1] - hit.toi : null;
  };

  // Top of the obstacle just past the point the low probe touched.
  const reach = Math.min(VAULT_REACH_M, low.toi + PROBE_RADIUS_M + 0.15);
  const top = topAt(reach);
  if (top === null) return null;
  const height = top - y;
  if (height > VAULT_MAX_HEIGHT_M || height < VAULT_MIN_HEIGHT_M) return null;

  // Walk forward until the surface drops back to the ground: that is the far edge.
  let d = reach;
  let farGround: number | null = null;
  while (d <= VAULT_MAX_DEPTH_M + reach) {
    d += DEPTH_STEP_M;
    const t = topAt(d);
    if (t === null || t - y < VAULT_MIN_HEIGHT_M) {
      farGround = t ?? y;
      break;
    }
  }
  if (farGround === null) return null;
  const land = d + LANDING_MARGIN_M;
  return {
    startTick: tick,
    x0: x, y0: y, z0: z,
    x1: x + dirX * land, y1: farGround, z1: z + dirZ * land,
    lift: height + CLEARANCE_M,
  };
}

/** Position on the plan after `k` of `VAULT_TICKS` ticks (0 < k <= VAULT_TICKS): a straight line plus a parabolic lift. */
export function vaultPoint(plan: VaultPlan, k: number, out: Vec3): Vec3 {
  const s = k / VAULT_TICKS;
  out[0] = plan.x0 + (plan.x1 - plan.x0) * s;
  out[2] = plan.z0 + (plan.z1 - plan.z0) * s;
  out[1] = plan.y0 + (plan.y1 - plan.y0) * s + 4 * s * (1 - s) * plan.lift;
  return out;
}

/** Vaults in progress, by dense entity id. Created by `registerControlSystems`. */
export class VaultStore {
  readonly plans = new Map<number, VaultPlan>();
}

/**
 * The vaults as a hashed, checkpointed resource. An idle store writes nothing into the hash, so worlds that never vault
 * (every earlier scenario) keep the hashes they had.
 */
export function vaultResource(store: VaultStore): SimResource {
  const sorted = (): [number, VaultPlan][] => [...store.plans].sort((a, b) => a[0] - b[0]);
  return {
    name: 'vault',
    hash(h) {
      for (const [id, p] of sorted()) {
        h.u32(id).u32(p.startTick).f64(p.x0).f64(p.y0).f64(p.z0).f64(p.x1).f64(p.y1).f64(p.z1).f64(p.lift);
      }
    },
    save(w: ByteWriter) {
      const list = sorted();
      w.u32(list.length);
      for (const [id, p] of list) {
        w.u32(id);
        w.u32(p.startTick);
        for (const v of [p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, p.lift]) w.f64(v);
      }
    },
    load(r: ByteReader) {
      store.plans.clear();
      for (let n = r.u32(); n > 0; n--) {
        const id = r.u32();
        const startTick = r.u32();
        const [x0, y0, z0, x1, y1, z1, lift] = [r.f64(), r.f64(), r.f64(), r.f64(), r.f64(), r.f64(), r.f64()] as [number, number, number, number, number, number, number];
        store.plans.set(id, { startTick, x0, y0, z0, x1, y1, z1, lift });
      }
    },
  };
}
