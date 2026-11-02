import { describe, expect, it } from 'vitest';
import { Anim, EcsWorld, LocalPlayer, Transform } from '@dv/engine/sim';
import { NPC_COMPONENTS } from '../src/brains/components.ts';
import { NpcEntities, type PedBark } from '../src/brains/system.ts';

/**
 * The QA filler and the bark watcher (M06c, BD-FIX-WEBGPU-BARKS-01). The page hands `qa.filler` and `qa.bump` to the sim between ticks, so both
 * can arrive before the filler's spawn is applied; the knock-down must then report that it did nothing, and the watcher barks only for a
 * knock-down it saw happen (standing, then down).
 */
function setup() {
  const ecs = new EcsWorld({ components: [...NPC_COMPONENTS] });
  ecs.definePrefab({ id: 'player', components: [{ def: Transform, init: { qw: 1 } }, { def: LocalPlayer }] });
  ecs.commands.spawn('player', { 'Transform.px': 10, 'Transform.pz': -4 }, 'player:0');
  ecs.flush();
  const entities = new NpcEntities(ecs);
  entities.definePrefab();
  const player = entities.player() as { x: number; z: number };
  const scan = (): PedBark[] => {
    const out: PedBark[] = [];
    entities.scanFillers(player, { talkM: 3, watchM: 25 }, out);
    return out;
  };
  return { ecs, entities, scan };
}

describe('QA filler and the bark watcher', () => {
  it('a knock-down issued before the spawn applies changes nothing and says so', () => {
    const { ecs, entities, scan } = setup();
    const made = entities.spawnQaFiller(300, 2.2);
    expect(made).not.toBeNull();
    const handle = (made as { handle: number }).handle;
    // the spawn is queued: the handle does not resolve, so the bump cannot knock anything down
    expect(entities.setAnim(handle, 12)).toBe(false);
    ecs.flush();
    const id = ecs.resolve(handle as never) as number;
    expect(ecs.store(Anim).state[id]).toBe(0);
    // the watcher's first look sees it standing, and no bark
    expect(scan()).toEqual([]);
    expect(entities.seenAnim(handle)).toBe(0);
    // now the knock-down lands, and the watcher hears exactly one bump
    expect(entities.setAnim(handle, 12)).toBe(true);
    const barks = scan();
    expect(barks.map((b) => b.tag)).toEqual(['bump']);
    expect(barks[0]?.key).toBe('amb:npc-qa:300');
    expect(entities.seenAnim(handle)).toBe(12);
    // still down: no new edge, no new bark
    expect(scan()).toEqual([]);
  });

  it('a pedestrian first seen already down does not bark (the edge rule the spec waits for)', () => {
    const { ecs, entities, scan } = setup();
    const handle = (entities.spawnQaFiller(301, 2.2) as { handle: number }).handle;
    ecs.flush();
    expect(entities.seenAnim(handle)).toBe(-1);
    expect(entities.setAnim(handle, 12)).toBe(true);
    expect(scan()).toEqual([]);
    expect(entities.seenAnim(handle)).toBe(12);
  });
});
