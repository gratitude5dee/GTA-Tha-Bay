/**
 * The QA commands of the fighter (M08a2): `debug.modes` ops `fighter.start`, `fighter.state`, `fighter.step`, `fighter.run`,
 * `fighter.inputs`, `fighter.cmd`, `fighter.replay`, `fighter.reload`, `fighter.quit`, answered as `modes.reply.<id>`. Installed by
 * the QA worker entry only (`apps/web/src/workers/sim.worker.ts` behind `VITE_DV_QA`), so the production sim bundle has none of it.
 */
import type { JsonObject } from '@dv/shared';
import { FF, FM, encodeReplay } from '@dv/shared/fight';
import type { FightTuning } from '@dv/shared/fight';
import { reloadTuning } from '../sim/data.ts';
import type { FighterQaHandler } from '../sim/module.ts';
import type { FighterSession } from '../sim/mode.ts';

/** What `fighter.state` answers: enough for a spec to read a frame, a meter or a hash without the DOM. */
export function stateOf(s: FighterSession): Record<string, unknown> {
  const m = s.match;
  const out: Record<string, unknown> = { screen: s.screen, paused: s.paused, sel: s.sel, bot: s.bot, manual: s.manual, result: s.result, stats: s.stats };
  if (!m) return { ok: true, ...out, match: null };
  const [lo, hi] = m.hash();
  const f = (slot: 0 | 1): Record<string, number> => ({
    x: m.w(slot, FF.X), y: m.w(slot, FF.Y), facing: m.w(slot, FF.Facing), state: m.w(slot, FF.State), move: m.w(slot, FF.Move),
    moveFrame: m.w(slot, FF.MoveFrame), hp: m.w(slot, FF.Hp), hype: m.w(slot, FF.Hype), composure: m.w(slot, FF.Composure),
    rattled: m.w(slot, FF.Rattled), combo: m.w(slot, FF.ComboHits), hitstun: m.w(slot, FF.Hitstun), blockstun: m.w(slot, FF.Blockstun),
    hitstop: m.w(slot, FF.Hitstop), invuln: m.w(slot, FF.Invuln),
  });
  return {
    ok: true, ...out,
    match: {
      tick: m.tick, phase: m.phase, phaseFrame: m.phaseFrame, round: m.round, rounds: m.rounds, winner: m.winner, timer: m.buf[FM.Timer],
      hash: [lo, hi], fighters: [f(0), f(1)], build: m.setup.pack.hash.slice(0, 12), training: s.training ? s.training.model(m) : null,
      replay: s.replayModel(),
    },
  };
}

export const runFighterQa: FighterQaHandler = (cx, cmd, send) => {
  const reply = (data: unknown): void => send(`modes.reply.${cmd.id}`, data);
  const a = (cmd.args ?? {}) as Record<string, unknown>;
  const s = cx.session;
  switch (cmd.op) {
    case 'fighter.start': {
      if (!cx.host) return reply({ ok: false, reason: 'no mode host' });
      const params = (a['params'] ?? {}) as JsonObject;
      return reply(cx.host.startQa('fighter', params as never));
    }
    case 'fighter.state':
      return reply(s ? stateOf(s) : { ok: false, reason: 'no fighter session' });
    case 'fighter.step': {
      if (!s) return reply({ ok: false, reason: 'no fighter session' });
      const n = typeof a['n'] === 'number' ? Math.max(0, Math.min(6000, Math.trunc(a['n']))) : 1;
      if (typeof a['i0'] === 'number') s.qaInputs[0] = a['i0'] & 0xffff;
      if (typeof a['i1'] === 'number') s.qaInputs[1] = a['i1'] & 0xffff;
      s.qaStep(n);
      return reply(stateOf(s));
    }
    case 'fighter.run': {
      // Steps the match over the next engine ticks (a replay or a manual match): up to 240 per tick.
      if (!s) return reply({ ok: false, reason: 'no fighter session' });
      s.pendingSteps += typeof a['n'] === 'number' ? Math.max(0, Math.min(1_000_000, Math.trunc(a['n']))) : 0;
      return reply({ ok: true, pending: s.pendingSteps });
    }
    case 'fighter.inputs': {
      if (!s) return reply({ ok: false, reason: 'no fighter session' });
      if (typeof a['i0'] === 'number') s.qaInputs[0] = a['i0'] & 0xffff;
      if (typeof a['i1'] === 'number') s.qaInputs[1] = a['i1'] & 0xffff;
      return reply({ ok: true, inputs: s.qaInputs });
    }
    case 'fighter.cmd': {
      if (!s || typeof a['name'] !== 'string') return reply({ ok: false, reason: 'no fighter session or no command name' });
      s.command(a['name'], (a['args'] ?? null) as JsonObject | null);
      return reply(stateOf(s));
    }
    case 'fighter.replay': {
      const r = s?.match?.exportReplay(typeof a['build'] === 'string' ? a['build'] : 'qa') ?? null;
      return reply(r ? { ok: true, text: encodeReplay(r) } : { ok: false, reason: 'no replay (no match, or Training edited it)' });
    }
    case 'fighter.reload': {
      if (typeof a['tuning'] !== 'object' || a['tuning'] === null) return reply({ ok: false, reason: 'reload needs a tuning object' });
      const pack = reloadTuning(a['tuning'] as unknown as FightTuning);
      return reply({ ok: true, hash: pack.hash });
    }
    case 'fighter.quit':
      return reply({ ok: cx.host?.quit() ?? false });
    default:
      return reply({ ok: false, reason: `unknown op ${cmd.op}` });
  }
};
