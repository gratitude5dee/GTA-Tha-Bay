/**
 * `defineDirector`: the builder for DirectorScripts (M05a2; 03-story-cutscenes.md D2, D6). A script lives in
 * `content/missions/<id>/director/<beat>.ts` (the story and race intros) or in a mode package (the fighter and racing sequences
 * with `frame: 'stage2d'`) and compiles to the C09 `DirectorScript` data asset `data/director.<id>` (at most 16 KiB).
 * The builder fills in what is always the same (`schema`, a seed derived from the id, a letterbox), sorts the shots and the
 * actions by time, and refuses a script that the runner could not play: a shot or an action that names a mark that is not
 * there, a first shot that does not start at 0, a cue past the end, an XR vantage on a missing mark. Authoring code, not sim code.
 */
import { fnv32, type LandmarkId, type LatLngTuple } from '@dv/shared';
import type { DirectorScript, DirectorShot, CueSpec } from '@dv/shared/contracts/c09-cutscene';

export const DIRECTOR_LIMIT_BYTES = 16 * 1024;

type Mark = DirectorScript['marks'][string];
type Actor = DirectorScript['actions'][number];

export const markLocal = (x: number, y: number, z: number, yawDeg = 0): Mark => ({ at: { local: [x, y, z] }, yawDeg });
export const markAt = (lat: number, lng: number, yawDeg = 0): Mark => ({ at: [lat, lng] as LatLngTuple, yawDeg });
export const markLandmark = (id: LandmarkId, yawDeg = 0): Mark => ({ at: { landmark: id }, yawDeg });

export const dirShot = (atSec: number, preset: DirectorShot['preset'], subject: string, o: Partial<Omit<DirectorShot, 'atSec' | 'preset' | 'subject'>> = {}): DirectorShot => ({
  atSec,
  preset,
  subject,
  lens: 'normal',
  ...o,
});

export const dirActor = (who: DirectorScript['actors'][number]['who'], start: string, end: string, prefab?: string): DirectorScript['actors'][number] => ({
  who,
  start,
  end,
  ...(prefab !== undefined ? { prefab } : {}),
});

export const dirAction = (atSec: number, who: string, doing: Actor['do'], arg: string): Actor => ({ atSec, who, do: doing, arg });

export const dirCue = (line: CueSpec['line'], startMs: number, endMs: number, o: { speaker?: string; kind?: CueSpec['kind'] } = {}): CueSpec => ({
  line,
  startMs,
  endMs,
  kind: o.kind ?? 'dialogue',
  ...(o.speaker !== undefined ? { speaker: o.speaker } : {}),
});

export interface DirectorInput {
  id: string;
  durationSec: number;
  /** Default: a hash of the id, so two scripts differ and one script is stable. */
  seed?: number;
  marks: Record<string, Mark>;
  actors?: DirectorScript['actors'];
  shots: DirectorShot[];
  actions?: DirectorScript['actions'];
  cues?: CueSpec[];
  /** The XR viewpoint: a mark and a heading. Default: the first mark, facing as the mark does. */
  xrVantage?: DirectorScript['xrVantage'];
  /** Default true (the story's cinematic bars); a fighter side view usually sets false. */
  letterbox?: boolean;
  music?: DirectorScript['music'];
  frame?: DirectorScript['frame'];
}

export class DirectorAuthoringError extends Error {
  constructor(id: string, message: string) {
    super(`defineDirector(${id}): ${message}`);
    this.name = 'DirectorAuthoringError';
  }
}

export function defineDirector(input: DirectorInput): DirectorScript {
  const fail = (m: string): never => {
    throw new DirectorAuthoringError(input.id, m);
  };
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(input.id)) fail('the id must be letters, digits, dot, dash and underscore');
  if (!(input.durationSec > 0 && input.durationSec <= 120)) fail('durationSec must be above 0 and at most 120');
  const markNames = Object.keys(input.marks).sort();
  if (markNames.length === 0) fail('a script needs at least one mark');
  const hasMark = (n: string): boolean => Object.prototype.hasOwnProperty.call(input.marks, n);

  const shots = [...input.shots].sort((a, b) => a.atSec - b.atSec);
  if (shots.length === 0) fail('a script needs at least one shot');
  if ((shots[0] as DirectorShot).atSec !== 0) fail('the first shot must start at 0');
  for (const s of shots) {
    if (s.atSec < 0 || s.atSec >= input.durationSec) fail(`shot at ${s.atSec} s is outside the script`);
    if (s.from !== undefined && !hasMark(s.from)) fail(`shot at ${s.atSec} s starts from the unknown mark ${s.from}`);
  }
  const actors = input.actors ?? [];
  for (const a of actors) {
    if (!hasMark(a.start)) fail(`actor ${a.who} starts on the unknown mark ${a.start}`);
    if (!hasMark(a.end)) fail(`actor ${a.who} ends on the unknown mark ${a.end}`);
  }
  const actions = [...(input.actions ?? [])].sort((a, b) => a.atSec - b.atSec);
  for (const a of actions) {
    if (a.atSec < 0 || a.atSec >= input.durationSec) fail(`action at ${a.atSec} s is outside the script`);
    if ((a.do === 'moveTo' || a.do === 'runTo' || a.do === 'driveTo') && !hasMark(a.arg)) fail(`${a.do} of ${a.who} names the unknown mark ${a.arg}`);
  }
  const cues = input.cues ?? [];
  for (const c of cues) {
    if (!(c.startMs >= 0 && c.endMs > c.startMs)) fail(`cue ${c.line} must end after it starts`);
    if (c.startMs >= input.durationSec * 1000) fail(`cue ${c.line} starts after the script ends`);
  }
  const vantage = input.xrVantage ?? { mark: markNames[0] as string, yawDeg: (input.marks[markNames[0] as string] as Mark).yawDeg };
  if (!hasMark(vantage.mark)) fail(`the XR vantage names the unknown mark ${vantage.mark}`);

  const script: DirectorScript = {
    schema: 'director/1',
    id: input.id,
    durationSec: input.durationSec,
    seed: input.seed ?? fnv32(`director|${input.id}`),
    marks: input.marks,
    actors: [...actors],
    shots,
    actions,
    cues: [...cues],
    xrVantage: vantage,
    letterbox: input.letterbox ?? true,
    ...(input.music !== undefined ? { music: input.music } : {}),
    ...(input.frame !== undefined ? { frame: input.frame } : {}),
  };
  const bytes = JSON.stringify(script).length;
  if (bytes > DIRECTOR_LIMIT_BYTES) fail(`the script is ${bytes} bytes (limit ${DIRECTOR_LIMIT_BYTES})`);
  return script;
}
