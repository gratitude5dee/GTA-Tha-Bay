/**
 * Cutscene refs of the development mission m.dev.sample (M05b2). The intro beat is a generated clip with an in-engine fallback:
 * the DirectorScript `m.dev.sample.intro` (content/missions/m.dev.sample/director/intro.json) plays the same cues. Act 1 refs
 * come with M05c1. The beat revision is the `@<rev>` of `stage`; `content/cutscenes/beats.lock.json` locks it (D3.4).
 */
import type { CutsceneRef } from '../../../packages/shared/src/contracts/c09-cutscene.ts';

const refs: CutsceneRef[] = [
  {
    id: 'cut.story.m.dev.sample.intro',
    hook: 'story.beat',
    template: 'story.beat@1',
    cast: ['npc_test'],
    stage: 'beat.cut.story.m.dev.sample.intro@1',
    move: null,
    slots: {
      time_of_day: 'afternoon',
      weather: 'clear',
      mood: 'curious and light',
      action_1: 'a person in a gray jumpsuit crosses the plaza and looks up at the dome',
      camera_1: 'slow push-in at chest height',
      action_2: 'the person stops, checks a clipboard and nods',
      camera_2: 'static medium shot',
    },
    fallback: 'm.dev.sample.intro',
    cues: [
      { line: 'line.m.dev.sample.cut.intro.1', speaker: 'npc_test', startMs: 200, endMs: 2800, kind: 'dialogue' },
      { line: 'line.m.dev.sample.cut.intro.2', speaker: 'npc_test', startMs: 3000, endMs: 5600, kind: 'dialogue' },
    ],
    audio: 'engine',
    prefetch: 'onTrigger',
    priority: 1,
    skippable: true,
  },
];

export default refs;
