/** Test harness: a fake `ModeContext` (the parts the tycoon mode touches) and a scripted run. */
import type { ModeContext, SaveReason, SimEvent } from '@dv/shared';
import type { ChoiceRecord, Command, TycoonContent } from '@dv/shared/tycoon';
import { setupFromSeed } from '@dv/shared/tycoon';
import { TycoonSession, tycoonContent, type SessionEnv, type TycoonView } from '../src/sim/index.ts';

export interface Rig {
  ctx: ModeContext;
  patches: { k: string; v: unknown }[];
  saves: SaveReason[];
  events: SimEvent[];
  tick: { n: number };
}

export function makeRig(): Rig {
  const patches: Rig['patches'] = [];
  const saves: SaveReason[] = [];
  const events: SimEvent[] = [];
  const tick = { n: 0 };
  const ctx = {
    get tick() {
      return tick.n;
    },
    ui: { patch: (k: string, v: unknown) => void patches.push({ k, v }), toast: () => undefined, openApp: () => undefined, closeOverlay: () => undefined },
    save: { request: (r: SaveReason) => void saves.push(r) },
    telemetry: { emit: () => undefined },
    events: { emit: (e: SimEvent) => void events.push(e), on: () => () => undefined },
  } as unknown as ModeContext;
  return { ctx, patches, saves, events, tick };
}

export interface SessionRig {
  session: TycoonSession;
  views: TycoonView[];
  saves: SaveReason[];
}

export function makeSession(seed: number, content: TycoonContent = tycoonContent()): SessionRig {
  const views: TycoonView[] = [];
  const saves: SaveReason[] = [];
  const env: SessionEnv = { content, requestSave: (r) => void saves.push(r), publish: (v) => void views.push(v) };
  const setup = setupFromSeed(seed, { founder: 'engineer', coFounder: false, thesis: 'lean-times' }, content);
  return { session: new TycoonSession(env, setup), views, saves };
}

/** The scripted first 20 weeks: allocation, marketing, a SAFE with the scout fund, crunch on and off. */
export const SCRIPT: Record<number, Command[]> = {
  0: [{ t: 'setAllocation', features: 70, refactor: 20, infra: 10 }],
  2: [{ t: 'setMarketing', perWeek: 10_000 }],
  4: [{ t: 'startRaise', kind: 'safe', targetCents: 5_000_000 }],
  5: [{ t: 'scheduleMeeting', vcId: 'vc-scout-solo' }],
  7: [{ t: 'setCrunch', on: true }],
  12: [{ t: 'setCrunch', on: false }],
};

/**
 * Plays `weeks` weeks of the script at `speed`, ticking the session like the sim does. `midWeekSpeedChange` switches speed once in
 * the middle of week 9. Returns the ticks spent.
 */
export function playScript(r: SessionRig, weeks: number, speed: 1 | 2 | 4, opts: { midWeekSpeedChange?: boolean } = {}): number {
  const s = r.session;
  s.setSpeed(speed);
  let ticks = 0;
  while (s.state.week < weeks && s.state.phase !== 'ended') {
    const w = s.state.week;
    for (const c of SCRIPT[w] ?? []) if (s.choices.every((x) => !(x.week === w && JSON.stringify(x.cmd) === JSON.stringify(c)))) s.submit(c);
    const open = s.state.meetings.find((m) => m.phase === 'offer');
    if (s.state.awaiting === 'meeting' && open) s.submit({ t: 'accept', meetingId: open.id });
    let guard = 0;
    while (s.state.week === w && guard++ < 5000) {
      s.tick();
      ticks++;
      if (opts.midWeekSpeedChange && w === 9 && s.weekTicks === 100) s.setSpeed(speed === 4 ? 1 : 4);
      if (s.state.awaiting !== null) break;
    }
  }
  return ticks;
}

export type { ChoiceRecord };
