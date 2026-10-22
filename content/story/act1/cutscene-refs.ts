/**
 * The generated-clip refs of Act 1 missions m.a1.01 to m.a1.06 (03-story-narrative.md B5; M05c1). m.a1.07 to m.a1.12 add theirs in M05c2.
 * Every ref is a story beat with prefetch `onTrigger` and prewarm priority 1, and names an in-engine DirectorScript fallback that
 * carries the same cues (`content/missions/<id>/director/`). Fictional cast only (D-30, 03-story-missions.md C11). The beat revision is
 * the `@<rev>` of `stage`; `content/cutscenes/beats.lock.json` locks it (D3.4). "LOT 1"-style screen text is an in-engine overlay, never
 * part of a clip: no slot asks for text.
 */
import type { CutsceneRef } from '../../../packages/shared/src/contracts/c09-cutscene.ts';

const refs: CutsceneRef[] = [
  {
    id: 'cut.story.m.a1.01.dawn',
    hook: 'story.establish',
    template: 'story.establish@1',
    cast: [],
    stage: 'beat.cut.story.m.a1.01.dawn@1',
    move: null,
    slots: {
      time_of_day: 'dawn',
      weather: 'fog',
      mood: 'quiet and expectant',
      camera_1: 'slow push-in at crane height, then hold',
    },
    fallback: 'm.a1.01.dawn',
    cues: [{ line: 'line.m.a1.01.dawn.1', speaker: 'odessa_calloway', startMs: 600, endMs: 7200, kind: 'dialogue' }],
    audio: 'generated-ambient',
    prefetch: 'onTrigger',
    priority: 1,
    skippable: true,
  },
];

export default refs;
