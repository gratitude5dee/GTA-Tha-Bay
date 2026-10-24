import type { ModeRequirements } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { canEmbed, entryProfile } from '../../src/sim/modes/index.ts';
import { fixtureDescriptor, fixtureSim, makeRig, newLog } from './fixture.ts';

const canonical: ModeRequirements = { simProfile: 'canonical', world: 'city', physics: true, xr: 'none', inputContexts: ['menu'], network: 'none' };

describe('embedding and profile switches (C06 rules 2, 3)', () => {
  it('an embed of a canonical mode under a local parent returns false and the hook falls back', async () => {
    const parentLog = newLog();
    const childLog = newLog();
    const rig = makeRig({
      descriptors: [
        fixtureDescriptor('story', { embeddable: false }, fixtureSim(parentLog)),
        fixtureDescriptor('racing', { requires: canonical }, fixtureSim(childLog)),
      ],
    });
    rig.host.start('story');
    await rig.run(2);
    expect(parentLog.lastCtx?.startChild('racing', { seed: 1 })).toBe(false);
    expect(rig.host.stack.depth).toBe(1);
    expect(rig.host.stack.root?.state).toBe('Running');
    expect(childLog.calls).toEqual([]);
  });

  it('canEmbed and entryProfile follow the descriptor', () => {
    const any = fixtureDescriptor('racing', {}, fixtureSim(newLog()));
    const canon = fixtureDescriptor('racing', { requires: canonical }, fixtureSim(newLog()));
    const standaloneCanon = fixtureDescriptor('racing', { standaloneProfile: 'canonical' }, fixtureSim(newLog()));
    expect(canEmbed(any, 'local')).toBe(true);
    expect(canEmbed(any, 'canonical')).toBe(true);
    expect(canEmbed(canon, 'local')).toBe(false);
    expect(canEmbed(canon, 'canonical')).toBe(true);
    expect(canEmbed({ ...any, embeddable: false }, 'local')).toBe(false);
    expect(entryProfile(any, 'local')).toBe('local');
    expect(entryProfile(canon, 'local')).toBe('canonical');
    expect(entryProfile(standaloneCanon, 'local')).toBe('canonical');
  });

  it('a top-level mode with another profile asks for one restart and stays in Loading; it never restarts mid-pursuit', async () => {
    const log = newLog();
    const rig = makeRig({ descriptors: [fixtureDescriptor('racing', { requires: canonical, embeddable: false }, fixtureSim(log))] });
    rig.game.pursuit = true;
    expect(rig.host.start('racing')).toEqual({ ok: false, reason: 'unsafe' });
    expect(rig.restarts).toEqual([]);
    rig.game.pursuit = false;
    expect(rig.host.start('racing')).toEqual({ ok: true, pending: 'restart' });
    expect(rig.restarts).toEqual([{ profile: 'canonical', then: 'racing' }]);
    await rig.run(5);
    expect(rig.host.state).toBe('Loading');
    expect(log.calls).toEqual([]);
  });

  it('an experience starts from story at a safe point: story:auto is saved with modeExit, and story comes back after it', async () => {
    const storyLog = newLog();
    const expLog = newLog();
    const rig = makeRig({ descriptors: [fixtureDescriptor('story', { embeddable: false, saveSlot: 'story:auto' }, fixtureSim(storyLog)), fixtureDescriptor('exp:demo', { embeddable: false }, fixtureSim(expLog))] });
    rig.host.start('story');
    await rig.run(2);
    rig.game.heat = 2;
    expect(rig.host.start('exp:demo')).toEqual({ ok: false, reason: 'unsafe' });
    rig.game.heat = 0;
    expect(rig.host.start('exp:demo')).toEqual({ ok: true });
    expect(rig.posted.some((p) => p.slot === 'story:auto' && p.reason === 'modeExit')).toBe(true);
    expect(rig.host.stack.root?.id).toBe('exp:demo');
    expect(rig.capabilitySet.at(-1)).toBe('exp:demo');
    await rig.run(2);
    rig.host.quit();
    expect(rig.host.stack.root?.id).toBe('story');
    expect(rig.capabilitySet.at(-1)).toBe('story');
  });
});
