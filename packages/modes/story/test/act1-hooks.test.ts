/**
 * M05c1 AC-4: the racing hook of m.a1.03 and the fighter hook of m.a1.05 on the stub path. The compiled missions are the ones
 * `pnpm missions:build` wrote; the harness is the headless mission world of the other story tests (flat ground, real scheduler, zones
 * and economy, recording fakes for the rest). Each mission is entered at its hook stage and passes twice; the unlock is new once and its
 * ref names the mission and the hook. The unlock registry rows are checked against the real registry: sorted ids, the stand-in fighter.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CoreSlice, MissionIR } from '@dv/shared';
import { Health } from '@dv/engine/sim';
import { describe, expect, it } from 'vitest';
import { UnlockRegistryImpl } from '../../../engine/src/sim/modes/unlocks.ts';
import { racingUnlockDefs } from '../../racing/src/index.ts';
import { storyUnlockDefs } from '../src/index.ts';
import { makeHarness, type Harness } from './harness.ts';

const root = path.resolve(import.meta.dirname, '../../../..');
const load = (id: string): MissionIR => JSON.parse(readFileSync(path.join(root, 'assets/src/data', `mission.${id}`, 'mission.json'), 'utf8')) as MissionIR;
const stageIndex = (ir: MissionIR, id: string): number => ir.stages.findIndex((s) => s.id === id);

function runThrough(h: Harness, ir: MissionIR, attempt: number, drive: (h: Harness) => void): void {
  h.start(ir, { attempt });
  h.step(2);
  h.rt.jumpTo(stageIndex(ir, ir.stages.find((s) => s.objectives.some((o) => o.k === 'mode'))?.id ?? ''));
  h.step(5);
  drive(h);
}

describe('Act 1 hooks on the stub path (AC-4)', () => {
  it('m.a1.03: the raid hook runs the escape stub at heat 2 and emits unlock.racing once, with its ref', () => {
    const ir = load('m.a1.03');
    expect(ir.modeHooks).toHaveLength(1);
    const hook = ir.modeHooks[0]!;
    expect(hook).toMatchObject({ mode: 'racing', defId: 'sf.pursuit.bayview-escape', unlockOnFirstEncounter: 'unlock.racing', retry: 'hook' });
    expect(hook.stub.k).toBe('escape');
    expect(ir.tags).toContain('sideshow');

    const h = makeHarness({ flags: { beats: 'instant' } });
    for (const attempt of [1, 2]) {
      runThrough(h, ir, attempt, (hh) => {
        expect(hh.calls.heat).toContain('set:2:mission');
        hh.pursuit.level = 2;
        hh.pursuit.phase = 'pursuit';
        hh.step(5);
        hh.pursuit.level = 0;
        hh.pursuit.phase = 'clear';
        hh.step(5);
        // the stub is done: the mission moves on to the 240 s trip home
        expect(hh.rt.stage?.id).toBe('home');
        hh.rt.abort('quit');
        hh.step(2);
      });
    }
    const racing = h.calls.unlocks.filter((u) => u.id === 'unlock.racing');
    expect(racing.map((u) => u.isNew)).toEqual([true, false]);
    expect(racing.map((u) => u.src.ref)).toEqual([`m.a1.03:${hook.id}`, `m.a1.03:${hook.id}`]);
    expect(h.calls.children).toHaveLength(2);
  });

  it('m.a1.05: the bout hook runs the defeat stub, pays the $1,000 win bonus only on a win, and emits unlock.fighter once', () => {
    const ir = load('m.a1.05');
    const hook = ir.modeHooks[0]!;
    expect(hook).toMatchObject({ mode: 'fighter', defId: 'bout.a5', params: { kind: 'story' }, passOn: ['win', 'lose'], unlockOnFirstEncounter: 'unlock.fighter' });
    expect(hook.stub).toMatchObject({ k: 'defeat', nonLethal: true, targets: ['sparrer'] });
    expect(ir.unlocks).toEqual(['unlock.fighter.rap_new_wave']);
    expect(ir.rewards).toEqual({ cashCents: 100_000, streetCred: 30 });

    const h = makeHarness({ flags: { beats: 'instant' } });
    for (const attempt of [1, 2]) {
      runThrough(h, ir, attempt, (hh) => {
        const id = hh.ecs.resolve(hh.at(`mis:m.a1.05:sparrer`)) as number;
        const hp = hh.ecs.store(Health);
        hp.hp[id] = 1;
        hp.ko[id] = 1;
        hh.step(8);
        expect(hh.rt.phase).toBe('passed');
      });
    }
    const fighter = h.calls.unlocks.filter((u) => u.id === 'unlock.fighter');
    expect(fighter.map((u) => u.isNew)).toEqual([true, false]);
    expect(fighter[0]?.src.ref).toBe(`m.a1.05:${hook.id}`);
    // the stub is not a bout: nobody won, so the bonus is not paid; the reward of the mission is paid once across both attempts
    expect(h.story.wallet.cashCents).toBe(100_000);
    expect(h.calls.unlocks.filter((u) => u.id === 'unlock.fighter.rap_new_wave')).toHaveLength(2);
  });

  it('the unlock registry: sorted ids, the stand-in fighter, the fighter tile', () => {
    const core = { unlocks: [] as string[] } as unknown as CoreSlice;
    const reg = new UnlockRegistryImpl({
      core: () => core,
      ui: { patch: () => undefined, toast: () => undefined } as never,
      saveUnlock: () => undefined,
      telemetry: { emit: () => undefined },
    });
    reg.register([...racingUnlockDefs(), ...storyUnlockDefs()]);
    expect(reg.emit('unlock.racing', { kind: 'mission', ref: 'm.a1.03:race-a1-sideshow-escape' })).toBe(true);
    expect(reg.emit('unlock.fighter.rap_new_wave', { kind: 'mission', ref: 'm.a1.05' })).toBe(true);
    expect(reg.emit('unlock.fighter', { kind: 'mission', ref: 'm.a1.05:fight-a1-turntable' })).toBe(true);
    expect(reg.emit('unlock.fighter', { kind: 'mission', ref: 'again' })).toBe(false);
    expect(reg.list()).toEqual(['unlock.fighter', 'unlock.fighter.rap_new_wave', 'unlock.racing']);
    const defs = new Map(reg.defs().map((d) => [d.id, d]));
    expect(defs.get('unlock.fighter')?.grants).toEqual({ menuTile: 'fighter' });
    expect(defs.get('unlock.fighter.rap_new_wave')?.grants).toEqual({ fighters: ['standin_rap_new_wave'] });
    for (let n = 1; n <= 10; n++) expect(defs.get(`unlock.district.d${n}`)?.grants).toEqual({ districts: [`d${n}`] });
    // racing's registration holds only racing's rows, the story's holds the rest
    expect(racingUnlockDefs().every((d) => d.id.startsWith('unlock.racing'))).toBe(true);
    expect(storyUnlockDefs().some((d) => d.id.startsWith('unlock.racing'))).toBe(false);
  });
});
