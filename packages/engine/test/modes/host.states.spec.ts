import { describe, expect, it } from 'vitest';
import { fixtureDescriptor, fixtureSim, makeRig, newLog } from './fixture.ts';

/** AC-1: `engine/modes.hostStates`. */
describe('ModeHost states (C06 rule 1)', () => {
  it('walks Idle, Loading, Entering, Running, Exiting, Idle, and suspends the parent while a child runs', async () => {
    const parentLog = newLog();
    const childLog = newLog();
    const rig = makeRig({
      descriptors: [
        fixtureDescriptor('story', { embeddable: false, requires: { simProfile: 'local', world: 'city', physics: false, xr: 'none', inputContexts: ['menu'], network: 'none' } }, fixtureSim(parentLog)),
        fixtureDescriptor('racing', {}, fixtureSim(childLog)),
      ],
    });
    expect(rig.host.state).toBe('Idle');
    expect(rig.host.start('story')).toEqual({ ok: true });
    expect(rig.host.state).toBe('Loading');
    await rig.run(2);
    expect(rig.host.state).toBe('Running');
    expect(rig.host.stack.root?.history).toEqual(['Loading', 'Entering', 'Running']);
    expect(parentLog.calls.slice(0, 2)).toEqual(['enter', 'tick']);

    // a child: the parent is Suspended and only gets suspendedTick; the child ticks
    expect(parentLog.lastCtx?.startChild('racing', { seed: 1 })).toBe(true);
    expect(rig.host.stack.root?.state).toBe('Suspended');
    expect(rig.host.state).toBe('Loading');
    await rig.run(2);
    expect(rig.host.stack.top?.id).toBe('racing');
    expect(rig.host.stack.top?.state).toBe('Running');
    expect(rig.host.stack.root?.state).toBe('Suspended');
    parentLog.calls.length = 0;
    await rig.run(1);
    expect(parentLog.calls).toEqual(['suspendedTick']);
    expect(childLog.calls).toContain('tick');

    // the child ends itself with an event; the parent is Running again and hears about it
    rig.host.stack.top?.ctx.events.emit({ t: 'mode.exit.request', tick: 0, s: 'completed' });
    expect(childLog.calls).toContain('exit:completed');
    expect(rig.host.stack.depth).toBe(1);
    expect(rig.host.stack.root?.state).toBe('Running');
    expect(parentLog.calls).toContain('event:mode.childExit:racing');
    expect(rig.host.stack.root?.history).toEqual(['Loading', 'Entering', 'Running', 'Suspended', 'Running']);

    // mode.quit: the top-level mode exits with 'quit' and the host is Idle
    expect(rig.host.quit()).toBe(true);
    expect(parentLog.calls).toContain('exit:quit');
    expect(rig.host.state).toBe('Idle');
    expect(rig.host.quit()).toBe(false);
  });

  it('refuses a second top-level mode and a third level', async () => {
    const aLog = newLog();
    const bLog = newLog();
    const cLog = newLog();
    const rig = makeRig({
      descriptors: [
        fixtureDescriptor('story', { embeddable: false }, fixtureSim(aLog)),
        fixtureDescriptor('racing', {}, fixtureSim(bLog)),
        fixtureDescriptor('fighter', {}, fixtureSim(cLog)),
      ],
    });
    rig.host.start('story');
    await rig.run(2);
    expect(rig.host.start('sandbox')).toEqual({ ok: false, reason: 'busy' });
    expect(rig.host.start('story')).toEqual({ ok: false, reason: 'busy' });
    expect(aLog.lastCtx?.startChild('racing', { seed: 1 })).toBe(true);
    await rig.run(2);
    // the child may not start a grandchild, and the parent (Suspended) may not start a second child
    expect(bLog.lastCtx?.startChild('fighter', { seed: 2 })).toBe(false);
    expect(aLog.lastCtx?.startChild('fighter', { seed: 2 })).toBe(false);
    expect(rig.host.stack.depth).toBe(2);
  });

  it('quit with a child running exits the child with parentExit first', async () => {
    const aLog = newLog();
    const bLog = newLog();
    const rig = makeRig({ descriptors: [fixtureDescriptor('story', { embeddable: false }, fixtureSim(aLog)), fixtureDescriptor('racing', {}, fixtureSim(bLog))] });
    rig.host.start('story');
    await rig.run(2);
    aLog.lastCtx?.startChild('racing', { seed: 1 });
    await rig.run(2);
    rig.host.quit();
    expect(bLog.calls).toContain('exit:parentExit');
    expect(aLog.calls).toContain('exit:quit');
    expect(rig.host.state).toBe('Idle');
    // telemetry carries registry ids and the exit reason only
    expect(rig.telemetry.filter((t) => t.name === 'mode.exit').map((t) => t.props)).toEqual([{ mode: 'racing', reason: 'parentExit' }, { mode: 'story', reason: 'quit' }]);
    expect(rig.telemetry.filter((t) => t.name === 'mode.enter').map((t) => t.props)).toEqual([{ mode: 'story' }, { mode: 'racing' }]);
  });

  it('a mode whose sim cannot be imported exits with reason error and leaves the host Idle', async () => {
    const rig = makeRig({ descriptors: [fixtureDescriptor('story', { embeddable: false, sim: () => Promise.reject(new Error('chunk failed')) }, fixtureSim(newLog()))] });
    rig.host.start('story');
    await rig.run(3);
    expect(rig.host.state).toBe('Idle');
  });

  it('a sim that throws in tick is exited with reason error', async () => {
    const log = newLog();
    const sim = fixtureSim(log);
    sim.tick = () => {
      throw new Error('boom');
    };
    const rig = makeRig({ descriptors: [fixtureDescriptor('story', { embeddable: false }, sim)] });
    rig.host.start('story');
    await rig.run(3);
    expect(rig.host.state).toBe('Idle');
    expect(log.calls).toContain('exit:error');
  });

  it('rewards go through EconomyApi with the key mode:<id>:<seed>:<tick>, and a fighter win counts fightsWon', async () => {
    const log = newLog();
    log.result = { outcome: 'win', rewards: { cashCents: 2500 } };
    const rig = makeRig({ descriptors: [fixtureDescriptor('fighter', { status: 'available', unlock: null, embeddable: false }, fixtureSim(log))] });
    rig.host.start('fighter');
    await rig.run(2);
    rig.host.quit();
    expect(rig.economy.balance()).toBe(2500);
    expect(rig.economy.ledgerSince(0).map((e) => e.reason)).toEqual(['mode:fighter']);
    expect(rig.slices.core.stats.fightsWon).toBe(1);
  });
});
