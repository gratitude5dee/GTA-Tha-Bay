// The nine committed kits as one FrameDataPack, for the gimmick and projectile-behaviour specs (M08b1).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FighterDef, FighterSlotId, FrameDataPack } from '../../src/fight/types.ts';
import type { FightRules, FighterLoadout } from '../../src/fight/buffer.ts';
import { Phase } from '../../src/fight/buffer.ts';
import { buildPack } from '../../src/fight/pack.ts';
import { FightCore } from '../../src/fight/step.ts';
import { Events, RULES, TUNING } from './helpers.ts';
import type { Rig } from './helpers.ts';

const dir = path.resolve(import.meta.dirname, '../../../../content/fighter/kits');
export const KITS: Record<string, FighterDef> = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const k = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as FighterDef;
  KITS[k.slot] = k;
}
export const ROSTER_PACK: FrameDataPack = buildPack(KITS, TUNING);

export const load = (slot: FighterSlotId, scheme: 'classic' | 'simple' = 'classic'): FighterLoadout => ({ slot, fighterId: slot.toLowerCase(), scheme, costume: 0 });

/** A match of two roster kits put straight into the Fight phase. */
export function duel(a: FighterSlotId, b: FighterSlotId, opts: { rules?: Partial<FightRules>; seed?: number } = {}): Rig {
  const sim = new FightCore();
  const buf = sim.init(ROSTER_PACK, { ...RULES, ...opts.rules }, opts.seed ?? 7, [load(a), load(b)]);
  sim.setPhase(buf, Phase.Fight);
  return { sim, buf, ev: new Events() };
}

/** Index of a move id in the compiled kit of side `slot`. */
export function moveIdx(r: Rig, slot: 0 | 1, id: string): number {
  const i = (slot === 0 ? r.sim.c.kit[0] : r.sim.c.kit[1]).moves.findIndex((m) => m.def.id === id);
  if (i < 0) throw new Error(`no move ${id}`);
  return i;
}
