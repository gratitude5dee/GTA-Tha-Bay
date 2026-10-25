import { describe, expect, it } from 'vitest';
import type { EntityHandle, KillScope } from '@dv/shared';
import type { InteractionContext } from '@dv/engine/sim';
import { INTERACT_KIND } from '@dv/engine/sim';
import type { ScheduleBlock } from '@dv/shared/contracts/c10-npc';
import { BRAIN_CONFIG } from '../src/brains/config.ts';
import { KnotPlayer, type KnotLine } from '../src/brains/mode-context-npc.ts';
import { BrainSim } from '../src/brains/sim.ts';
import { SubtitleLane } from '../src/barks/subtitle-lane.ts';
import { TALK_REASON, TalkHandler, talkVerdict, type TalkTarget } from '../src/brains/talk-handler.ts';
import { HOUR, SEED, makeSoul, workOf, world } from './brain-fixtures.ts';

const block = (from: string, to: string, activity: ScheduleBlock['activity'], interruptible: boolean): ScheduleBlock =>
  ({ days: 'daily', from, to, activity, place: workOf(1) as ScheduleBlock['place'], interruptible, priority: 5 });

function setup(clock: number) {
  const sim = new BrainSim({ seed: SEED, world, cap: 8 });
  // npc_test stands in a lot all day; sleeper sleeps 00:00 to 06:00 (not interruptible) and idles after
  sim.add(makeSoul('npc_test', [block('00:00', '24:00', 'idle', true)]));
  sim.add(makeSoul('sleeper', [block('00:00', '06:00', 'sleep', false), block('06:00', '24:00', 'idle', true)]));
  const killed = new Map<string, KillScope[]>();
  const patches: { k: string; v: unknown }[] = [];
  const events: unknown[] = [];
  const lane = new SubtitleLane({ patch: () => undefined });
  const knots = new KnotPlayer({
    source: { lines: (): KnotLine[] => [{ text: 'Hi', speaker: 'passerby' }, { text: 'Hello', speaker: 'passerby' }] },
    lane,
    cfg: BRAIN_CONFIG.barks,
    events: { emit: (e) => void events.push(e) },
  });
  let target: TalkTarget | null = { kind: 'named', npcId: 'npc_test' };
  const talk = new TalkHandler({
    sim,
    knots,
    cfg: BRAIN_CONFIG.barks,
    clockT: () => clock,
    killed: (id) => killed.get(id) ?? [],
    patch: (k, v) => void patches.push({ k, v }),
    classify: () => target,
  });
  const ctx = { ecs: {}, services: {}, tick: 100 } as unknown as InteractionContext;
  const h = 1 as unknown as EntityHandle;
  return { sim, killed, patches, events, talk, ctx, h, setTarget: (t: TalkTarget | null) => void (target = t) };
}

describe('Talk handler (AC-6)', () => {
  it('is registered for InteractKind.Talk', () => {
    expect(setup(0).talk.kind).toBe(INTERACT_KIND.Talk);
  });

  it('refuses a killed NPC (spawn or all scope) with the killed reason', () => {
    const s = setup(12 * HOUR);
    expect(s.talk.canInteract(s.ctx, s.h, s.h)).toBe(true);
    s.killed.set('npc_test', ['spawn']);
    expect(s.talk.canInteract(s.ctx, s.h, s.h)).toBe(TALK_REASON.killed);
    s.killed.set('npc_test', ['all']);
    expect(s.talk.canInteract(s.ctx, s.h, s.h)).toBe(TALK_REASON.killed);
    // a scope that is not about the world leaves the NPC talkable
    s.killed.set('npc_test', ['voice', 'marketing']);
    expect(s.talk.canInteract(s.ctx, s.h, s.h)).toBe(true);
    s.setTarget(null);
    expect(s.talk.canInteract(s.ctx, s.h, s.h)).toBe(TALK_REASON.killed);
  });

  it('refuses an NPC that is busy in a mission lock, in a conversation, or while its knot plays', () => {
    const s = setup(12 * HOUR);
    s.sim.lock('npc_test', true);
    expect(s.talk.canInteract(s.ctx, s.h, s.h)).toBe(TALK_REASON.busy);
    s.sim.lock('npc_test', false);
    expect(s.talk.canInteract(s.ctx, s.h, s.h)).toBe(true);
    s.talk.begin(s.ctx, s.h, s.h);
    expect(s.talk.canInteract(s.ctx, s.h, s.h)).toBe(TALK_REASON.busy);
    s.sim.endTalk('npc_test', 120);
    expect(s.talk.canInteract(s.ctx, s.h, s.h)).toBe(true);
  });

  it('refuses a sleeper whose block is not interruptible, and talks to it once awake', () => {
    const asleep = setup(3 * HOUR);
    asleep.setTarget({ kind: 'named', npcId: 'sleeper' });
    expect(asleep.talk.canInteract(asleep.ctx, asleep.h, asleep.h)).toBe(TALK_REASON.unavailable);
    const awake = setup(9 * HOUR);
    awake.setTarget({ kind: 'named', npcId: 'sleeper' });
    expect(awake.talk.canInteract(awake.ctx, awake.h, awake.h)).toBe(true);
  });

  it('opens the dialogue panel by patching sys.dialogue.open and puts the brain in Talk', () => {
    const s = setup(12 * HOUR);
    s.talk.begin(s.ctx, s.h, s.h);
    expect(s.patches).toEqual([{ k: 'sys.dialogue.open', v: { npcId: 'npc_test', seq: 1 } }]);
    expect(s.sim.get('npc_test')?.talking).toBe(true);
    // a second press while talking changes nothing
    s.talk.begin(s.ctx, s.h, s.h);
    expect(s.patches).toHaveLength(1);
    // closing and talking again opens it again with a new sequence number
    s.sim.endTalk('npc_test', 130);
    s.talk.begin(s.ctx, s.h, s.h);
    expect(s.patches[1]).toEqual({ k: 'sys.dialogue.open', v: { npcId: 'npc_test', seq: 2 } });
  });

  it('keeps the sim ticking during a conversation: the NPC stops, faces the player and the clock goes on', () => {
    const s = setup(12 * HOUR);
    s.talk.begin(s.ctx, s.h, s.h);
    const a = s.sim.get('npc_test');
    const env = { tick: 0, clockT: 12 * HOUR, player: { x: 3, y: 0, z: 40 }, trust: () => 0 };
    for (let t = 0; t < 300; t++) {
      env.tick = t;
      env.clockT = 12 * HOUR + t;
      s.sim.tick(env);
    }
    expect(a?.talking).toBe(true);
    expect(a?.vx).toBe(0);
    expect(a?.winner).toBe(0);
    expect(s.sim.totalSteps.a).toBeGreaterThan(0);
    // the conversation ends by itself after a minute with nothing to close it
    for (let t = 300; t < 4000; t++) {
      env.tick = t;
      env.clockT = 12 * HOUR + t;
      s.sim.tick(env);
    }
    expect(a?.talking).toBe(false);
    expect(s.sim.takeEvents().some((e) => e.kind === 'talk.end')).toBe(true);
  });

  it('plays a two-line exchange for a filler with no dialogue panel, then cools down', () => {
    const s = setup(12 * HOUR);
    s.setTarget({ kind: 'filler', key: 'amb:c:260', busy: false });
    expect(s.talk.canInteract(s.ctx, s.h, s.h)).toBe(true);
    s.talk.begin(s.ctx, s.h, s.h);
    expect(s.patches).toEqual([]);
    expect(s.talk.canInteract(s.ctx, s.h, s.h)).toBe(TALK_REASON.busy);
    s.setTarget({ kind: 'filler', key: 'amb:c:261', busy: true });
    expect(s.talk.canInteract(s.ctx, s.h, s.h)).toBe(TALK_REASON.busy);
  });
});

describe('talkVerdict', () => {
  it('is pure over the sim, the clock and the kill flags', () => {
    const s = setup(12 * HOUR);
    expect(talkVerdict({ sim: s.sim, npcId: 'npc_test', clockT: 12 * HOUR, killed: [] })).toBe(true);
    expect(talkVerdict({ sim: s.sim, npcId: 'nobody', clockT: 12 * HOUR, killed: [] })).toBe(TALK_REASON.killed);
    expect(talkVerdict({ sim: s.sim, npcId: 'sleeper', clockT: 2 * HOUR, killed: [] })).toBe(TALK_REASON.unavailable);
  });
});
