/**
 * `fighter:lint` (FC11): the frame-data lint. Pure functions over parsed JSON, so the tests and the CLI share them.
 * Rules: schema; derived advantage recomputed (and compared with FX3 for the reference kit); startup >= 3; recovery >= 1;
 * boxes inside +-4,000 u; every hit overlaps some hurtbox; reachable inputs; no name collisions; cancel-graph loop search
 * (> 40 hits or > 70 % of health on one touch). The fame-domain rule arrives in M08b1.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import { FB, capsulesOverlap, derivedAdvantage } from '@dv/shared/fight';
import type { Capsule2, FighterDef, FightTuning, HitDef, MoveDef } from '@dv/shared/fight';
import kitSchema from '../../../../shared/src/fight/schema/kit.v1.schema.json';
import tuningSchema from '../../../../shared/src/fight/schema/tuning.v1.schema.json';
import replaySchema from '../../../../shared/src/fight/schema/replay.v1.schema.json';

export type LintRule =
  | 'schema' | 'startup-min' | 'recovery-min' | 'box-bounds' | 'hit-no-overlap' | 'hit-window' | 'unreachable-input'
  | 'name-collision' | 'combo-loop' | 'fx3-reference' | 'cancel-range' | 'spawn-ref' | 'auto-ref' | 'tuning';

export interface LintIssue { rule: LintRule; where: string; message: string }

const BOUND = 4000;

/** FX3 reference table: advHit (null = launch / none) and advBlock per move id of the PLAYER_FIGHTER kit. */
export const FX3_EXPECT: Record<string, { advHit: number | null; advBlock: number | null }> = {
  '5L': { advHit: 4, advBlock: 1 }, '5M': { advHit: 5, advBlock: -1 }, '5H': { advHit: 3, advBlock: -4 },
  '2L': { advHit: 4, advBlock: 2 }, '2M': { advHit: 4, advBlock: -2 }, '2H': { advHit: null, advBlock: -9 },
  skidKick: { advHit: 2, advBlock: -5 }, uplift: { advHit: null, advBlock: -25 }, surge: { advHit: null, advBlock: -31 },
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateKit = ajv.compile(kitSchema);
const validateTuning = ajv.compile(tuningSchema);
const validateReplay = ajv.compile(replaySchema);

function fmt(errors: ErrorObject[] | null | undefined): LintIssue[] {
  return (errors ?? []).map((e) => ({ rule: 'schema' as const, where: e.instancePath || '/', message: `${e.message ?? 'invalid'}${e.params && 'additionalProperty' in e.params ? ` (${String(e.params.additionalProperty)})` : ''}` }));
}

export function lintTuning(json: unknown): LintIssue[] {
  if (!validateTuning(json)) return fmt(validateTuning.errors).map((i) => ({ ...i, rule: 'tuning' as const }));
  const t = json as unknown as FightTuning;
  const out: LintIssue[] = [];
  for (let i = 1; i < t.COMBO_SCALE.length; i++) {
    if ((t.COMBO_SCALE[i] as number) > (t.COMBO_SCALE[i - 1] as number)) out.push({ rule: 'tuning', where: 'COMBO_SCALE', message: 'scaling must not increase' });
  }
  if (t.SCALE_FLOOR > (t.COMBO_SCALE[t.COMBO_SCALE.length - 1] as number)) out.push({ rule: 'tuning', where: 'SCALE_FLOOR', message: 'floor above the last scaling step' });
  if (t.RING !== 32) out.push({ rule: 'tuning', where: 'RING', message: 'the ring is 32 entries (buffer layout)' });
  return out;
}

export function lintReplay(json: unknown): LintIssue[] {
  return validateReplay(json) ? [] : fmt(validateReplay.errors);
}

// ---- helpers -------------------------------------------------------------------------------------------------------
function allMoves(k: FighterDef): MoveDef[] { return [...k.moves, ...k.supers, k.shutdown, k.taunt]; }

function capBounds(c: Capsule2): number { return Math.max(Math.abs(c.x1) + c.r, Math.abs(c.x2) + c.r, Math.abs(c.y1) + c.r, Math.abs(c.y2) + c.r); }

function boundsIssues(k: FighterDef): LintIssue[] {
  const out: LintIssue[] = [];
  const check = (where: string, c: Capsule2): void => { if (capBounds(c) > BOUND) out.push({ rule: 'box-bounds', where, message: `capsule reaches ${capBounds(c)} u (limit ${BOUND})` }); };
  const checkBox = (where: string, b: { x: number; y: number; w: number; h: number }): void => {
    if (Math.max(Math.abs(b.x), Math.abs(b.x + b.w), Math.abs(b.y), Math.abs(b.y + b.h)) > BOUND) out.push({ rule: 'box-bounds', where, message: `box outside +-${BOUND} u` });
  };
  for (const m of allMoves(k)) {
    m.hits.forEach((h, i) => h.hit.boxes.forEach((c, j) => check(`${m.id}.hits[${i}].boxes[${j}]`, c)));
    m.tracks.forEach((t, i) => {
      t.hurt?.forEach((c, j) => check(`${m.id}.tracks[${i}].hurt[${j}]`, c));
      if (t.push) checkBox(`${m.id}.tracks[${i}].push`, t.push);
      if (t.throw) checkBox(`${m.id}.tracks[${i}].throw`, t.throw);
    });
  }
  k.projectiles.forEach((p) => p.hit.boxes.forEach((c, j) => check(`${p.id}.hit.boxes[${j}]`, c)));
  for (const s of ['stand', 'crouch', 'air', 'down'] as const) k.hurtDefault[s].forEach((c, j) => check(`hurtDefault.${s}[${j}]`, c));
  for (const s of ['stand', 'crouch', 'air'] as const) checkBox(`push.${s}`, k.push[s]);
  return out;
}

/** Can a hit ever overlap an opposing hurtbox? Sweeps the opponent from just outside push contact to 6,000 u. */
function reaches(k: FighterDef, boxes: Capsule2[], lowY: number, highY: number, stepY: number): boolean {
  const start = k.push.stand.w;
  for (let d = start; d <= 6000; d += 25) {
    for (let y = lowY; y <= highY; y += stepY) {
      for (const stance of ['stand', 'crouch', 'air', 'down'] as const) {
        for (const hurt of k.hurtDefault[stance]) {
          for (const b of boxes) if (capsulesOverlap(b, 0, y, 1, hurt, d, 0, -1)) return true;
        }
      }
    }
  }
  return false;
}

function hitIssues(k: FighterDef): LintIssue[] {
  const out: LintIssue[] = [];
  for (const m of allMoves(k)) {
    const last = m.startup + m.active - 1;
    m.hits.forEach((h, i) => {
      const where = `${m.id}.hits[${i}]`;
      if (h.from < m.startup || h.from > last) out.push({ rule: 'hit-window', where, message: `live from ${h.from} outside active frames ${m.startup}..${last}` });
      if (i > 0 && h.from <= (m.hits[i - 1] as { from: number }).from) out.push({ rule: 'hit-window', where, message: 'hits must start in increasing frame order' });
      if (h.hit.guard === 'throw') {
        if (!m.tracks.some((t) => t.throw !== undefined)) out.push({ rule: 'hit-no-overlap', where, message: 'a throw needs a throw box track' });
        return;
      }
      if (h.hit.boxes.length === 0) { out.push({ rule: 'hit-no-overlap', where, message: 'a strike needs hit capsules' }); return; }
      const air = m.kind === 'air';
      if (!reaches(k, h.hit.boxes, air ? 0 : 0, air ? 2000 : 0, 200)) out.push({ rule: 'hit-no-overlap', where, message: 'no hurtbox is reachable by this hit on any frame' });
    });
    if (m.hits.length > 0 && m.active < 1) out.push({ rule: 'hit-window', where: m.id, message: 'a move with hits needs at least one active frame' });
  }
  k.projectiles.forEach((p, i) => {
    if (p.behavior === 'orbit' || p.behavior === 'summon') {
      // A drone or crew member carries no hit of its own; what it fires must exist and must itself be a striking projectile.
      for (const id of p.child?.defs ?? []) {
        const c = k.projectiles.find((q) => q.id === id);
        if (c === undefined) out.push({ rule: 'spawn-ref', where: `projectiles[${i}].child`, message: `unknown projectile ${id}` });
        else if (c.behavior === 'orbit' || c.behavior === 'summon') out.push({ rule: 'spawn-ref', where: `projectiles[${i}].child`, message: `${id} is an entity, not a shot` });
      }
      if (p.hit.damage > 0 || p.hit.boxes.length > 0) out.push({ rule: 'hit-window', where: `projectiles[${i}]`, message: 'a drone or crew member does not strike itself' });
      return;
    }
    if (p.hit.boxes.length === 0 || !reaches(k, p.hit.boxes, 0, 2000, 100)) out.push({ rule: 'hit-no-overlap', where: `projectiles[${i}]`, message: 'a projectile hit must reach a hurtbox' });
  });
  return out;
}

function frameIssues(k: FighterDef): LintIssue[] {
  const out: LintIssue[] = [];
  const projIds = new Set(k.projectiles.map((p) => p.id));
  const ids = new Set(allMoves(k).map((m) => m.id));
  for (const m of allMoves(k)) {
    if (m.startup < 3) out.push({ rule: 'startup-min', where: m.id, message: `startup ${m.startup} < 3` });
    if (m.recovery < 1) out.push({ rule: 'recovery-min', where: m.id, message: `recovery ${m.recovery} < 1` });
    const total = m.startup - 1 + m.active + m.recovery;
    m.cancels.forEach((c, i) => {
      if (c.from > c.to || c.to > total) out.push({ rule: 'cancel-range', where: `${m.id}.cancels[${i}]`, message: `window ${c.from}..${c.to} outside the move (${total} frames)` });
    });
    m.spawn?.forEach((s, i) => {
      if (!projIds.has(s.def)) out.push({ rule: 'spawn-ref', where: `${m.id}.spawn[${i}]`, message: `unknown projectile ${s.def}` });
      if (s.frame > total) out.push({ rule: 'spawn-ref', where: `${m.id}.spawn[${i}]`, message: `spawn frame ${s.frame} after the move ends` });
    });
  }
  for (const id of k.autoCombo) if (!ids.has(id)) out.push({ rule: 'auto-ref', where: 'autoCombo', message: `unknown move ${id}` });
  return out;
}

function nameIssues(k: FighterDef): LintIssue[] {
  const out: LintIssue[] = [];
  const seen = new Set<string>(), seenKey = new Set<string>();
  for (const m of allMoves(k)) {
    if (seen.has(m.id)) out.push({ rule: 'name-collision', where: m.id, message: `duplicate move id ${m.id}` });
    seen.add(m.id);
    if (seenKey.has(m.nameKey)) out.push({ rule: 'name-collision', where: m.id, message: `duplicate nameKey ${m.nameKey}` });
    seenKey.add(m.nameKey);
  }
  const p = new Set<string>();
  for (const pr of k.projectiles) { if (p.has(pr.id)) out.push({ rule: 'name-collision', where: pr.id, message: `duplicate projectile id ${pr.id}` }); p.add(pr.id); }
  return out;
}

const SIMPLE_NORMAL_BUTTONS = FB.LP | FB.HP;
const P_GROUP = FB.LP | FB.MP | FB.HP, K_GROUP = FB.LK | FB.MK | FB.HK;

function reachIssues(k: FighterDef): LintIssue[] {
  const out: LintIssue[] = [];
  const patterns = new Map<string, string>();
  let simpleSpecials = 0;
  const simpleSupers = { l2: 0, l3: 0 };
  for (const m of [...k.moves, ...k.supers, k.taunt]) {
    const where = m.id;
    if (m.schemes.length === 0) { out.push({ rule: 'unreachable-input', where, message: 'no scheme can trigger this move' }); continue; }
    const i = m.input;
    if (i.buttons === 0) out.push({ rule: 'unreachable-input', where, message: 'input needs at least one button' });
    if (i.t === 'charge' && i.hold === 1) out.push({ rule: 'unreachable-input', where, message: 'charge hold 1 (down-back) is not supported' });
    if (i.t === 'button' && (i.buttons & (i.buttons - 1)) !== 0) out.push({ rule: 'unreachable-input', where, message: 'a button pattern names one button; use a chord for two' });
    if (i.t === 'chord' && (i.buttons & (i.buttons - 1)) === 0) out.push({ rule: 'unreachable-input', where, message: 'a chord needs two buttons' });
    if (m.ex !== undefined && i.t !== 'motion' && i.t !== 'charge') out.push({ rule: 'unreachable-input', where, message: 'EX needs a motion or charge input' });
    if (m.ex !== undefined && (i.t === 'motion' || i.t === 'charge')) {
      const one = (i.buttons & P_GROUP) === i.buttons || (i.buttons & K_GROUP) === i.buttons;
      if (!one || (i.buttons & (i.buttons - 1)) === 0) out.push({ rule: 'unreachable-input', where, message: 'EX needs two buttons of one type in the input mask' });
    }
    const key = `${m.kind === 'super' ? 's' : m.kind === 'air' ? 'a' : ''}${JSON.stringify(i)}${m.schemes.includes('classic') ? 'c' : ''}`;
    const other = patterns.get(key);
    if (other !== undefined && m.schemes.includes('classic')) out.push({ rule: 'unreachable-input', where, message: `same input as ${other}: unreachable` });
    else if (m.schemes.includes('classic')) patterns.set(key, m.id);
    if (m.schemes.includes('simple')) {
      if ((m.kind === 'normal' || m.kind === 'air' || m.kind === 'command') && (i.t !== 'button' || (i.buttons & ~SIMPLE_NORMAL_BUTTONS) !== 0)) {
        out.push({ rule: 'unreachable-input', where, message: 'Simple reaches normals through L and H (LP and HP) only' });
      }
      if (m.kind === 'special') { simpleSpecials++; if (simpleSpecials > 3) out.push({ rule: 'unreachable-input', where, message: 'Simple has three special slots (SP, SP+6, SP+2)' }); }
      if (m.kind === 'super') { if ((m.hypeCost ?? 0) >= 3000) simpleSupers.l3++; else simpleSupers.l2++; if (simpleSupers.l2 > 1 || simpleSupers.l3 > 1) out.push({ rule: 'unreachable-input', where, message: 'Simple has one L2 and one Showstopper (HY)' }); }
    }
  }
  return out;
}

// ---- combo loop search ---------------------------------------------------------------------------------------------
function strength(m: MoveDef): number {
  const b = m.input.t === 'button' ? m.input.buttons : 0;
  return b & (FB.HP | FB.HK) ? 2 : b & (FB.MP | FB.MK) ? 1 : b & (FB.LP | FB.LK) ? 0 : -1;
}
function stanceOf(m: MoveDef): number { return m.kind === 'air' ? 2 : m.input.t === 'button' && m.input.dir === 2 ? 1 : 0; }

function loopIssues(k: FighterDef, tuning: FightTuning): LintIssue[] {
  const moves = [...k.moves, ...k.supers];
  const edges = new Map<string, string[]>();
  // `string` kits may cancel one special into another, at most STRING_MAX times per touch (the engine counts it): those edges are
  // kept apart so the cycle search ignores them and the path walk spends at most STRING_MAX of them.
  const stringKit = k.gimmick?.id === 'string';
  const sEdges = new Map<string, string[]>();
  for (const m of moves) {
    const to = new Set<string>(), sto = new Set<string>();
    for (const c of m.cancels) {
      if (c.into === 'chain') for (const n of moves) if (n.kind === 'normal' && strength(n) > strength(m) && stanceOf(n) === stanceOf(m)) to.add(n.id);
      if (c.into === 'special') for (const n of moves) if (n.kind === 'special' || n.kind === 'super') (stringKit && m.kind === 'special' && n.kind === 'special' ? sto : to).add(n.id);
      if (c.into === 'super') for (const n of moves) if (n.kind === 'super') to.add(n.id);
    }
    edges.set(m.id, [...to].sort());
    sEdges.set(m.id, [...sto].sort());
  }
  const byId = new Map(moves.map((m) => [m.id, m]));
  const out: LintIssue[] = [];
  // cycle detection (white/grey/black DFS)
  const state = new Map<string, number>();
  let cyc: string | null = null;
  const visit = (id: string, path: string[]): void => {
    if (cyc !== null) return;
    state.set(id, 1);
    for (const n of edges.get(id) ?? []) {
      if (state.get(n) === 1) { cyc = [...path, id, n].join(' > '); return; }
      if (!state.has(n)) visit(n, [...path, id]);
    }
    state.set(id, 2);
  };
  for (const m of moves) if (!state.has(m.id)) visit(m.id, []);
  if (cyc !== null) return [{ rule: 'combo-loop', where: String(cyc), message: `cancel loop: ${String(cyc)} (unbounded hits)` }];
  // longest / heaviest path with scaling
  const maxHealth = k.health;
  let worstHits = 0, worstDmg = 0, worstPath = '';
  const walk = (id: string, hits: number, dmg: number, path: string, strung = 0): void => {
    const m = byId.get(id) as MoveDef;
    let h = hits, d = dmg;
    for (const hh of m.hits) {
      const floor = m.kind === 'super' ? ((m.hypeCost ?? 0) >= 3000 ? tuning.L3_MIN : tuning.L2_MIN) : tuning.SCALE_FLOOR;
      const scale = Math.max(tuning.COMBO_SCALE[Math.min(h, tuning.COMBO_SCALE.length - 1)] as number, floor);
      d += Math.trunc((hh.hit.damage * scale) / 100);
      h++;
    }
    const p = path === '' ? id : `${path} > ${id}`;
    if (h > worstHits) { worstHits = h; if (h > tuning.MAX_COMBO_HITS) worstPath = p; }
    if (d > worstDmg) { worstDmg = d; if (d > 0.7 * maxHealth) worstPath = p; }
    for (const n of edges.get(id) ?? []) walk(n, h, d, p, strung);
    if (strung < 2) for (const n of sEdges.get(id) ?? []) walk(n, h, d, p, strung + 1);
  };
  for (const m of moves) walk(m.id, 0, 0, '');
  if (worstHits > tuning.MAX_COMBO_HITS) out.push({ rule: 'combo-loop', where: worstPath, message: `a touch can reach ${worstHits} hits (limit ${tuning.MAX_COMBO_HITS})` });
  if (worstDmg > 0.7 * maxHealth) out.push({ rule: 'combo-loop', where: worstPath, message: `a touch can do ${worstDmg} damage (> 70 % of ${maxHealth})` });
  return out;
}

// ---- derived table and FX3 -----------------------------------------------------------------------------------------
export interface KitRow {
  id: string; kind: string; startup: number; active: number; recovery: number;
  hitstun: number | null; blockstun: number | null; advHit: number | null; advBlock: number | null; damage: number; guard: string; hitstop: number;
}

export function kitTable(k: FighterDef): KitRow[] {
  return [...k.moves, ...k.supers].map((m) => {
    const first = m.hits[0]?.hit;
    const adv = first ? derivedAdvantage(m, first as HitDef) : { advHit: null, advBlock: null };
    return {
      id: m.id, kind: m.kind, startup: m.startup, active: m.active, recovery: m.recovery,
      hitstun: first && !first.launch && first.guard !== 'throw' ? first.hitstun : null, blockstun: first && first.guard !== 'throw' ? first.blockstun : null,
      advHit: adv.advHit, advBlock: adv.advBlock, damage: m.hits.reduce((s, h) => s + h.hit.damage, 0), guard: first?.guard ?? '-', hitstop: first?.hitstop ?? 0,
    };
  });
}

function fx3Issues(k: FighterDef): LintIssue[] {
  if (k.slot !== 'PLAYER_FIGHTER' || k.kit !== 'player') return [];
  const out: LintIssue[] = [];
  const rows = new Map(kitTable(k).map((r) => [r.id, r]));
  for (const [id, want] of Object.entries(FX3_EXPECT)) {
    const r = rows.get(id);
    if (r === undefined) { out.push({ rule: 'fx3-reference', where: id, message: 'FX3 move missing' }); continue; }
    if (r.advHit !== want.advHit || r.advBlock !== want.advBlock) {
      out.push({ rule: 'fx3-reference', where: id, message: `derived ${String(r.advHit)}/${String(r.advBlock)}, FX3 says ${String(want.advHit)}/${String(want.advBlock)}` });
    }
  }
  return out;
}

/** All rules over one kit. Schema errors stop the rest (the data would not be trustworthy). */
export function lintKit(json: unknown, tuning: FightTuning): LintIssue[] {
  if (!validateKit(json)) return fmt(validateKit.errors);
  const k = json as unknown as FighterDef;
  return [
    ...frameIssues(k), ...boundsIssues(k), ...hitIssues(k), ...reachIssues(k), ...nameIssues(k), ...loopIssues(k, tuning), ...fx3Issues(k),
  ];
}
