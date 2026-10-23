/**
 * QA builds only (M05a1, M05b2): the compiled bundle of a mission for `?mission=<id>`, bundled with the page. Reached through a dynamic
 * import behind `VITE_DV_QA === '1'`, so a production dist holds none of it. The mission store (assets by `data/mission.<id>`)
 * replaces this when M05c1 brings the Jobs app and the markers that start a mission. M05b2 adds the cutscene refs the mission's beats
 * name and the shipped cutscene index, which the page's CutscenePlayer reads.
 */
import sampleMission from '../../../../assets/src/data/mission.m.dev.sample/mission.json';
import sampleIntro from '../../../../assets/src/data/director.m.dev.sample.intro/director.json';
import sampleMeet from '../../../../assets/src/data/director.m.dev.sample.meet/director.json';
import talkMission from '../../../../assets/src/data/mission.m.dev.talk/mission.json';
import sampleLines from '../../../../assets/src/data/lines.0.en/lines.json';
import cutsceneIndex from '../../../../assets/src/data/cutscene-index/index.json';
import sampleRefs from '../../../../content/story/dev/cutscene-refs.ts';
import type { CutsceneIndex } from '@dv/shared/contracts/c09-cutscene';

/** The QA fixture clip every cutscene request resolves to under `?beats=video` (the same-origin media mirror, M01e). */
export const QA_FIXTURE_MANIFEST = '/media-local/cutscenes/fixture-a/manifest.json';

export function qaMissionBundle(id: string): Record<string, unknown> | null {
  // m.dev.talk (M05c1): the talk panel's mission, one talk with a gated outcome; no beats, so no directors or cutscenes
  if (id === 'm.dev.talk') return { id, ir: talkMission, directors: [], cutscenes: [], lines: (sampleLines as { text: Record<string, string> }).text };
  if (id !== 'm.dev.sample') return null;
  return {
    id,
    ir: sampleMission,
    directors: [sampleIntro, sampleMeet],
    cutscenes: sampleRefs.map((r) => ({ id: r.id, fallback: r.fallback })),
    lines: (sampleLines as { text: Record<string, string> }).text,
  };
}

/** The shipped index of the development release, for the CutscenePlayer. */
export function qaCutsceneIndex(): CutsceneIndex {
  return cutsceneIndex as unknown as CutsceneIndex;
}

/** Text of the lines of the sample mission, for the cue subtitles. */
export function qaLines(): Record<string, string> {
  return (sampleLines as { text: Record<string, string> }).text;
}
