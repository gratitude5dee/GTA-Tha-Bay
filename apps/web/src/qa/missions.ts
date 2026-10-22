/**
 * QA builds only (M05a1): the compiled bundle of a mission for `?mission=<id>`, bundled with the page. Reached through a dynamic
 * import behind `VITE_DV_QA === '1'`, so a production dist holds none of it. The mission store (assets by `data/mission.<id>`)
 * replaces this when M05c1 brings the Jobs app and the markers that start a mission.
 */
import sampleMission from '../../../../assets/src/data/mission.m.dev.sample/mission.json';
import sampleDirector from '../../../../assets/src/data/director.m.dev.sample.intro/director.json';
import sampleLines from '../../../../assets/src/data/lines.0.en/lines.json';

export function qaMissionBundle(id: string): Record<string, unknown> | null {
  if (id !== 'm.dev.sample') return null;
  return { id, ir: sampleMission, directors: [sampleDirector], lines: (sampleLines as { text: Record<string, string> }).text };
}
