/**
 * The QA commands of racing (M07a1): `debug.modes` ops `racing.start`, `racing.state`, `racing.cmd`, `racing.quit`, answered as
 * `modes.reply.<id>`. Installed by the QA worker entry only (`apps/web/src/workers/sim.worker.ts` behind `VITE_DV_QA`), so the
 * production sim bundle has none of it (`verify-dist` greps for `modes.reply.`).
 */
import type { RacingQaHandler } from '../sim/module.ts';

export const runRacingQa: RacingQaHandler = (cx, cmd, send) => {
  const reply = (data: unknown): void => send(`modes.reply.${cmd.id}`, data);
  const a = (cmd.args ?? {}) as Record<string, unknown>;
  const s = cx.session;
  switch (cmd.op) {
    case 'racing.start': {
      if (!cx.host) return reply({ ok: false, reason: 'no mode host' });
      const params: Record<string, string | number> = {};
      if (typeof a['raceId'] === 'string') params['defId'] = a['raceId'];
      for (const k of ['vehicle', 'difficulty'] as const) if (typeof a[k] === 'string') params[k] = a[k] as string;
      if (typeof a['timeLimitMs'] === 'number') params['timeLimitMs'] = a['timeLimitMs'];
      return reply(cx.host.startQa('racing', params));
    }
    case 'racing.state':
      return reply(s ? { ok: true, state: s.state(), hud: s.hud(), log: s.log.slice(-24) } : { ok: false, reason: 'no race' });
    case 'racing.cmd': {
      const name = a['name'];
      if (!s || (name !== 'ready' && name !== 'retry' && name !== 'exit')) return reply({ ok: false, reason: 'no race or bad command' });
      s.command(name);
      return reply({ ok: true });
    }
    case 'racing.fill': {
      if (!s || typeof a['amount'] !== 'number') return reply({ ok: false, reason: 'no race or no amount' });
      s.qaFillNitro(a['amount']);
      return reply({ ok: true });
    }
    case 'racing.quit':
      return reply({ ok: cx.host?.quit() ?? false });
    default:
      return reply({ ok: false, reason: `unknown op ${cmd.op}` });
  }
};
