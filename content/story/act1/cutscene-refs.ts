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
  {
    id: 'cut.story.m.a1.03.raid',
    hook: 'story.beat',
    template: 'story.beat@1',
    cast: ['tavi_okafor'],
    stage: 'beat.cut.story.m.a1.03.raid@1',
    move: null,
    slots: {
      time_of_day: 'night',
      weather: 'fog',
      mood: 'tense and chaotic',
      action_1: 'cars circle and spin in tire smoke while a crowd cheers',
      action_2: 'patrol lights flood the lot and the crowd scatters in every direction',
      camera_1: 'handheld push-in on the smoke',
      camera_2: 'whip pan to the patrol lights',
    },
    fallback: 'm.a1.03.raid',
    cues: [
      { line: 'line.m.a1.03.raid.1', speaker: 'tavi_okafor', startMs: 1500, endMs: 6000, kind: 'dialogue' },
      { line: 'line.m.a1.03.raid.2', speaker: 'tavi_okafor', startMs: 8000, endMs: 12500, kind: 'dialogue' },
    ],
    audio: 'generated-ambient',
    prefetch: 'onTrigger',
    priority: 1,
    skippable: true,
  },
  {
    id: 'cut.story.m.a1.04.keynote',
    hook: 'story.beat',
    template: 'story.beat@1',
    cast: ['corwin_hale'],
    stage: 'beat.cut.story.m.a1.04.keynote@1',
    move: null,
    slots: {
      time_of_day: 'night',
      weather: 'clear',
      mood: 'polished and ominous',
      action_1: 'a city curb map on the big screen splits into glowing numbered lots',
      action_2: 'the executive raises one hand toward the screen',
      camera_1: 'slow dolly toward the stage',
      camera_2: 'close shot on the raised hand',
    },
    fallback: 'm.a1.04.keynote',
    cues: [
      { line: 'line.m.a1.04.keynote.1', speaker: 'corwin_hale', startMs: 1200, endMs: 7000, kind: 'dialogue' },
      { line: 'line.m.a1.04.keynote.2', speaker: 'corwin_hale', startMs: 8000, endMs: 12800, kind: 'dialogue' },
    ],
    audio: 'generated-ambient',
    prefetch: 'onTrigger',
    priority: 1,
    skippable: true,
  },
  {
    id: 'cut.story.m.a1.05.ring',
    hook: 'story.establish',
    template: 'story.establish@1',
    cast: [],
    stage: 'beat.cut.story.m.a1.05.ring@1',
    move: null,
    slots: {
      time_of_day: 'dusk',
      weather: 'clear',
      mood: 'electric and communal',
      camera_1: 'slow push-in on the crowd ring, then hold',
    },
    fallback: 'm.a1.05.ring',
    cues: [
      { line: 'line.m.a1.05.ring.1', speaker: 'standin_rap_elder', startMs: 800, endMs: 7000, kind: 'dialogue' },
    ],
    audio: 'generated-ambient',
    prefetch: 'onTrigger',
    priority: 1,
    skippable: true,
  },
  {
    id: 'cut.story.m.a1.06.antenna',
    hook: 'story.establish',
    template: 'story.establish@1',
    cast: [],
    stage: 'beat.cut.story.m.a1.06.antenna@1',
    move: null,
    slots: {
      time_of_day: 'night',
      weather: 'clear',
      mood: 'hopeful and defiant',
      camera_1: 'slow crane up the antenna, then hold on the city lights',
    },
    fallback: 'm.a1.06.antenna',
    cues: [
      { line: 'line.m.a1.06.antenna.1', speaker: 'saint_static', startMs: 700, endMs: 6800, kind: 'dialogue' },
    ],
    audio: 'generated-ambient',
    prefetch: 'onTrigger',
    priority: 1,
    skippable: true,
  },
];

export default refs;
