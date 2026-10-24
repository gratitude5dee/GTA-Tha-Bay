import { describe, expect, it } from 'vitest';
import type { CoreSlice } from '@dv/shared';
import { freshSlices } from '../../src/sim/modes/index.ts';
import { fixtureDescriptor, fixtureSim, makeRig, newLog } from './fixture.ts';

/** AC-2: `engine/modes.unlocks`. */
describe('unlocks on first encounter (R-MODE-05)', () => {
  const setup = () => {
    const parentLog = newLog();
    const childLog = newLog();
    const rig = makeRig({
      descriptors: [
        fixtureDescriptor('story', { embeddable: false, saveSlot: 'story:auto' }, fixtureSim(parentLog)),
        fixtureDescriptor('racing', { unlock: 'unlock.racing' }, fixtureSim(childLog)),
      ],
    });
    return { rig, parentLog, childLog };
  };

  it('the first entry emits once, writes core.unlocks and core.firstEncounters, saves with unlock and toasts once', async () => {
    const { rig, parentLog } = setup();
    rig.host.start('story');
    await rig.run(2);
    expect(rig.unlocks.has('unlock.racing')).toBe(false);
    expect(parentLog.lastCtx?.startChild('racing', { seed: 1, params: { unlockOnFirstEncounter: 'unlock.racing', missionId: 'm.1', hookId: 'h.1' } })).toBe(true);
    await rig.run(2);
    expect(rig.slices.core.unlocks).toEqual(['unlock.racing']);
    expect(typeof rig.slices.core.firstEncounters.racing).toBe('number');
    const saves = rig.posted.filter((p) => p.reason === 'unlock');
    expect(saves.map((p) => p.slot)).toEqual(['core']);
    expect((saves[0]?.data as CoreSlice).unlocks).toEqual(['unlock.racing']);
    expect(rig.telemetry.filter((t) => t.name === 'unlock.emit')).toEqual([{ name: 'unlock.emit', props: { id: 'unlock.racing' } }]);
    const out = rig.ui.takeOutbox();
    expect(out?.toasts.filter((t) => t.kind === 'unlock')).toHaveLength(1);
    const lastUnlockPatch = out?.patches.filter((p) => p.k === 'sys.unlocks').at(-1);
    expect(lastUnlockPatch?.v).toEqual(['unlock.racing']);
  });

  it('a second entry changes nothing', async () => {
    const { rig, parentLog } = setup();
    rig.host.start('story');
    await rig.run(2);
    parentLog.lastCtx?.startChild('racing', { seed: 1, params: { unlockOnFirstEncounter: 'unlock.racing' } });
    await rig.run(2);
    rig.host.exitTop('completed');
    rig.ui.takeOutbox();
    const before = rig.posted.length;
    const first = rig.slices.core.firstEncounters.racing;
    parentLog.lastCtx?.startChild('racing', { seed: 2, params: { unlockOnFirstEncounter: 'unlock.racing' } });
    await rig.run(2);
    expect(rig.slices.core.unlocks).toEqual(['unlock.racing']);
    expect(rig.slices.core.firstEncounters.racing).toBe(first);
    expect(rig.posted.filter((p) => p.reason === 'unlock').length).toBe(1);
    expect(rig.posted.length).toBe(before);
    expect(rig.ui.takeOutbox()?.toasts ?? []).toEqual([]);
  });

  it('emit is idempotent and the unlock survives a reload of the profile', async () => {
    const { rig, parentLog } = setup();
    rig.host.start('story');
    await rig.run(2);
    parentLog.lastCtx?.startChild('racing', { seed: 1, params: { unlockOnFirstEncounter: 'unlock.racing' } });
    await rig.run(2);
    expect(rig.unlocks.emit('unlock.racing', { kind: 'debug', ref: 'x' })).toBe(false);
    // "reload": a new session built from what the save port was handed
    const saved = rig.posted.filter((p) => p.slot === 'core').at(-1)?.data as CoreSlice;
    const slices = freshSlices();
    slices.core = saved;
    const again = makeRig({ slices });
    expect(again.unlocks.has('unlock.racing')).toBe(true);
    expect(again.unlocks.list()).toEqual(['unlock.racing']);
    expect(again.host.list().find((m) => m.id === 'racing')?.unlocked).toBe(true);
  });

  it('keeps the unlock list sorted and unique and calls onUnlocked with the definition', () => {
    const rig = makeRig();
    const heard: string[] = [];
    const off = rig.unlocks.onUnlocked((d) => heard.push(d.id));
    rig.unlocks.emit('unlock.tycoon', { kind: 'debug', ref: '' });
    rig.unlocks.emit('unlock.fighter', { kind: 'debug', ref: '' });
    rig.unlocks.emit('unlock.tycoon', { kind: 'debug', ref: '' });
    off();
    rig.unlocks.emit('unlock.racing', { kind: 'debug', ref: '' });
    expect(rig.slices.core.unlocks).toEqual(['unlock.fighter', 'unlock.racing', 'unlock.tycoon']);
    expect(heard).toEqual(['unlock.tycoon', 'unlock.fighter']);
  });
});
