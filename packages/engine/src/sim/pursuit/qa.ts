/**
 * The QA commands of the pursuit director (M03c, `debug.pursuit`): the sandbox heat toggles, the scripted switch, reports, the wallet, and
 * the scene helpers that stand a roadblock or a spike strip in front of the car. Loaded by the QA worker entry only
 * (`workers/sim-worker-core.ts`, behind `VITE_DV_QA`), so a production bundle does not contain it. Replies are `pursuit.reply.<id>`.
 */
import { dcos, dsin, type HeatLevel, type InfractionKind } from '@dv/shared';
import { validatePursuitConfig } from './config.ts';
import { MemoryWallet } from './ports.ts';
import type { PursuitQaHandler } from './qa-types.ts';

export const runPursuitQa: PursuitQaHandler = (cx, cmd, send) => {
  if (cmd.t !== 'debug.pursuit') return;
  const reply = (data: unknown): void => send(`pursuit.reply.${cmd.id}`, data);
  if (!cx) {
    reply({ ok: false, reason: 'no-director' });
    return;
  }
  const { director: d, host, wallet, world } = cx;
  const a = cmd.args ?? {};
  switch (cmd.op) {
    case 'setHeat': {
      const l = Number(a['level']);
      if (l >= 0 && l <= 6 && Number.isInteger(l)) d.forceHeat(l as HeatLevel);
      break;
    }
    case 'clear':
      d.forceClear('qa');
      break;
    case 'neverWanted':
      d.setNeverWanted(a['on'] === true);
      break;
    case 'scripted':
      d.setScripted(a['on'] === true);
      break;
    case 'report': {
      const k = String(a['kind'] ?? 'redLightSeen') as InfractionKind;
      const p = host.player();
      if (p) d.report(k, p.pos, (a['witness'] as 'police' | 'robotaxi' | 'ped' | 'heli' | undefined) ?? 'police', Number(a['count'] ?? 1));
      break;
    }
    case 'wallet':
      if (wallet instanceof MemoryWallet && typeof a['cents'] === 'number') wallet.balance = Math.max(0, Math.floor(a['cents']));
      break;
    case 'blockAhead':
    case 'stripAhead': {
      const p = host.player();
      if (p && world) {
        const ahead = Number(a['ahead'] ?? 45);
        const x = p.pos[0] + -dsin(p.yaw) * ahead, z = p.pos[2] + -dcos(p.yaw) * ahead;
        const road = world.graph.nearestEdge(x, z, p.pos[1], 40);
        const out = new Float64Array(4);
        if (road) world.graph.laneCentre({ edge: road.edge, s: road.s, lane: 0 }, out);
        if (road && !Number.isNaN(out[0] as number)) {
          const lp = { x: out[0] as number, y: out[1] as number, z: out[2] as number, yaw: out[3] as number };
          if (cmd.op === 'stripAhead') d.dispatch.qaStrip(lp, cx.tick);
          else d.dispatch.qaBlock(a['heavy'] === true ? 'roadblockHeavy' : 'roadblock2', road.edge, lp, cx.tick);
        }
      }
      break;
    }
    case 'config': {
      // the hot reload of QA builds: a new config object replaces the values at once, or is refused with the paths of its defects
      const r = validatePursuitConfig(a['config']);
      if (!r.ok) {
        reply({ ok: false, reason: 'invalid-config', issues: r.issues });
        return;
      }
      d.setConfig(r.config);
      break;
    }
    case 'state':
      break;
    default:
      reply({ ok: false, reason: 'unknown-op' });
      return;
  }
  const st = d.state();
  const pl = host.player();
  reply({
    ok: true,
    level: st.level, points: st.points, phase: st.phase, cooldown: st.cooldown, searchRadiusM: st.searchRadiusM, units: st.units.length,
    sealedPortals: st.sealedPortals, cap: st.cap, scripted: st.scripted, neverWanted: d.neverWanted, refusals: d.refusals.length,
    cash: wallet.cash(), busts: d.bustCount, escapes: d.escapes, tick: cx.tick, lastFine: d.lastFine, strikes: d.lastStrikes,
    unitRoles: d.dispatch.units.map((u) => u.role), blocks: d.dispatch.activeBlocks.length, strips: d.dispatch.activeStrips.length,
    spawnLog: d.dispatch.spawnLog.length, lost: d.dispatch.lost,
    spawns: d.dispatch.spawnLog.slice(0, 12).map((x) => ({ tick: x.tick, role: x.role, x: x.pos[0], z: x.pos[2] })),
    unitList: d.dispatch.units.map((u) => {
      const v = host.unit(u.id);
      return { id: u.id, role: u.role, mode: u.mode, tactic: u.tactic, x: v ? v.pos[0] : 0, y: v ? v.pos[1] : 0, z: v ? v.pos[2] : 0, speed: v ? v.speed : 0, sees: u.sees };
    }),
    player: pl ? { x: pl.pos[0], z: pl.pos[2], speed: pl.speed } : null,
  });
};
