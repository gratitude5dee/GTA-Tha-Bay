/**
 * Menu model of the mode (FX9): the hub, character and stage select, the pause move list per scheme and the results card, as the
 * JSON the UI draws (`mode.fighter.menu`). Pure functions of the selection; the session owns the state. Sim code under the C02 lint.
 */
import type { FighterDef, InputPattern, MoveDef } from '@dv/shared/fight';
import { derivedAdvantage } from '@dv/shared/fight';
import { ROSTER, STAGES, loadedFighterOf } from './data.ts';
import { disclaimerKey } from './roster.ts';
import type { MenuVm } from './vm.ts';

const BUTTON_NAMES: [number, string][] = [[16, 'LP'], [32, 'MP'], [64, 'HP'], [128, 'LK'], [256, 'MK'], [512, 'HK'], [8192, 'TA']];

function buttons(mask: number): string {
  if (mask === 112) return 'P';
  if (mask === 896) return 'K';
  if (mask === 144) return 'LP+LK';
  const names = BUTTON_NAMES.filter(([bit]) => (mask & bit) !== 0).map(([, n]) => n);
  return names.join('+');
}

/** Classic notation of a pattern (numpad motions), e.g. `236+P`, `2 MP`, `LP+LK`. */
export function classicNotation(p: InputPattern): string {
  switch (p.t) {
    case 'button': return `${p.dir !== undefined && p.dir !== 5 ? `${p.dir} ` : ''}${buttons(p.buttons)}`;
    case 'chord': return buttons(p.buttons);
    case 'motion': return `${p.seq}+${buttons(p.buttons)}`;
    case 'charge': return `[${p.hold}]${p.release}+${buttons(p.buttons)}`;
  }
}

/** Simple-scheme notation of a move: L and H for the normals, SP with a direction for the specials, L+H for the throw, HY for a super. */
export function simpleNotation(def: FighterDef, m: MoveDef): string | null {
  if (!m.schemes.includes('simple')) return null;
  if (m.kind === 'throw') return 'L+H';
  if (m.kind === 'super') return 'HY';
  if (m.kind === 'special') {
    const slot = def.moves.filter((x) => x.kind === 'special' && x.schemes.includes('simple')).findIndex((x) => x.id === m.id);
    return slot === 0 ? 'SP' : slot === 1 ? 'SP+6' : slot === 2 ? 'SP+2' : null;
  }
  if (m.kind === 'taunt') return 'TA';
  const p = m.input;
  if (p.t !== 'button') return null;
  const key = (p.buttons & 64) !== 0 || (p.buttons & 512) !== 0 ? 'H' : 'L';
  return `${p.dir !== undefined && p.dir !== 5 ? `${p.dir} ` : ''}${key}`;
}

export function moveList(def: FighterDef, scheme: 'classic' | 'simple'): MenuVm['moveList'] {
  const out: MenuVm['moveList'] = [];
  for (const m of [...def.moves, ...def.supers]) {
    const input = scheme === 'classic' ? (m.schemes.includes('classic') ? classicNotation(m.input) : null) : simpleNotation(def, m);
    if (input === null) continue;
    const first = m.hits[0];
    const adv = first ? derivedAdvantage(m, first.hit) : { advHit: null, advBlock: null };
    out.push({ id: m.id, nameKey: m.nameKey, input, S: m.startup, A: m.active, R: m.recovery, advHit: adv.advHit, advBlock: adv.advBlock });
  }
  return out;
}

export const fighterRows = (unlocked: readonly string[]): MenuVm['fighters'] =>
  ROSTER.map((r) => {
    const lf = loadedFighterOf(r.id);
    return { id: r.id, nameKey: r.nameKey, locked: !unlocked.includes(r.id), card: lf ? disclaimerKey(lf.tier) : null };
  });

export const stageRows = (): MenuVm['stages'] =>
  Object.values(STAGES).map((s) => ({ id: (s as { id: string }).id, nameKey: (s as { nameKey: string }).nameKey }));
