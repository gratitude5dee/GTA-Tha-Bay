/**
 * The data the NPC agency sim module (M06c) is built from, bundled into sim.worker: the roster's public souls, the compiled ink of every
 * soul, the compiled ink of the five filler archetypes, and the stub POI positions. `pnpm npc:build` writes the roster and the ink assets;
 * `import.meta.glob` takes whatever it wrote. The release path will read the same assets from the pack store (M10c); until then a roster
 * change is a rebuild, as for the missions (`story-content.ts`).
 */
import type { CompiledSoulPublic, NpcRosterBundle } from '@dv/shared/contracts/c10-npc';
import type { NpcModuleOptions } from '@dv/npc/sim';
import roster from '../../../../assets/src/data/npc-roster/npc-roster.json';
import stub from '../../../../content/npcs/poi.stub.json';

const soulInk = import.meta.glob('../../../../assets/src/data/ink.*/ink.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const barkInk = import.meta.glob('../../../../content/npcs/barks/*.ink.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function inkByOwner(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, text] of Object.entries(soulInk)) {
    const id = /ink\.([^/]+)\/ink\.json$/.exec(path)?.[1];
    if (id) out[id] = text;
  }
  for (const [path, text] of Object.entries(barkInk)) {
    const arch = /barks\/([a-z]+)\.ink\.json$/.exec(path)?.[1];
    if (arch) out[`archetype:${arch}`] = text;
  }
  return out;
}

export function npcModuleOptions(): NpcModuleOptions {
  return {
    roster: (roster as unknown as NpcRosterBundle).souls as CompiledSoulPublic[],
    ink: inkByOwner(),
    stubPois: (stub as unknown as { positions: Record<string, [number, number]> }).positions,
  };
}
