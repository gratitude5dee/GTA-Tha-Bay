import { utf8Bytes, type FrameSignal, type LoopStats, type SaveErrorCode, type SimControlMessage } from '@dv/shared';
import { decodeUtf8 } from '../bytes.ts';
import type { SimEvent } from '../events.ts';

/**
 * Every message between the main thread and sim.worker is `{ v: 1, t, seq, p }` (01-engine.md section 2.1,
 * P-SK-02). The guards below run on both sides: the worker checks what it receives from the page and the page checks
 * what it receives from the worker.
 */
export const ENVELOPE_VERSION = 1 as const;

export interface Envelope<T extends string, P> {
  readonly v: typeof ENVELOPE_VERSION;
  readonly t: T;
  readonly seq: number;
  readonly p: P;
}

/** Debug commands, accepted only by QA builds (`window.__dvBridge.engine.act`). */
export type DebugCommand =
  | { t: 'debug.crash' }
  | { t: 'debug.stall'; ms: number }
  | { t: 'debug.rebase'; to?: [number, number, number] }
  | { t: 'debug.step'; n: number }
  /** Move the player to a point (ENU metres); the ownership machine waits for ground under it (M01b1). */
  | { t: 'debug.teleport'; pos: [number, number, number] }
  | { t: 'debug.ragdoll' }
  /** Lock or unlock the fp/tp toggle (reason `debug`). */
  | { t: 'debug.camera.lock'; on: boolean };

/** The input block contents carried by the postMessage transport (the SAB transport shares the block itself). */
export interface InputState {
  held: number;
  pressed: number;
  released: number;
  axesA: number;
  axesB: number;
  cam: number;
}

export interface StatsReport {
  stats: LoopStats;
  nanCount: number;
  hash: { tick: number; hex: string } | null;
  physicsBuild: 'simd-compat' | 'deterministic-compat';
  rebases: number;
  entities: number;
  bodies: number;
  /** Messages the worker dropped: events that did not fit the event ring. */
  eventsDropped: number;
}

/**
 * Answer to a SimControlMessage. 'not-implemented' while no SaveControl is installed; 'not-eligible' when C05 rule 4
 * says no save is due (the collector returned nothing); otherwise the C05 error code of the first failed write.
 */
export type SimControlResult =
  | { t: 'save.result'; ok: true; slots: number }
  | { t: 'save.result'; ok: false; reason: 'not-implemented' | 'not-eligible' | SaveErrorCode };

export interface SnapshotFramePayload {
  tick: number;
  count: number;
  flags: number;
  side: Record<string, unknown>;
  buf: ArrayBuffer;
}
export interface PmSnapshotPayload {
  tick: number;
  alpha: number;
  cur: SnapshotFramePayload;
  prev: SnapshotFramePayload | null;
}

export type ToWorkerMessage =
  | Envelope<'frame', FrameSignal>
  | Envelope<'ctl', SimControlMessage>
  | Envelope<'dbg', DebugCommand>
  | Envelope<'input', InputState>;

export type FromWorkerMessage =
  | Envelope<'ready', { physicsBuild: 'simd-compat' | 'deterministic-compat'; transport: 'sab' | 'postMessage' }>
  | Envelope<'stats', StatsReport>
  | Envelope<'ctl.result', SimControlResult>
  | Envelope<'log', { level: 'info' | 'warn' | 'error'; message: string }>
  | Envelope<'qa', { name: string; data: unknown }>
  | Envelope<'events', { events: SimEvent[] }>
  | Envelope<'snap', PmSnapshotPayload>;

export function makeEnvelope<T extends string, P>(t: T, seq: number, p: P): Envelope<T, P> {
  return { v: ENVELOPE_VERSION, t, seq, p };
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => isNum(x) && Number.isInteger(x);

export function isEnvelope(x: unknown): x is Envelope<string, unknown> {
  return isObject(x) && x['v'] === ENVELOPE_VERSION && typeof x['t'] === 'string' && isInt(x['seq']) && 'p' in x;
}

const SAVE_RESULT_REASONS: ReadonlySet<string> = new Set([
  'not-implemented', 'not-eligible', 'QUOTA', 'TOO_LARGE', 'CHECKSUM', 'CONFLICT', 'NEWER_SCHEMA', 'IDB_UNAVAILABLE', 'NOT_ALLOWED', 'INVALID', 'NAME_TAKEN', 'PROFILE_LIMIT',
]);

const TIME_SCALES: readonly unknown[] = [0.25, 0.5, 1, 2];

export function isFrameSignal(p: unknown): p is FrameSignal {
  return (
    isObject(p) && isInt(p['frame']) && isNum(p['nowMs']) && isNum(p['dtSec']) && p['dtSec'] >= 0 &&
    typeof p['paused'] === 'boolean' && TIME_SCALES.includes(p['timeScale'])
  );
}

export function isSimControlMessage(p: unknown): p is SimControlMessage {
  return isObject(p) && p['t'] === 'save.request' && p['reason'] === 'hidden';
}

export function isDebugCommand(p: unknown): p is DebugCommand {
  if (!isObject(p)) return false;
  switch (p['t']) {
    case 'debug.crash': return true;
    case 'debug.stall': return isNum(p['ms']) && p['ms'] >= 0 && p['ms'] <= 60_000;
    case 'debug.rebase': return p['to'] === undefined || (Array.isArray(p['to']) && p['to'].length === 3 && p['to'].every(isNum));
    case 'debug.step': return isInt(p['n']) && p['n'] >= 0 && p['n'] <= 100_000;
    case 'debug.teleport': return Array.isArray(p['pos']) && p['pos'].length === 3 && p['pos'].every(isNum);
    case 'debug.ragdoll': return true;
    case 'debug.camera.lock': return typeof p['on'] === 'boolean';
    default: return false;
  }
}

export function isInputState(p: unknown): p is InputState {
  return isObject(p) && (['held', 'pressed', 'released', 'axesA', 'axesB', 'cam'] as const).every((k) => isInt(p[k]));
}

export function isToWorkerMessage(x: unknown): x is ToWorkerMessage {
  if (!isEnvelope(x)) return false;
  switch (x.t) {
    case 'frame': return isFrameSignal(x.p);
    case 'ctl': return isSimControlMessage(x.p);
    case 'dbg': return isDebugCommand(x.p);
    case 'input': return isInputState(x.p);
    default: return false;
  }
}

function isLoopStats(p: unknown): p is LoopStats {
  return isObject(p) && (['tick', 'ticksLastFrame', 'tickMsP50', 'tickMsP99', 'droppedSec', 'overruns'] as const).every((k) => isNum(p[k]));
}

function isFramePayload(p: unknown): p is SnapshotFramePayload {
  return isObject(p) && isInt(p['tick']) && isInt(p['count']) && isInt(p['flags']) && isObject(p['side']) && p['buf'] instanceof ArrayBuffer;
}

export function isFromWorkerMessage(x: unknown): x is FromWorkerMessage {
  if (!isEnvelope(x)) return false;
  const p = x.p;
  switch (x.t) {
    case 'ready':
      return isObject(p) && (p['physicsBuild'] === 'simd-compat' || p['physicsBuild'] === 'deterministic-compat') && (p['transport'] === 'sab' || p['transport'] === 'postMessage');
    case 'stats':
      return isObject(p) && isLoopStats(p['stats']) && isNum(p['nanCount']) && isNum(p['rebases']) && isNum(p['entities']) && isNum(p['bodies']) && isNum(p['eventsDropped']);
    case 'ctl.result':
      return isObject(p) && p['t'] === 'save.result' && (p['ok'] === true ? isInt(p['slots']) : p['ok'] === false && typeof p['reason'] === 'string' && SAVE_RESULT_REASONS.has(p['reason']));
    case 'log':
      return isObject(p) && (p['level'] === 'info' || p['level'] === 'warn' || p['level'] === 'error') && typeof p['message'] === 'string';
    case 'qa':
      return isObject(p) && typeof p['name'] === 'string';
    case 'events':
      return isObject(p) && Array.isArray(p['events']) && p['events'].every((e) => isObject(e) && typeof e['t'] === 'string' && isNum(e['tick']));
    case 'snap':
      return isObject(p) && isInt(p['tick']) && isNum(p['alpha']) && isFramePayload(p['cur']) && (p['prev'] === null || isFramePayload(p['prev']));
    default:
      return false;
  }
}

/** UTF-8 JSON of an envelope, for the byte rings. */
export function encodeEnvelope(env: Envelope<string, unknown>): Uint8Array {
  return utf8Bytes(JSON.stringify(env));
}

/** Parses ring bytes; returns null when they are not valid JSON (the guards then reject anything odd). */
export function decodeEnvelope(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decodeUtf8(bytes)) as unknown;
  } catch {
    return null;
  }
}
