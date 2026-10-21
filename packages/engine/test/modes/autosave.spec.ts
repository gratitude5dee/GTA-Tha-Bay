import { describe, expect, it } from 'vitest';
import { AUTOSAVE_INTERVAL_TICKS } from '../../src/sim/modes/index.ts';
import { makeRig } from './fixture.ts';

/** AC-5: `engine/modes.autosave`. */
describe('autosave policy (C05 rule 4)', () => {
  it('saves on the 300 s interval, on hidden and on mode exit, and never during a pursuit', async () => {
    const rig = makeRig();
    rig.host.start('story');
    await rig.run(2);
    const reasons = (): string[] => rig.host.autosave.log.map((l) => l.reason);

    // 300 s of free roam at heat 0
    expect(AUTOSAVE_INTERVAL_TICKS).toBe(18_000);
    for (let i = 0; i < 17_990; i++) rig.host.autosave.onTick();
    expect(reasons()).toEqual([]);
    for (let i = 0; i < 20; i++) rig.host.autosave.onTick();
    expect(reasons()).toEqual(['interval']);
    expect(rig.host.autosave.log[0]?.slots).toEqual(['core', 'story:auto']);

    // the page goes hidden (the worker's save.request path asks the same policy)
    expect(rig.host.autosave.request('hidden')).toBe(true);
    expect(reasons()).toEqual(['interval', 'hidden']);

    // a mode exit
    rig.host.quit();
    expect(reasons()).toEqual(['interval', 'hidden', 'modeExit']);

    // a pursuit: nothing, whatever the reason
    rig.host.start('story');
    await rig.run(2);
    const before = rig.host.autosave.log.length;
    rig.game.pursuit = true;
    rig.game.heat = 3;
    for (let i = 0; i < AUTOSAVE_INTERVAL_TICKS + 5; i++) rig.host.autosave.onTick();
    expect(rig.host.autosave.request('hidden')).toBe(false);
    expect(rig.host.autosave.request('interval')).toBe(false);
    expect(rig.host.autosave.collect('hidden')).toBeNull();
    rig.host.quit();
    expect(rig.host.autosave.log.length).toBe(before);
  });

  it('keeps an unlock that arrives in a pursuit and saves it once the game is quiet', async () => {
    const rig = makeRig();
    rig.host.start('story');
    await rig.run(2);
    rig.game.heat = 2;
    rig.unlocks.emit('unlock.racing', { kind: 'debug', ref: '' });
    expect(rig.posted.filter((p) => p.reason === 'unlock')).toEqual([]);
    rig.game.heat = 0;
    rig.host.autosave.onTick();
    expect(rig.posted.filter((p) => p.reason === 'unlock').map((p) => p.slot)).toEqual(['core']);
  });

  it('a mission blocks interval saves but not its checkpoint; settings always save', async () => {
    const rig = makeRig();
    rig.host.start('story');
    await rig.run(2);
    rig.game.mission = true;
    expect(rig.host.autosave.request('interval')).toBe(false);
    expect(rig.host.autosave.request('checkpoint')).toBe(true);
    expect(rig.host.autosave.request('settings')).toBe(true);
  });

  it('writes only the slots the session capability allows: sandbox writes sandbox and never story or core', async () => {
    const rig = makeRig();
    rig.host.start('sandbox');
    await rig.run(2);
    expect(rig.host.autosave.request('manual')).toBe(true);
    expect(rig.posted.map((p) => p.slot)).toEqual(['sandbox']);
    expect(rig.capabilitySet.at(-1)).toBe('sandbox');
  });

  it('hands the save.request handler the slots to write, or null when none is due', async () => {
    const rig = makeRig();
    expect(rig.host.autosave.collect('hidden')).toBeNull();     // nothing runs
    rig.host.start('story');
    await rig.run(2);
    expect(rig.host.autosave.collect('hidden')?.map((e) => e.slot)).toEqual(['core', 'story:auto']);
  });
});
