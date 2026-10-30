import { describe, expect, it } from 'vitest';
import { fixtureDescriptor, fixtureSim, makeRig, newLog } from './fixture.ts';

/**
 * `UiCommand save.profile select` in the sim (BD-M04b1-02, BD-FIX-NEWGAME-01): taken only while the host is Idle, refused with the
 * `save.profile.busy` toast otherwise. The page's `selectProfile` (packages/ui/src/pages/saves.tsx) relies on exactly this: it sends a
 * select only once the engine is attached, `sys.profile` is published and `sys.mode` is Idle, so a select it sends is never refused.
 */
describe('save.profile select', () => {
  const rigWith = () => {
    const loaded: string[] = [];
    const log = newLog();
    const rig = makeRig({ builtin: false, descriptors: [fixtureDescriptor('story', { embeddable: false }, fixtureSim(log))], selectProfile: (id) => void loaded.push(id) });
    const toasts = () => rig.ui.takeOutbox()?.toasts ?? [];
    return { rig, loaded, toasts };
  };
  const select = (id: string) => ({ t: 'save.profile' as const, op: 'select' as const, id });

  it('loads the profile at once while the host is Idle, with no toast', () => {
    const { rig, loaded, toasts } = rigWith();
    expect(rig.host.state).toBe('Idle');
    rig.dispatch(select('p'.repeat(32)));
    expect(loaded).toEqual(['p'.repeat(32)]);
    expect(toasts()).toEqual([]);
  });

  it('refuses it with save.profile.busy while a mode loads or runs, and takes it again once the host is Idle', async () => {
    const { rig, loaded, toasts } = rigWith();
    rig.dispatch({ t: 'mode.start', id: 'story' });
    expect(rig.host.state).toBe('Loading');
    rig.dispatch(select('q'.repeat(32)));
    expect(loaded).toEqual([]);
    expect(toasts()).toEqual([{ id: 'save.profile', kind: 'warning', text: 'save.profile.busy' }]);
    await rig.run(2);
    expect(rig.host.state).toBe('Running');
    rig.dispatch(select('q'.repeat(32)));
    expect(loaded).toEqual([]);
    rig.dispatch({ t: 'mode.quit' });
    expect(rig.host.state).toBe('Idle');
    rig.dispatch(select('q'.repeat(32)));
    expect(loaded).toEqual(['q'.repeat(32)]);
  });

  it('ignores a select without an id and the page-side ops (create, rename, delete)', () => {
    const { rig, loaded, toasts } = rigWith();
    rig.dispatch({ t: 'save.profile', op: 'select' });
    rig.dispatch({ t: 'save.profile', op: 'create', name: 'Coast' });
    rig.dispatch({ t: 'save.profile', op: 'rename', id: 'p'.repeat(32), name: 'Coast' });
    rig.dispatch({ t: 'save.profile', op: 'delete', id: 'p'.repeat(32) });
    expect(loaded).toEqual([]);
    expect(toasts()).toEqual([]);
  });
});
