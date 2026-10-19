/**
 * Input lines (P-SK-09; 01-engine.md 2.11; M03a1): `*.line.json`, a recorded or hand-written stream of quantized C03
 * `InputFrame`s that replays in CI and from the debug panel.
 *
 *   { v: 1, scenario, seed, profile, start: { pos, yaw, prefab?, speed? }, frames: [{ tick, run, input }], commands?: [...] }
 *
 * `frames` is run-length encoded: `run` consecutive ticks from `tick` carry the same `input` (a run of 1 is the
 * `{ tick, input }` form of 13-qa.md 3.5). Ticks are relative to the tick the line starts at. `pressed` and `released` are
 * not stored: they are the rising and falling edges of `buttons`, derived on playback exactly as the page's latch derives them.
 * Files hold inputs only: no expected values, no hashes (the goldens are in `test/golden/lines.json`, DL-549).
 *
 * `start.speed` (metres per second along the heading) is a Builder addition (BD-M03a1-05): the top-speed lines need a
 * rolling start on a 1.2 km straight.
 */
import { canonicalize, type InputFrame, type SimProfile } from '@dv/shared';

export const LINE_VERSION = 1 as const;

/** The stored part of an `InputFrame`. */
export interface LineInput {
  buttons: number;
  moveX: number;
  moveY: number;
  throttle: number;
  brake: number;
  steer: number;
  camYaw: number;
  camPitch: number;
  context: number;
}

export interface LineRun { tick: number; run: number; input: LineInput }

export type LineCommand =
  /** From `tick` on, the view heading (`camYaw`, u16) is held at `yaw`. */
  | { t: 'aim'; tick: number; yaw: number }
  /** From `tick` on, steer (in a vehicle) or walk (on foot) toward the point (x, z) until within `r` metres (default 2). */
  | { t: 'follow'; tick: number; x: number; z: number; r?: number }
  /** At `tick`, hold the line until the player is within `r` metres of (x, z), or `timeout` ticks have passed. */
  | { t: 'waitNear'; tick: number; x: number; z: number; r: number; timeout: number };

export interface LineFile {
  v: typeof LINE_VERSION;
  scenario: string;
  seed: number;
  profile: SimProfile;
  start: { pos: [number, number, number]; yaw: number; prefab?: string; speed?: number };
  frames: LineRun[];
  commands?: LineCommand[];
}

export class LineFormatError extends Error {
  constructor(readonly path: string, message: string) {
    super(`line file: ${path}: ${message}`);
    this.name = 'LineFormatError';
  }
}

const INPUT_KEYS: readonly (keyof LineInput)[] = ['buttons', 'moveX', 'moveY', 'throttle', 'brake', 'steer', 'camYaw', 'camPitch', 'context'];

/** The stored fields of a full frame. */
export function lineInputOf(f: Pick<InputFrame, keyof LineInput>): LineInput {
  return {
    buttons: f.buttons >>> 0, moveX: f.moveX, moveY: f.moveY, throttle: f.throttle, brake: f.brake, steer: f.steer,
    camYaw: f.camYaw, camPitch: f.camPitch, context: f.context,
  };
}

const sameInput = (a: LineInput, b: LineInput): boolean => INPUT_KEYS.every((k) => a[k] === b[k]);

/** Run-length encodes consecutive frames; the first frame is line tick `firstTick`. */
export function encodeRuns(frames: readonly LineInput[], firstTick = 0): LineRun[] {
  const out: LineRun[] = [];
  for (let i = 0; i < frames.length; i++) {
    const input = frames[i] as LineInput;
    const last = out[out.length - 1];
    if (last && sameInput(last.input, input) && last.tick + last.run === firstTick + i) last.run++;
    else out.push({ tick: firstTick + i, run: 1, input: { ...input } });
  }
  return out;
}

/** The input of line tick `t`, or null where no run covers it. Runs are sorted and non-overlapping. */
export function inputAt(runs: readonly LineRun[], t: number): LineInput | null {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = runs[mid] as LineRun;
    if (t < r.tick) hi = mid - 1;
    else if (t >= r.tick + r.run) lo = mid + 1;
    else return r.input;
  }
  return null;
}

/** Total number of ticks the runs span (last run end). */
export function lineLength(line: Pick<LineFile, 'frames'>): number {
  const last = line.frames[line.frames.length - 1];
  return last ? last.tick + last.run : 0;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function checkInput(v: unknown, path: string): LineInput {
  if (typeof v !== 'object' || v === null) throw new LineFormatError(path, 'must be an object');
  const o = v as Record<string, unknown>;
  const ranges: Record<keyof LineInput, [number, number]> = {
    buttons: [0, 0xffffffff], moveX: [-127, 127], moveY: [-127, 127], throttle: [0, 127], brake: [0, 127], steer: [-127, 127],
    camYaw: [0, 65535], camPitch: [-16384, 16384], context: [0, 255],
  };
  const out = {} as LineInput;
  for (const k of INPUT_KEYS) {
    const x = o[k];
    if (!isInt(x)) throw new LineFormatError(`${path}.${k}`, 'must be an integer');
    const [lo, hi] = ranges[k];
    if (x < lo || x > hi) throw new LineFormatError(`${path}.${k}`, `must be in ${lo}..${hi}`);
    out[k] = x;
  }
  for (const k of Object.keys(o)) if (!(INPUT_KEYS as readonly string[]).includes(k)) throw new LineFormatError(`${path}.${k}`, 'unknown field');
  return out;
}

/** Validates untrusted data and returns it typed. Throws `LineFormatError` with the path of the first problem. */
export function validateLine(data: unknown): LineFile {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new LineFormatError('$', 'must be an object');
  const o = data as Record<string, unknown>;
  if (o['v'] !== LINE_VERSION) throw new LineFormatError('$.v', `must be ${LINE_VERSION}`);
  if (typeof o['scenario'] !== 'string' || o['scenario'] === '') throw new LineFormatError('$.scenario', 'must be a non-empty string');
  if (!isInt(o['seed'])) throw new LineFormatError('$.seed', 'must be an integer');
  if (o['profile'] !== 'local' && o['profile'] !== 'canonical') throw new LineFormatError('$.profile', "must be 'local' or 'canonical'");
  const st = o['start'] as Record<string, unknown> | undefined;
  if (typeof st !== 'object' || st === null) throw new LineFormatError('$.start', 'must be an object');
  const pos = st['pos'];
  if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(isNum)) throw new LineFormatError('$.start.pos', 'must be [x, y, z]');
  if (!isNum(st['yaw'])) throw new LineFormatError('$.start.yaw', 'must be a number');
  if (st['prefab'] !== undefined && typeof st['prefab'] !== 'string') throw new LineFormatError('$.start.prefab', 'must be a string');
  if (st['speed'] !== undefined && !isNum(st['speed'])) throw new LineFormatError('$.start.speed', 'must be a number');
  if (!Array.isArray(o['frames'])) throw new LineFormatError('$.frames', 'must be an array');
  let end = 0;
  const frames: LineRun[] = (o['frames'] as unknown[]).map((r, i) => {
    const p = `$.frames[${i}]`;
    if (typeof r !== 'object' || r === null) throw new LineFormatError(p, 'must be an object');
    const run = r as Record<string, unknown>;
    if (!isInt(run['tick']) || run['tick'] < end) throw new LineFormatError(`${p}.tick`, 'must be an integer at or after the end of the previous run');
    if (!isInt(run['run']) || run['run'] < 1) throw new LineFormatError(`${p}.run`, 'must be an integer of at least 1');
    end = run['tick'] + run['run'];
    return { tick: run['tick'], run: run['run'], input: checkInput(run['input'], `${p}.input`) };
  });
  const line: LineFile = {
    v: LINE_VERSION,
    scenario: o['scenario'],
    seed: o['seed'] as number,
    profile: o['profile'],
    start: {
      pos: [pos[0] as number, pos[1] as number, pos[2] as number],
      yaw: st['yaw'],
      ...(st['prefab'] !== undefined ? { prefab: st['prefab'] as string } : {}),
      ...(st['speed'] !== undefined ? { speed: st['speed'] as number } : {}),
    },
    frames,
  };
  if (o['commands'] !== undefined) {
    if (!Array.isArray(o['commands'])) throw new LineFormatError('$.commands', 'must be an array');
    line.commands = (o['commands'] as unknown[]).map((c, i) => {
      const p = `$.commands[${i}]`;
      if (typeof c !== 'object' || c === null) throw new LineFormatError(p, 'must be an object');
      const cmd = c as Record<string, unknown>;
      if (!isInt(cmd['tick']) || cmd['tick'] < 0) throw new LineFormatError(`${p}.tick`, 'must be a non-negative integer');
      switch (cmd['t']) {
        case 'aim':
          if (!isInt(cmd['yaw']) || cmd['yaw'] < 0 || cmd['yaw'] > 65535) throw new LineFormatError(`${p}.yaw`, 'must be a u16');
          return { t: 'aim', tick: cmd['tick'], yaw: cmd['yaw'] };
        case 'follow':
          if (!isNum(cmd['x']) || !isNum(cmd['z'])) throw new LineFormatError(p, 'follow needs x and z');
          return { t: 'follow', tick: cmd['tick'], x: cmd['x'], z: cmd['z'], ...(isNum(cmd['r']) ? { r: cmd['r'] } : {}) };
        case 'waitNear':
          if (!isNum(cmd['x']) || !isNum(cmd['z']) || !isNum(cmd['r']) || !isInt(cmd['timeout'])) throw new LineFormatError(p, 'waitNear needs x, z, r and timeout');
          return { t: 'waitNear', tick: cmd['tick'], x: cmd['x'], z: cmd['z'], r: cmd['r'], timeout: cmd['timeout'] };
        default:
          throw new LineFormatError(`${p}.t`, "must be 'aim', 'follow' or 'waitNear'");
      }
    });
  }
  return line;
}

/** Canonical JSON (sorted keys, no whitespace) of a line: the bytes a repository file holds and the round trip checks. */
export function serializeLine(line: LineFile): string {
  return canonicalize(line);
}

export function parseLine(text: string): LineFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new LineFormatError('$', `not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return validateLine(data);
}
