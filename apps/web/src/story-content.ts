/**
 * The story's mission catalog for the page (M05c1): the compiled Act 1 missions, the DirectorScripts of their beats, the cutscene refs
 * (for the in-engine fallback of each clip) and the English line texts, bundled with the page and handed to the sim in
 * `BootPayload.config.story`. `pnpm missions:build` wrote the JSON files; `import.meta.glob` takes whatever it wrote, so a new mission
 * needs no edit here. The development mission `m.dev.*` stays QA-only (`qa/missions.ts`).
 */
import type { MissionIR } from '@dv/shared';
import type { DirectorScript } from '@dv/shared/contracts/c09-cutscene';
import act1Refs from '../../../content/story/act1/cutscene-refs.ts';
import starts from '../../../config/autoplay/mission-starts.json';
import castFile from '../../../content/story/cast.json';

const missionFiles = import.meta.glob('../../../assets/src/data/mission.m.a1.*/mission.json', { eager: true, import: 'default' }) as Record<string, MissionIR>;
const directorFiles = import.meta.glob('../../../assets/src/data/director.m.a1.*/director.json', { eager: true, import: 'default' }) as Record<string, DirectorScript>;
const lineFiles = import.meta.glob('../../../assets/src/data/lines.1.en/lines.json', { eager: true, import: 'default' }) as Record<string, { text: Record<string, string> }>;

export interface StoryBoot {
  missions: MissionIR[];
  directors: DirectorScript[];
  cutscenes: { id: string; fallback: string }[];
  lines: Record<string, string>;
  /** Display names of the cast by soul id, for the senders of phone messages. */
  names: Record<string, string>;
  autoStart: { lat: number; lng: number; yawDeg: number };
  triggers: boolean;
  [key: string]: unknown;
}

/** `triggers`: the auto start and the start markers are live (always in production; a QA build asks for them with `?story=1`). */
export function storyBoot(triggers: boolean): StoryBoot {
  const lines: Record<string, string> = {};
  for (const f of Object.values(lineFiles)) Object.assign(lines, f.text);
  const names: Record<string, string> = {};
  for (const c of (castFile as { cast: { id: string; name?: string }[] }).cast) if (c.name) names[c.id] = c.name;
  return {
    missions: Object.values(missionFiles),
    directors: Object.values(directorFiles),
    cutscenes: act1Refs.map((r) => ({ id: r.id, fallback: r.fallback })),
    lines,
    names,
    autoStart: { lat: starts.default.lat, lng: starts.default.lng, yawDeg: starts.default.yawDeg },
    triggers,
  };
}
