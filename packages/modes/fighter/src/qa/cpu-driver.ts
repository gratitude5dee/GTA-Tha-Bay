/**
 * The bot drivers of the fighter (M08a2; 13-qa.md 3.2): `fighter.script` (the seeded input script of M08a1, as a `BotDriver`) and
 * `fighter.cpu` (the CPU of FC10 playing a slot through the real input path). A bot acts only through an `InputFrame`, reads only
 * `observe()` and draws randomness only from the run's `bot` stream. QA builds and Node only: registered with `registerBot` from a
 * QA-only import (production chunks must not contain `registerBot`, M04d).
 *
 * `fighter.cpu` params: `slot` (0 or 1, default 0), `level` (0 to 3, default 1), `kit` / `oppKit` (slot ids, defaults the two gray-box
 * kits). The host publishes the match buffer in `observe().fighterBuffer` (an `Int32Array`) and its tick in `observe().fighterTick`;
 * `fighter.cpu` reads only the public state words through `Perception`, never the input rings.
 *
 * Under a story mission with `hooks: 'bot'` the mode itself plays slot 0 with the same `CpuDriver` (`FighterEnterParams.bot`), so no
 * host wiring is needed there; this driver is for the QA suites and the mutant harness.
 */
import type { InputFrame } from '@dv/shared';
import { toInputFrame } from '@dv/shared/fight';
import type { FighterDef, FightTuning } from '@dv/shared/fight';
import { registerBot, registeredBots, type BotContext, type BotDriver } from '@dv/engine/qa';
import { CpuDriver, kitInfo } from '../sim/cpu/index.ts';
import { fighterPack } from '../sim/data.ts';
import { createScriptDriver, type ScriptDriver } from './script-driver.ts';
import type { CpuLevel } from '../types.ts';

export const FIGHTER_CPU_DRIVER_ID = 'fighter.cpu';
export const FIGHTER_SCRIPT_DRIVER_ID = 'fighter.script';

const NEUTRAL = (tick: number): InputFrame => toInputFrame(0, tick, 7);

export function createFighterCpuDriver(): BotDriver {
  let cx: BotContext | null = null;
  let cpu: CpuDriver | null = null;
  return {
    id: FIGHTER_CPU_DRIVER_ID,
    device: 'bot',
    init(ctx, params): void {
      cx = ctx;
      const p = (params ?? {}) as Record<string, unknown>;
      const slot = p['slot'] === 1 ? 1 : 0;
      const level = (p['level'] === 0 || p['level'] === 1 || p['level'] === 2 || p['level'] === 3 ? p['level'] : 1) as CpuLevel;
      const pack = fighterPack();
      const mine = (typeof p['kit'] === 'string' ? p['kit'] : slot === 0 ? 'PLAYER_FIGHTER' : 'RAP_NEW_WAVE');
      const theirs = (typeof p['oppKit'] === 'string' ? p['oppKit'] : slot === 0 ? 'RAP_NEW_WAVE' : 'PLAYER_FIGHTER');
      const kits = pack.kits as unknown as Record<string, FighterDef>;
      const k0 = kits[mine], k1 = kits[theirs];
      if (!k0 || !k1) throw new Error(`fighter.cpu: unknown kit ${mine} / ${theirs}`);
      const seed = Math.trunc(ctx.rng('bot')() * 0x7fffffff);
      cpu = new CpuDriver({ slot, level, seed, kit: kitInfo(k0, pack.tuning as FightTuning), oppKit: kitInfo(k1, pack.tuning as FightTuning) });
    },
    frame(tick): InputFrame {
      const o = cx?.observe() ?? {};
      const buf = o['fighterBuffer'];
      const t = o['fighterTick'];
      if (!cpu || !(buf instanceof Int32Array) || typeof t !== 'number') return NEUTRAL(tick);
      return toInputFrame(cpu.input(buf, t), tick, 7);
    },
    done: () => ({ done: false }),
  };
}

export function createFighterScriptDriver(): BotDriver {
  let d: ScriptDriver | null = null;
  return {
    id: FIGHTER_SCRIPT_DRIVER_ID,
    device: 'bot',
    init(ctx, params): void {
      const p = (params ?? {}) as Record<string, unknown>;
      const seed = typeof p['seed'] === 'number' ? p['seed'] : Math.trunc(ctx.rng('bot')() * 0x7fffffff);
      d = createScriptDriver({ seed, ...(p['facing'] === -1 ? { facing: -1 as const } : {}), ...(typeof p['length'] === 'number' ? { length: p['length'] } : {}) });
    },
    frame: (tick): InputFrame => (d ? d.frame(tick) : NEUTRAL(tick)),
    done: () => ({ done: false }),
  };
}

/** Registers both drivers. Idempotent. */
export function ensureFighterBots(): void {
  const have = registeredBots();
  if (!have.includes(FIGHTER_CPU_DRIVER_ID)) registerBot(FIGHTER_CPU_DRIVER_ID, createFighterCpuDriver);
  if (!have.includes(FIGHTER_SCRIPT_DRIVER_ID)) registerBot(FIGHTER_SCRIPT_DRIVER_ID, createFighterScriptDriver);
}
