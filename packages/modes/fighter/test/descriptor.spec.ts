/** AC-9: the descriptor is an available C06 tile behind `unlock.fighter`, and its unlock rows come from `config/unlocks.json`. */
import { describe, expect, it } from 'vitest';
import { fighterDescriptor, fighterUnlockDefs } from '../src/index.ts';

describe('fighterDescriptor', () => {
  const d = fighterDescriptor();

  it('is available, standalone and embeddable behind unlock.fighter', () => {
    expect(d.id).toBe('fighter');
    expect(d.status).toBe('available');
    expect(d.unlock).toBe('unlock.fighter');
    expect(d.standalone).toBe(true);
    expect(d.embeddable).toBe(true);
    expect(d.saveSlot).toBe('mode:fighter');
    expect(d.sliceSchema).toBe(1);
  });

  it('runs on any sim profile in a stage world with no physics', () => {
    expect(d.requires.simProfile).toBe('any');
    expect(d.requires.world).toBe('stage');
    expect(d.requires.physics).toBe(false);
    expect(d.requires.inputContexts).toContain('fighter');
  });

  it('loads its sim half lazily and the sim half carries the C06 shape', async () => {
    const sim = (await d.sim()).default;
    for (const k of ['enter', 'tick', 'exit', 'saveSlice', 'migrateSlice'] as const) expect(typeof sim[k]).toBe('function');
  });

  it('the unlock rows grant the starter fighters', () => {
    const rows = fighterUnlockDefs();
    const tile = rows.find((r) => r.id === 'unlock.fighter');
    expect(tile?.grants.fighters).toEqual(['player', 'standin_rap_new_wave']);
  });
});
