/**
 * Inspection of an `anim/<slug>.moves` file against the kit it serves (M10a2, FX7, AC-4 and AC-5). Reads only the JSON chunk of the GLB, so
 * a meshopt-compressed file needs no decoder.
 *
 *   names    the clip names equal the kit's move ids (moves, supers, shutdown, taunt): none missing, none extra
 *   frames   a clip's `extras.frames` (the tool's frame count at its `extras.fps`) is the kit's total frames for the move at that rate:
 *            `N x fps / 60` for a move of N sim frames (startup - 1 + active + recovery at 60 Hz): equal when that is a whole number, one of
 *            the two neighbours at a half frame (an odd N at 30 fps); the last key time is within one frame of N / 60 seconds
 *   a5       the sidecar `retarget.json` written by `assets:retarget` holds a pass for gate A5 (hip drift, end pose) on every clip
 */
import type { FighterDef, MoveDef } from '../../../packages/shared/src/fight/types.ts';

export interface GlbJson {
  animations?: { name?: string; extras?: { frames?: number; fps?: number }; samplers?: { input: number }[] }[];
  accessors?: { max?: number[] }[];
  extras?: { assetId?: string; rig?: string; clips?: string[] };
}

/** The JSON chunk of a GLB. */
export function glbJson(bytes: Uint8Array): GlbJson {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as GlbJson;
}

/** The moves of a kit that need a clip. */
export const movesOf = (kit: FighterDef): MoveDef[] => [...kit.moves, ...kit.supers, kit.shutdown, kit.taunt];

/** Frames of a move at the sim rate: the first startup frame is frame 1, so the move lasts startup - 1 + active + recovery frames. */
export const totalFrames = (m: Pick<MoveDef, 'startup' | 'active' | 'recovery'>): number => m.startup - 1 + m.active + m.recovery;

/** Frames of a clip of `total` sim frames at `fps`; `assets:retarget` resamples `duration x fps` frames, so a half frame rounds either way. */
export const expectedFrames = (total: number, fps: number): number => (total * fps) / 60;

export interface Retarget5 {
  schema: 'retarget-report/1';
  slug: string;
  rig: string;
  fps: number;
  a5: 'pass' | 'fail';
  clips: { name: string; frames: number; hipDriftM: number; endPoseDistM: number; status: 'pass' | 'fail' }[];
}

export interface MovesFinding {
  rule: 'clip-missing' | 'clip-extra' | 'frames' | 'fps' | 'duration' | 'a5-missing' | 'a5-fail';
  clip: string;
  detail: string;
}

export function inspectMoves(glb: Uint8Array, kit: FighterDef, report: Retarget5 | null): MovesFinding[] {
  const out: MovesFinding[] = [];
  const json = glbJson(glb);
  const anims = json.animations ?? [];
  const want = new Map(movesOf(kit).map((m) => [m.id, totalFrames(m)]));
  const have = new Map(anims.map((a) => [a.name ?? '', a]));
  for (const id of want.keys()) if (!have.has(id)) out.push({ rule: 'clip-missing', clip: id, detail: `the kit has move ${id} and the file has no clip of that name` });
  for (const name of have.keys()) if (!want.has(name)) out.push({ rule: 'clip-extra', clip: name, detail: `the file has clip ${name}, which is not a move id of the kit` });
  for (const [id, total] of want) {
    const a = have.get(id);
    if (a === undefined) continue;
    const fps = a.extras?.fps;
    const frames = a.extras?.frames;
    if (fps !== 30 && fps !== 60) {
      out.push({ rule: 'fps', clip: id, detail: `extras.fps is ${String(fps)}, not 30 or 60` });
      continue;
    }
    const need = expectedFrames(total, fps);
    if (frames === undefined || Math.abs(frames - need) > 0.5) out.push({ rule: 'frames', clip: id, detail: `extras.frames is ${String(frames)}; ${total} sim frames at ${fps} fps are ${need} frames (a half frame may round either way)` });
    const input = a.samplers?.[0]?.input;
    const last = input === undefined ? undefined : json.accessors?.[input]?.max?.[0];
    if (last !== undefined && Math.abs(last - total / 60) > 1 / fps + 1e-6) out.push({ rule: 'duration', clip: id, detail: `the last key is at ${last.toFixed(4)} s; the move lasts ${(total / 60).toFixed(4)} s` });
  }
  if (report === null) out.push({ rule: 'a5-missing', clip: '*', detail: 'no retarget.json: the A5 result of the retarget is not recorded' });
  else {
    if (report.a5 !== 'pass') out.push({ rule: 'a5-fail', clip: '*', detail: 'retarget.json records a failed A5 gate' });
    for (const c of report.clips) if (c.status !== 'pass') out.push({ rule: 'a5-fail', clip: c.name, detail: `A5 failed: hip drift ${(c.hipDriftM * 100).toFixed(1)} cm, end pose ${(c.endPoseDistM * 100).toFixed(2)} cm` });
  }
  return out;
}

/** True for a file the gray-box generator wrote: timing-only clips, no retarget, no `extras.frames`. */
export const isGraybox = (animMovesRef: string): boolean => animMovesRef.slice(animMovesRef.indexOf('/') + 1).startsWith('graybox.');
