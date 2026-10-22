/** AC-10 and the C06 conformance of `tycoonSim`: pacing, pause rules, speed independence, the descriptor, `mode.cmd` messages. */
import { describe, expect, it } from 'vitest';
import type { JsonObject, SimEvent } from '@dv/shared';
import { hashCompany, replay } from '@dv/shared/tycoon';
import { tycoonDescriptor, tycoonUnlock } from '../src/index.ts';
import { RUN_KEY, VIEW_KEY, activeTycoon, tycoonContent, tycoonSim, weekThreshold } from '../src/sim/index.ts';
import { makeRig, makeSession, playScript } from './harness.ts';

const content = tycoonContent();

describe('descriptor (C06)', () => {
  it('is the tycoon descriptor: comingSoon, slot mode:tycoon, schema 1, no world, any profile', () => {
    const d = tycoonDescriptor();
    expect(d).toMatchObject({ id: 'tycoon', status: 'comingSoon', saveSlot: 'mode:tycoon', sliceSchema: 1, unlock: 'unlock.tycoon', standalone: true, embeddable: true });
    expect(d.requires).toMatchObject({ world: 'none', physics: false, simProfile: 'any', network: 'none' });
    expect(d.tile).toEqual({ art: 'ui/mode-tycoon', order: 4 });
    expect(tycoonUnlock).toMatchObject({ id: 'unlock.tycoon', source: 'base', grants: { menuTile: 'tycoon' } });
  });
  it('the sim half loads lazily and is the mode', async () => {
    const m = await tycoonDescriptor().sim();
    expect(m.default).toBe(tycoonSim);
  });
  it('config/unlocks.json carries unlock.tycoon', async () => {
    const { default: unlocks } = await import('../../../../config/unlocks.json');
    expect((unlocks as { unlocks: { id: string; grants: { menuTile?: string } }[] }).unlocks.find((u) => u.id === 'unlock.tycoon')?.grants.menuTile).toBe('tycoon');
  });
});

describe('pacing', () => {
  it('a week is 1,200 / 600 / 300 ticks', () => {
    expect([1, 2, 4].map((n) => weekThreshold(content, n as 1 | 2 | 4))).toEqual([1200, 600, 300]);
    for (const [speed, ticks] of [[1, 1200], [2, 600], [4, 300]] as const) {
      const r = makeSession(1);
      r.session.submit({ t: 'setAllocation', features: 70, refactor: 20, infra: 10 });
      r.session.setSpeed(speed);
      for (let i = 0; i < ticks - 1; i++) r.session.tick();
      expect(r.session.state.week).toBe(0);
      r.session.tick();
      expect(r.session.state.week).toBe(1);
    }
  });

  it('the hash at week 20 is identical at 1x, 2x and 4x, also with a speed change in mid-week, and equals the replay of the recorded choices', () => {
    const hashes: string[] = [];
    for (const speed of [1, 2, 4] as const) {
      const r = makeSession(1);
      playScript(r, 20, speed);
      expect(r.session.state.week).toBe(20);
      hashes.push(hashCompany(r.session.state));
      expect(replay(r.session.setup, r.session.choices, content, 20).hash).toBe(hashes[hashes.length - 1]);
    }
    const mid = makeSession(1);
    playScript(mid, 20, 1, { midWeekSpeedChange: true });
    hashes.push(hashCompany(mid.session.state));
    expect(new Set(hashes).size).toBe(1);
    // the script exercised a raise: a meeting held the clock and a SAFE is in flight or closed
    const s = makeSession(1);
    playScript(s, 20, 4);
    expect(s.session.choices.some((c) => c.cmd.t === 'accept')).toBe(true);
    expect(s.session.state.capTable.safes.length).toBe(1);
  });

  it('a paused clock runs no week, and a page that is hidden delivers no ticks at all', () => {
    const r = makeSession(2);
    r.session.submit({ t: 'setAllocation', features: 70, refactor: 20, infra: 10 });
    r.session.paused = true;
    for (let i = 0; i < 5000; i++) r.session.tick();
    expect(r.session.state.week).toBe(0);
    expect(r.session.weekTicks).toBe(0);
    r.session.paused = false;
    // hidden page: no frames, so no calls of tick; nothing moves
    expect(r.session.state.week).toBe(0);
    for (let i = 0; i < 1200; i++) r.session.tick();
    expect(r.session.state.week).toBe(1);
  });

  it('awaiting a meeting holds the clock until a command arrives', () => {
    const r = makeSession(1);
    const s = r.session;
    playScript(r, 5, 4);
    s.submit({ t: 'setAllocation', features: 70, refactor: 20, infra: 10 });
    expect(s.submit({ t: 'scheduleMeeting', vcId: 'vc-scout-solo' })).toMatchObject({ queued: true });
    for (let i = 0; i < 300; i++) s.tick(); // the boundary drains the queue; the offer then holds the clock
    expect(s.state.awaiting).toBe('meeting');
    expect(s.running).toBe(false);
    const week = s.state.week;
    for (let i = 0; i < 6000; i++) s.tick();
    expect(s.state.week).toBe(week);
    expect(s.stepNow()).toBe(false);
    const open = s.state.meetings.find((m) => m.phase === 'offer');
    expect(s.submit({ t: 'accept', meetingId: open?.id ?? '' })).toMatchObject({ ok: true });
    for (let i = 0; i < 300; i++) s.tick(); // speed 4: 300 ticks make one week
    expect(s.state.week).toBe(week + 1);
  });

  it('commands wait for the boundary while the clock runs, and apply at once while it does not', () => {
    const r = makeSession(3);
    const s = r.session;
    s.submit({ t: 'setAllocation', features: 70, refactor: 20, infra: 10 });
    s.setSpeed(4);
    expect(s.submit({ t: 'setCrunch', on: true })).toMatchObject({ ok: true, queued: true });
    expect(s.state.crunch).toBe(false);
    for (let i = 0; i < 300; i++) s.tick();
    expect(s.state.crunch).toBe(true);
    s.paused = true;
    expect(s.submit({ t: 'setCrunch', on: false })).toEqual({ ok: true });
    expect(s.state.crunch).toBe(false);
    expect(s.choices.map((c) => `${c.week}:${c.seq}:${c.cmd.t}`)).toEqual(['0:0:setAllocation', '0:1:setCrunch', '1:0:setCrunch']);
  });

  it('save moments: every 13 weeks, at a round close and at the end of the run', () => {
    const r = makeSession(1);
    playScript(r, 14, 4);
    expect(r.saves.filter((x) => x === 'interval')).toHaveLength(1);
    expect(r.saves).toContain('checkpoint');
    r.session.submit({ t: 'endRun', reason: 'quit' });
    expect(r.saves[r.saves.length - 1]).toBe('checkpoint');
    expect(r.session.state.result?.kind).toBe('quit');
  });

  it('the view model reports the clock, the cap table and the hash', () => {
    const r = makeSession(1);
    playScript(r, 3, 4);
    const v = r.session.view();
    expect(v).toMatchObject({ week: 3, phase: 'mvp', speed: 4, safes: 0, totalFd: 10_000_000 });
    expect(v.hash).toBe(hashCompany(r.session.state));
    expect(v.holders).toEqual([{ id: 'f1', shares: 9_000_000 }]);
    expect(JSON.stringify(v).length).toBeLessThan(2500);
  });
});

describe('tycoonSim as a GameModeSim', () => {
  const msg = (rig: ReturnType<typeof makeRig>, name: string, args?: Record<string, unknown>): void => {
    const e: SimEvent = { t: 'mode.cmd', tick: rig.tick.n, s: JSON.stringify({ mode: 'tycoon', name, args: args ?? null }) };
    tycoonSim.onEvent?.(rig.ctx, e);
  };

  it('enter without a slice has no run; start, cmd, step and abandon go through mode.cmd', () => {
    const rig = makeRig();
    tycoonSim.enter(rig.ctx, { origin: { kind: 'menu' }, seed: 1 }, null);
    expect(activeTycoon()).toBeNull();
    expect(rig.patches[rig.patches.length - 1]).toEqual({ k: VIEW_KEY, v: null });
    msg(rig, 'start', { seed: 7 });
    const s = activeTycoon();
    expect(s?.setup.seed).toBe(7);
    expect(s?.state.phase).toBe('mvp');
    msg(rig, 'cmd', { json: JSON.stringify({ t: 'setPrice', level: 'premium' }) });
    msg(rig, 'cmd', { json: '{not json' });
    expect(s?.lastError).toBe('BAD_JSON');
    msg(rig, 'step');
    msg(rig, 'step');
    expect(s?.state.week).toBe(2);
    msg(rig, 'speed', { n: 4 });
    msg(rig, 'pause', { on: true });
    expect(s?.paused).toBe(true);
    const run = rig.patches.filter((p) => p.k === RUN_KEY).pop()?.v as { choices: unknown[]; total: number };
    expect(run.total).toBe(s?.choices.length);
    const view = rig.patches.filter((p) => p.k === VIEW_KEY).pop()?.v as { week: number; speed: number };
    expect(view).toMatchObject({ week: 2, speed: 4 });
    // other modes' messages are ignored
    tycoonSim.onEvent?.(rig.ctx, { t: 'mode.cmd', tick: 0, s: JSON.stringify({ mode: 'racing', name: 'start', args: null }) });
    msg(rig, 'abandon');
    expect(activeTycoon()).toBeNull();
    const slice = tycoonSim.saveSlice(rig.ctx) as unknown as { active: unknown; runs: { result: { kind: string } }[] };
    expect(slice.active).toBeNull();
    expect(slice.runs[0]?.result.kind).toBe('quit');
    expect(tycoonSim.exit(rig.ctx, 'quit')).toEqual({ outcome: 'quit' });
  });

  it('tick drives the session; exit reports the outcome of a finished run', () => {
    const rig = makeRig();
    tycoonSim.enter(rig.ctx, { origin: { kind: 'menu' }, seed: 1 }, null);
    msg(rig, 'start', { seed: 3 });
    for (let i = 0; i < 1200; i++) tycoonSim.tick(rig.ctx);
    expect(activeTycoon()?.state.week).toBe(1);
    activeTycoon()?.submit({ t: 'endRun', reason: 'quit' });
    const out = tycoonSim.exit(rig.ctx, 'completed');
    expect(out).toMatchObject({ outcome: 'lose', data: { kind: 'quit' } });
  });

  it('enter with autostart params starts a run at once', () => {
    const rig = makeRig();
    tycoonSim.enter(rig.ctx, { origin: { kind: 'menu' }, seed: 9, params: { autostart: true } as JsonObject }, null);
    expect(activeTycoon()?.setup.seed).toBe(9);
    tycoonSim.exit(rig.ctx, 'quit');
  });
});
