/**
 * The sandbox's teleport path (M04e2). Every jump of the sandbox (a landmark, the map pin, "back", a remembered spot, the phone map)
 * goes through `sandboxGo`, so the heat refusal, the pre-stream wait, the fade and the ground placement of `TeleportService` apply.
 * Pure sim code in the C02 lint scope: no `Date`, no timers, no `**`. The previous pose is session state: it is cleared on enter
 * and exit and is never saved.
 */
import type { JsonObject, JsonValue, ModeContext, SandboxSlice, SimEvent, TeleportTarget } from '@dv/shared';
import { SAVE_LIMITS } from '@dv/shared';

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** What the teleport actions need of the engine: the player pose and the map pin. */
export interface TeleportEnv {
  playerPose?(): Pose | null;
  waypoint?(): { x: number; z: number } | null;
}

/** The map pin the player dropped. C08 `MapApi` has no getter, so the engine keeps the value itself. */
export interface WaypointMemo {
  set(x: number, z: number): void;
  clear(): void;
  get(): { x: number; z: number } | null;
}

export function createWaypointMemo(): WaypointMemo {
  let w: { x: number; z: number } | null = null;
  return {
    set(x, z) {
      w = { x, z };
    },
    clear() {
      w = null;
    },
    get: () => w,
  };
}

/** The view-model key of the Teleport tab. */
export const TELEPORT_VM = 'mode.sandbox.teleport';
/** The sandbox toast keys of this milestone. */
export const TELEPORT_WAIT = 'sandbox.teleport.wait';
export const NO_WAYPOINT = 'sandbox.teleport.noWaypoint';
export const NO_PREVIOUS = 'sandbox.teleport.noPrevious';
export const POSITION_FULL = 'sandbox.position.full';
export const POSITION_SAVED = 'sandbox.position.saved';
export const POSITION_FORGOT = 'sandbox.position.forgot';
export const POSITION_MISSING = 'sandbox.position.missing';
export const POSITION_NO_PLAYER = 'sandbox.position.noPlayer';
const UNKNOWN_TARGET = 'world.teleport.unknownTarget';

export const TELEPORT_ACTIONS = ['teleport.landmark', 'teleport.waypoint', 'teleport.back', 'position.save', 'position.delete'] as const;

const LANDMARK_ID = /^lm\.[a-z0-9-]{1,64}$/;
const SPOT_NAME = /^pos-(\d{1,2})$/;

interface Session {
  previous: Pose | null;
}
/** One entry per entered sandbox context; absent after exit. */
const sessions = new WeakMap<ModeContext, Session>();

type ToastCtx = Pick<ModeContext, 'ui'>;

function toast(ctx: ToastCtx, id: string, kind: 'info' | 'warning', text: string, params?: Record<string, string | number>): void {
  ctx.ui.toast({ id, kind, text, ...(params ? { params } : {}) });
}

/** Opens the session state (sandbox `enter`) and publishes the view model. */
export function enterTeleport(ctx: ModeContext, s: SandboxSlice): void {
  sessions.set(ctx, { previous: null });
  publishTeleport(ctx, s);
}

/** Drops the session state (sandbox `exit`). */
export function exitTeleport(ctx: ModeContext): void {
  sessions.delete(ctx);
}

/** `mode.sandbox.teleport`: the remembered spots (whole metres) and whether "back" has somewhere to go. */
export function publishTeleport(ctx: ModeContext, s: SandboxSlice): void {
  const view = {
    positions: s.savedPositions.map((p) => ({ name: p.name, x: Math.round(p.x), z: Math.round(p.z) })),
    previous: (sessions.get(ctx)?.previous ?? null) !== null,
  };
  ctx.ui.patch(TELEPORT_VM, view as unknown as JsonValue);
}

/**
 * Requests one sandbox teleport. Raises the wait toast, then on success remembers the pose read before the jump as the previous
 * pose; on failure raises one warning toast with the result's `messageKey` and changes nothing else.
 */
export function sandboxGo(ctx: ModeContext, to: TeleportTarget, env: TeleportEnv, s: SandboxSlice): void {
  const before = env.playerPose?.() ?? null;
  toast(ctx, TELEPORT_WAIT, 'info', TELEPORT_WAIT);
  void ctx.world.teleport.request('sandbox', to).then((r) => {
    if (!r.ok) {
      toast(ctx, 'sandbox.teleport', 'warning', r.messageKey);
      return;
    }
    const session = sessions.get(ctx);
    if (!session) return;
    if (before !== null) session.previous = { ...before };
    publishTeleport(ctx, s);
  });
}

function parse(e: SimEvent): { name: string; args: JsonObject } | null {
  if (e.t !== 'mode.cmd' || e.s === undefined) return null;
  let msg: { mode?: unknown; name?: unknown; args?: unknown };
  try {
    msg = JSON.parse(e.s) as typeof msg;
  } catch {
    return null;
  }
  if (msg.mode !== 'sandbox' || typeof msg.name !== 'string') return null;
  const a = msg.args;
  return { name: msg.name, args: typeof a === 'object' && a !== null && !Array.isArray(a) ? (a as JsonObject) : {} };
}

/** The lowest free `pos-<n>`, n in 1 to the limit; null when all are taken. */
function freeSpotName(s: SandboxSlice): string | null {
  const used = new Set<number>();
  for (const p of s.savedPositions) {
    const m = SPOT_NAME.exec(p.name);
    if (m) used.add(Number(m[1]));
  }
  for (let n = 1; n <= SAVE_LIMITS.sandboxSavedPositions; n++) if (!used.has(n)) return `pos-${n}`;
  return null;
}

/** Saves the player's pose as the next numbered spot. */
function savePosition(ctx: ModeContext, s: SandboxSlice, env: TeleportEnv): void {
  const pose = env.playerPose?.() ?? null;
  if (pose === null) {
    toast(ctx, POSITION_NO_PLAYER, 'warning', POSITION_NO_PLAYER);
    return;
  }
  const name = freeSpotName(s);
  if (s.savedPositions.length >= SAVE_LIMITS.sandboxSavedPositions || name === null) {
    toast(ctx, POSITION_FULL, 'warning', POSITION_FULL, { max: SAVE_LIMITS.sandboxSavedPositions });
    return;
  }
  s.savedPositions.push({ name, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw });
  publishTeleport(ctx, s);
  toast(ctx, POSITION_SAVED, 'info', POSITION_SAVED, { n: Number(name.slice(4)) });
  ctx.save.request('manual');
}

/**
 * Runs one teleport or spot action of `mode.cmd {mode: 'sandbox'}`. Unknown names and bad arguments change nothing. The
 * dispatcher has already refused the command while online; the check here is for a direct event.
 */
export function runTeleportAction(ctx: ModeContext, s: SandboxSlice, e: SimEvent, env: TeleportEnv, online: boolean): void {
  const m = parse(e);
  if (m === null || online || !(TELEPORT_ACTIONS as readonly string[]).includes(m.name)) return;
  switch (m.name as (typeof TELEPORT_ACTIONS)[number]) {
    case 'teleport.landmark': {
      const id = m.args['id'];
      if (typeof id !== 'string' || !LANDMARK_ID.test(id) || !ctx.world.teleport.candidates('sandbox').some((c) => c.id === id)) {
        toast(ctx, UNKNOWN_TARGET, 'warning', UNKNOWN_TARGET);
        return;
      }
      sandboxGo(ctx, { landmark: id }, env, s);
      return;
    }
    case 'teleport.waypoint': {
      const w = env.waypoint?.() ?? null;
      if (w === null) toast(ctx, NO_WAYPOINT, 'warning', NO_WAYPOINT);
      else sandboxGo(ctx, { x: w.x, z: w.z }, env, s);
      return;
    }
    case 'teleport.back': {
      const p = sessions.get(ctx)?.previous ?? null;
      if (p === null) toast(ctx, NO_PREVIOUS, 'warning', NO_PREVIOUS);
      else sandboxGo(ctx, { x: p.x, z: p.z, yaw: p.yaw }, env, s);
      return;
    }
    case 'position.save':
      savePosition(ctx, s, env);
      return;
    case 'position.delete': {
      const name = m.args['name'];
      const i = typeof name === 'string' ? s.savedPositions.findIndex((p) => p.name === name) : -1;
      if (i < 0) return;
      s.savedPositions.splice(i, 1);
      publishTeleport(ctx, s);
      toast(ctx, POSITION_FORGOT, 'info', POSITION_FORGOT);
      ctx.save.request('manual');
    }
  }
}
