/**
 * `pnpm map:races par [<raceId>...] [--check]` (M07a2; 06-racing-data.md 4.2.1 V12): the par of a race is the finish time of the
 * headless canonical bot on it.
 *
 *   map:races par          runs the bot on every race (or the ones named), writes `parSec`, `parBotHash` and the medal times
 *                          (par x 1.25, 1.12, 1.04) into `race.json`
 *   map:races par --check  runs it again and fails when a finish time is not within +-15 % of `parSec` or the bot's end hash is not
 *                          `parBotHash`
 *
 * The bot is `racing.line` in the `racing` scenario (real Rapier, the route corridor as the statics, profile `canonical`, seed
 * 0xC0FFEE), alone on the road, in the reference car of the event's class (D ondine-pico, C kestrel-quill, B brackenridge-rasp,
 * A aurelian-sorrel, S solenne-skip). `parBotHash` is the end hash of that run: the vehicle components at the finish tick and the gate
 * ticks. A pursuit has no finish line: its par is the time the pursuit bot needs to evade (`qa/pursuit-rig.ts`).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { RaceDef, VehicleClass } from '../../../../packages/shared/src/index.ts';
import { runHeadless } from '../../../../packages/modes/racing/src/qa/headless.ts';
import { racingSpec, registerRacingQa } from '../../../../packages/modes/racing/src/qa/index.ts';
import { runPursuitPar } from '../../../../packages/modes/racing/src/qa/pursuit-rig.ts';
import { eventClass } from '../../../../packages/modes/racing/src/sim/results.ts';
import { raceJson } from './compile.ts';
import { RACES_DIR, raceIds } from './cli.ts';

/** The reference car of a class: the car the par bot drives. */
export const PAR_CAR: Record<VehicleClass, string> = {
  D: 'vehicle.ondine-pico', C: 'vehicle.kestrel-quill', B: 'vehicle.brackenridge-rasp', A: 'vehicle.aurelian-sorrel', S: 'vehicle.solenne-skip', R: 'vehicle.halcyon-cormorant',
};

export const PAR_TOLERANCE = 0.15;

export interface ParResult { id: string; ms: number; hash: string; vehicle: string; outcome: string }

/** Runs the par bot on one compiled race. */
export async function parOf(id: string, def: RaceDef, dir = RACES_DIR): Promise<ParResult> {
  const vehicle = PAR_CAR[eventClass(def)];
  if (def.kind === 'pursuit') {
    const r = await runPursuitPar(def, vehicle);
    return { id, ms: r.ms, hash: r.hash, vehicle, outcome: r.outcome };
  }
  registerRacingQa();
  const corridor = new Uint8Array(readFileSync(path.join(dir, id, 'corridor.bin')));
  const base = racingSpec({ raceId: id, vehicle, maxTicks: Math.ceil(((def.routeLenM * (def.laps ?? 1)) / 8) * 60) });
  const spec = { ...base, bot: { ...base.bot, params: { ...base.bot.params, noRivals: true, gradeAware: true } } };
  const run = await runHeadless(spec, corridor);
  const a = run.attempt;
  run.dispose();
  return { id, ms: a ? a.ms : 0, hash: a ? a.endHash : '', vehicle, outcome: a ? (a.outcome === 'dnf' ? `dnf: ${a.reason ?? '?'}` : a.outcome) : 'timeout' };
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

export async function runPar(argv: readonly string[]): Promise<number> {
  const { positionals, values } = parseArgs({ args: [...argv], allowPositionals: true, options: { check: { type: 'boolean', default: false } } });
  const ids = positionals.length > 0 ? positionals : raceIds();
  let code = 0;
  for (const id of ids) {
    const file = path.join(RACES_DIR, id, 'race.json');
    if (!existsSync(file)) {
      console.error(`map:races par: ${id}: no race.json; run pnpm map:races compile`);
      code = 1;
      continue;
    }
    const def = JSON.parse(readFileSync(file, 'utf8')) as RaceDef;
    const r = await parOf(id, def);
    if (r.outcome !== 'finish' && r.outcome !== 'evade') {
      console.error(`map:races par: ${id}: the bot did not finish (${r.outcome}, ${r.vehicle})`);
      code = 1;
      continue;
    }
    const sec = r.ms / 1000;
    if (values.check) {
      const within = def.parSec > 0 && Math.abs(sec - def.parSec) <= PAR_TOLERANCE * def.parSec;
      const same = r.hash === def.parBotHash;
      console.log(`map:races par --check: ${id} bot ${sec.toFixed(1)} s (par ${def.parSec} s, ${(((sec - def.parSec) / def.parSec) * 100).toFixed(1)} %), hash ${r.hash} ${same ? '=' : '!='} ${def.parBotHash}, ${r.vehicle}`);
      if (!within || !same) {
        console.error(`map:races par --check: ${id} ${!within ? 'finish time outside +-15 % of parSec' : ''}${!within && !same ? ' and ' : ''}${!same ? 'end hash differs from parBotHash' : ''}`);
        code = 1;
      }
    } else {
      def.parSec = round1(sec);
      def.parBotHash = r.hash;
      def.medals = [round1(def.parSec * 1.25), round1(def.parSec * 1.12), round1(def.parSec * 1.04)];
      writeFileSync(file, raceJson(def));
      console.log(`map:races par: ${id} bot ${sec.toFixed(1)} s in ${r.vehicle}, hash ${r.hash}, medals ${def.medals.join(' / ')} s`);
    }
  }
  return code;
}
