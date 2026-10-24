/**
 * M05c2 AC-11: story fast travel. A `fast-travel` request is allowed only outside a mission stage or beat and only into a district whose
 * unlock is held; otherwise the world's teleport policy refuses it as `forbidden-in-mode` with `story.fastTravel.locked` or
 * `story.fastTravel.inMission`. The controller installs the rule on attach and puts the previous policy back on exit.
 */
import type { ModeContext, StorySlice } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { FAST_TRAVEL_MSG, fastTravelDenial, storyTeleportPolicy, unlockedDistricts, type FastTravelPorts } from '../src/fast-travel-policy.ts';
import { StoryController } from '../src/mode.ts';
import { storyUnlockDefs } from '../src/unlock-defs.ts';
import { makeHarness } from './harness.ts';

const defs = storyUnlockDefs();
const districtByX = (x: number): string | null => (x < 0 ? null : x < 1000 ? 'd1' : x < 2000 ? 'd2' : 'd5');

function ports(o: { inMission?: boolean; held?: string[] }): FastTravelPorts {
  const held = new Set(o.held ?? []);
  return { inMission: () => o.inMission === true, districtAt: (x) => districtByX(x), hasUnlock: (id) => held.has(id), defs: () => defs };
}

describe('fastTravelDenial', () => {
  it('refuses inside a mission, whatever the target', () => {
    expect(fastTravelDenial('fast-travel', 10, 0, ports({ inMission: true, held: ['unlock.district.d1'] }))).toBe(FAST_TRAVEL_MSG.inMission);
    expect(FAST_TRAVEL_MSG.inMission).toBe('story.fastTravel.inMission');
  });
  it('refuses a district whose unlock is not held, and a point outside every district', () => {
    expect(fastTravelDenial('fast-travel', 1500, 0, ports({ held: ['unlock.district.d1'] }))).toBe('story.fastTravel.locked');
    expect(fastTravelDenial('fast-travel', -50, 0, ports({ held: ['unlock.district.d1'] }))).toBe('story.fastTravel.locked');
  });
  it('allows an unlocked district outside a mission', () => {
    expect(fastTravelDenial('fast-travel', 10, 0, ports({ held: ['unlock.district.d1'] }))).toBeNull();
    expect(fastTravelDenial('fast-travel', 1500, 0, ports({ held: ['unlock.district.d1', 'unlock.district.d2'] }))).toBeNull();
  });
  it('leaves other teleport kinds to the base policy', () => {
    for (const k of ['sandbox', 'debug', 'respawn', 'xr-comfort']) expect(fastTravelDenial(k, 1500, 0, ports({ inMission: true }))).toBeNull();
  });
  it('collects districts from the grants of the held unlocks only', () => {
    expect([...unlockedDistricts(defs, (id) => id === 'unlock.district.d3' || id === 'unlock.fighter')]).toEqual(['d3']);
  });
});

describe('storyTeleportPolicy', () => {
  it('keeps the base answers and adds the denial; a base denial wins', () => {
    const base = { allowed: () => true, heat: () => 2 };
    const p = storyTeleportPolicy(base, ports({ held: ['unlock.district.d1'] }));
    expect(p.heat()).toBe(2);
    expect(p.deny('fast-travel', { x: 10, z: 0, id: null })).toBeNull();
    expect(p.deny('fast-travel', { x: 1500, z: 0, id: null })).toBe('story.fastTravel.locked');
    const withBase = storyTeleportPolicy({ ...base, deny: () => 'world.teleport.forbidden' }, ports({ held: ['unlock.district.d1'] }));
    expect(withBase.deny('fast-travel', { x: 10, z: 0, id: null })).toBe('world.teleport.forbidden');
  });
});

describe('StoryController', () => {
  it('installs the rule on attach and restores the previous policy on exit', () => {
    const h = makeHarness({ unlocked: ['unlock.district.d1'] });
    const original = { allowed: () => true, heat: () => 0 };
    const world = h.ctx.world as unknown as { teleport: { policy: typeof original & { deny?: unknown } }; query: { districtAt(x: number, z: number): string | null } };
    world.teleport = { policy: original };
    world.query = { districtAt: (x) => districtByX(x) };
    const c = new StoryController({ qa: false, bootConfig: () => ({}) });
    c.attach(h.ctx, h.story as unknown as StorySlice);
    const installed = world.teleport.policy as unknown as { deny(k: string, t: { x: number; z: number; id: null }): string | null };
    expect(installed).not.toBe(original);
    expect(installed.deny('fast-travel', { x: 10, z: 0, id: null })).toBeNull();
    expect(installed.deny('fast-travel', { x: 1500, z: 0, id: null })).toBe('story.fastTravel.locked');
    // a mission in progress closes fast travel
    (c as unknown as { rt: { active: boolean } }).rt = { active: true };
    expect(installed.deny('fast-travel', { x: 10, z: 0, id: null })).toBe('story.fastTravel.inMission');
    (c as unknown as { rt: null }).rt = null;
    c.exit(h.ctx as ModeContext, 'quit');
    expect(world.teleport.policy).toBe(original);
  });
});
