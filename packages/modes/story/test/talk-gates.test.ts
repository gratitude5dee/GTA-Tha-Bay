/**
 * M05c1 AC-8, sim side: the talk objective of m.a1.04 (the door host) publishes `mode.story.talk` with the outcome buttons and their
 * gates; a gated outcome is off with its hint, an unaffordable bribe is off, the choice arrives as `talk.result` with `path: 'scripted'`, the
 * bribe is paid from the wallet once, and the mission jumps to the stage of the outcome.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { MissionIR } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './harness.ts';

const root = path.resolve(import.meta.dirname, '../../../..');
const ir = JSON.parse(readFileSync(path.join(root, 'assets/src/data/mission.m.a1.04/mission.json'), 'utf8')) as MissionIR;
const lines = (JSON.parse(readFileSync(path.join(root, 'assets/src/data/lines.1.en/lines.json'), 'utf8')) as { text: Record<string, string> }).text;
const DOOR = ir.stages.findIndex((s) => s.id === 'door');

type Choice = { id: string; label: string; enabled: boolean; hint?: string; hintParams?: Record<string, number> };
const panel = (h: Harness): { talkId: string; npc: string; open?: string; choices: Choice[] } | null => h.vm.get('mode.story.talk') as unknown as ReturnType<typeof panel>;

function atDoor(cash: number): Harness {
  const h = makeHarness({ flags: { beats: 'instant' }, lineText: (id) => lines[id] ?? id });
  h.story.wallet.cashCents = cash;
  h.start(ir);
  h.step(2);
  h.rt.jumpTo(DOOR);
  h.step(3);
  return h;
}
const pick = (h: Harness, outcome: string): void => h.rt.command({ name: 'talk.result', talkId: 'door', outcome, turns: 0, path: 'llm' });

describe('the door talk of m.a1.04 (AC-8)', () => {
  it('publishes the outcomes in id order with the opening line; charm and an unaffordable bribe are off with their hints', () => {
    const h = atDoor(10_000);
    const p = panel(h);
    expect(p?.talkId).toBe('door');
    expect(p?.npc).toBe('door_host');
    expect(p?.open).toBe(lines['line.m.a1.04.talk.door.open']);
    expect(p?.choices.map((c) => [c.id, c.enabled, c.hint])).toEqual([
      ['bribe', false, 'talk.gate.cost'],
      ['charm', false, 'talk.gate.mood'],
      ['refuse', true, undefined],
    ]);
    expect(p?.choices[0]?.hintParams).toEqual({ cents: 30_000 });
    expect(p?.choices[1]?.hintParams).toEqual({ need: 5 });
  });

  it('a gated outcome cannot be chosen by a live reply: nothing changes, the panel stays', () => {
    const h = atDoor(10_000);
    pick(h, 'bribe');
    pick(h, 'charm');
    h.step(3);
    expect(h.story.wallet.cashCents).toBe(10_000);
    expect(h.rt.stage?.id).toBe('door');
    expect(panel(h)?.talkId).toBe('door');
  });

  it('with $300 the bribe is on; choosing it pays $300 once and the mission goes to the front stealth stage', () => {
    const h = atDoor(40_000);
    expect(panel(h)?.choices.find((c) => c.id === 'bribe')?.enabled).toBe(true);
    pick(h, 'bribe');
    h.step(3);
    expect(h.story.wallet.cashCents).toBe(10_000);
    expect(h.rt.stage?.id).toBe('sneak_front');
    expect(h.story.flags['a1.04.way']).toBe('bribe');
    expect(h.vm.get('mode.story.talk')).toBeNull();
  });

  it('refuse goes round to the service door; the scripted default of a CI run takes it without a click', () => {
    const h = atDoor(0);
    pick(h, 'refuse');
    h.step(3);
    expect(h.rt.stage?.id).toBe('sneak_service');
    const ci = makeHarness({ flags: { beats: 'instant', talk: 'scripted' }, lineText: (id) => lines[id] ?? id });
    ci.start(ir);
    ci.step(2);
    ci.rt.jumpTo(DOOR);
    ci.step(5);
    expect(ci.rt.stage?.id).toBe('sneak_service');
  });
});
