/**
 * `pnpm --filter @dv/mode-fighter fighter:gen-kits [-- --check]`
 * Writes the seven generated kits of the v1 roster (content/fighter/kits/{rap_hyphy_elder,rap_lyricist,tech_visionary,tech_hacker,
 * ath_shooter,ath_power_back,influencer}.json) from the reference kit (player.json) and the per-kit tables below. The JSON files are the
 * source the game reads; this script is how they were authored and how balance passes change numbers in one place. `--check` fails when a
 * file on disk differs from what the tables produce. rap_new_wave.json (M08a2) is hand-authored and is not touched here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { args } from '../../../../tools/ci/run.ts';
import type { Capsule2, FighterDef, HitDef, MoveDef, ProjectileDef, ProjectileSpawn } from '@dv/shared/fight';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const kitDir = path.join(root, 'content', 'fighter', 'kits');
const base = JSON.parse(readFileSync(path.join(kitDir, 'player.json'), 'utf8')) as FighterDef;

// ---- builders ------------------------------------------------------------------------------------------------------
const cap = (x1: number, y1: number, x2: number, y2: number, r: number): Capsule2 => ({ x1, y1, x2, y2, r });
type HitIn = Partial<HitDef> & { damage: number; boxes: Capsule2[] };
const hit = (o: HitIn): HitDef => ({
  group: 0, chipPermille: 0, hitstun: 20, blockstun: 14, hitstop: 10, pushHit: 200, pushBlock: 300, guard: 'mid', juggle: { cost: 99, limit: 0 },
  hype: { hit: 60, block: 30, whiff: 0 }, fx: { spark: 'special', cue: 'hit.special' }, ...o,
});
const PUNCH = 112, KICK = 896;

interface MoveIn {
  id: string; kind: MoveDef['kind']; input: MoveDef['input']; startup: number; active: number; recovery: number;
  hits?: { from: number; hit: HitDef }[]; invuln?: MoveDef['invuln']; armor?: MoveDef['armor']; motion?: MoveDef['motion'];
  cancels?: MoveDef['cancels']; spawn?: ProjectileSpawn[]; tags?: string[]; hypeCost?: 0 | 1000 | 2000 | 3000; ex?: boolean;
  tracks?: MoveDef['tracks']; simple?: boolean;
}
function move(kit: string, m: MoveIn): MoveDef {
  const out: MoveDef = {
    id: m.id, nameKey: `fighter.${kit}.move.${m.id}`, kind: m.kind, input: m.input, schemes: m.simple === false ? ['classic'] : ['classic', 'simple'],
    startup: m.startup, active: m.active, recovery: m.recovery, hits: m.hits ?? [], tracks: m.tracks ?? [], invuln: m.invuln ?? [],
    cancels: m.cancels ?? [], tags: m.tags ?? [],
  };
  if (m.armor) out.armor = m.armor;
  if (m.motion) out.motion = m.motion;
  if (m.hypeCost) out.hypeCost = m.hypeCost;
  if (m.ex) out.ex = {};
  if (m.spawn) out.spawn = m.spawn;
  return out;
}
const motion = (seq: '236' | '214' | '623' | '22' | '63214' | '41236', buttons: number): MoveDef['input'] => ({ t: 'motion', seq, buttons });
const totalOf = (m: { startup: number; active: number; recovery: number }): number => m.startup - 1 + m.active + m.recovery;

function proj(id: string, p: Partial<ProjectileDef> & { speed: number; life: number; damage: number; boxes?: Capsule2[] }): ProjectileDef {
  const { damage, boxes, ...rest } = p;
  return {
    id, behavior: 'linear', hits: 1, power: 1, ...rest,
    hit: hit({ damage, boxes: boxes ?? [cap(-150, 0, 150, 0, 180)], hitstun: 20, blockstun: 14, hitstop: 10, pushHit: 220, pushBlock: 280, hype: { hit: 50, block: 25, whiff: 0 } }),
  };
}
/** A non-damaging entity (drone, crew member): no hit capsules, so it cannot be hit or clash. */
function ward(id: string, p: Partial<ProjectileDef> & { life: number }): ProjectileDef {
  return { id, behavior: 'orbit', speed: 0, hits: 1, power: 0, ...p, hit: hit({ damage: 0, boxes: [], hitstun: 1, blockstun: 1 }) };
}

/** Three-hit melee super (the shape of the reference Surge), with per-kit damage and reach. */
function rush(kit: string, id: string, seq: '236' | '214', o: { dmg: [number, number, number]; reach: number; invulnTo?: number; armor?: boolean; extra?: Partial<MoveIn> }): MoveDef {
  const bx = (x2: number, y2: number, r: number): Capsule2[] => [cap(350, y2 - 100, x2, y2, r)];
  const mk = (damage: number, group: number, x2: number, launch?: HitDef['launch']): HitDef => hit({
    damage, group, boxes: bx(x2, 1100, 230), chipPermille: 150, hitstun: launch ? 0 : 24, blockstun: 20, hitstop: 8, pushHit: 150, pushBlock: 250,
    hype: { hit: 0, block: 0, whiff: 0 }, fx: { spark: 'super', cue: 'hit.super' }, ...(launch ? { launch, juggle: { cost: 1, limit: 2 } } : {}),
  });
  return move(kit, {
    id, kind: 'super', input: motion(seq, PUNCH), startup: 6, active: 14, recovery: 38, hypeCost: 2000,
    hits: [
      { from: 6, hit: mk(o.dmg[0], 0, o.reach) },
      { from: 10, hit: mk(o.dmg[1], 1, o.reach + 50) },
      { from: 14, hit: mk(o.dmg[2], 2, o.reach + 150, { vx: 12, vy: 120, kd: 'hard' }) },
    ],
    invuln: [{ from: 1, to: o.invulnTo ?? 10, kind: 'all' }],
    ...(o.armor ? { armor: { from: 1, to: 20, hits: 1 } } : {}),
    tags: ['super'], ...o.extra,
  });
}
/** Single big hit Showstopper (3,000 Hype, 3,200 at 50 % minimum scale). */
function showstopper(kit: string, id: string, o: { reach?: number; extra?: Partial<MoveIn>; armor?: boolean } = {}): MoveDef {
  const r = o.reach ?? 1300;
  return move(kit, {
    id, kind: 'super', input: motion('214', PUNCH), startup: 8, active: 6, recovery: 30, hypeCost: 3000,
    hits: [{ from: 8, hit: hit({
      damage: 3200, boxes: [cap(350, 1000, r, 1500, 300)], chipPermille: 200, hitstun: 0, blockstun: 24, hitstop: 12, pushHit: 400, pushBlock: 400,
      launch: { vx: 14, vy: 130, kd: 'hard' }, juggle: { cost: 1, limit: 2 }, hype: { hit: 0, block: 0, whiff: 0 }, fx: { spark: 'super', cue: 'hit.super' },
    }) }],
    invuln: [{ from: 1, to: 12, kind: 'all' }], tags: ['showstopper'], ...(o.armor ? { armor: { from: 1, to: 14, hits: 1 } } : {}), ...o.extra,
  });
}
/** A super that throws a multi-hit projectile wall instead of striking. */
function waveSuper(kit: string, id: string, projId: string, o: { startup?: number }): MoveDef {
  const s = o.startup ?? 8;
  return move(kit, {
    id, kind: 'super', input: motion('236', PUNCH), startup: s, active: 1, recovery: 40, hypeCost: 2000,
    invuln: [{ from: 1, to: s + 2, kind: 'all' }], spawn: [{ frame: s, def: projId, ox: 650, oy: 1100 }], tags: ['super'],
  });
}

// ---- normals -------------------------------------------------------------------------------------------------------
interface NormalTune { S?: number; R?: number; dmg?: number; reach?: number; hitstun?: number }
function normals(kit: string, tune: Record<string, NormalTune>, gimmickCancels: boolean): MoveDef[] {
  const out: MoveDef[] = [];
  for (const m of base.moves) {
    if (m.kind === 'special' || m.id === 'throw') continue;
    const t = tune[m.id] ?? {};
    const c = JSON.parse(JSON.stringify(m)) as MoveDef;
    const dS = (t.S ?? m.startup) - m.startup, dR = (t.R ?? m.recovery) - m.recovery;
    c.nameKey = `fighter.${kit}.move.${m.id}`;
    c.startup = m.startup + dS; c.recovery = m.recovery + dR;
    const total = totalOf(c);
    c.hits = c.hits.map((h) => {
      const hh = h.hit;
      if (t.dmg !== undefined) hh.damage = Math.round((hh.damage * t.dmg) / 100 / 5) * 5;
      if (t.hitstun !== undefined && hh.hitstun > 0) hh.hitstun += t.hitstun;
      if (t.reach !== undefined) hh.boxes = hh.boxes.map((b) => ({ ...b, x2: Math.round((b.x2 * (t.reach as number)) / 100) }));
      return { from: h.from + dS, hit: hh };
    });
    c.cancels = c.cancels.map((k) => ({ ...k, from: k.from + dS, to: Math.min(total, k.to + dS + dR) }));
    void gimmickCancels;
    out.push(c);
  }
  const th = JSON.parse(JSON.stringify(base.moves.find((m) => m.id === 'throw'))) as MoveDef;
  th.nameKey = `fighter.${kit}.move.throw`;
  const tt = tune.throw ?? {};
  if (tt.dmg !== undefined) for (const h of th.hits) h.hit.damage = Math.round((h.hit.damage * tt.dmg) / 100 / 5) * 5;
  out.push(th);
  return out;
}

/** The special-cancel window of a special (the string gimmick). */
const stringCancel = (m: MoveIn): MoveDef['cancels'] => [{ into: 'special', on: ['hit', 'block'], from: m.startup, to: Math.min(totalOf(m), m.startup + m.active + 4) }];

interface Spec {
  slot: FighterDef['slot']; kit: string; archetype: string; health: number; walk: { f: number; b: number };
  tune: Record<string, NormalTune>;
  specials: MoveDef[]; supers: MoveDef[]; projectiles: ProjectileDef[];
  gimmick: NonNullable<FighterDef['gimmick']>;
  shutdownTags: string[]; ai: FighterDef['ai'];
  dash?: FighterDef['dash'];
}

const HABITS_STD = ['walk_in', 'poke_neutral', 'block_reach', 'anti_air', 'punish_unsafe', 'throw_close', 'fireball_zone', 'heavy_bait', 'dash_in', 'jump_in', 'super_spend'];
/** The kit's six signature habits, then Check and Clear (so Hard, with eight, has them), then the rest in the default order: twelve in all. */
const habits = (first: string[]): string[] => [...first, 'check_parry', ...HABITS_STD.filter((h) => !first.includes(h))].slice(0, 12);

// ---- the seven kits -----------------------------------------------------------------------------------------------
function hyphy(): Spec {
  const kit = 'rap_hyphy_elder';
  const slang = move(kit, { id: 'slangWave', kind: 'special', input: motion('236', PUNCH), startup: 15, active: 1, recovery: 32, ex: true, spawn: [{ frame: 15, def: 'slang', ox: 700, oy: 1100 }], tags: ['sigil'] });
  const skid = move(kit, {
    id: 'skidDash', kind: 'special', input: motion('214', KICK), startup: 10, active: 7, recovery: 20, ex: true, tags: ['dash'],
    hits: [{ from: 10, hit: hit({ damage: 650, boxes: [cap(300, 150, 700, 150, 180)], guard: 'low', hitstun: 24, blockstun: 17, pushHit: 180 }) }],
    motion: [{ frame: 1, vx: 105, vy: 0 }, { frame: 17, vx: 0, vy: 0 }],
    tracks: [{ from: 1, to: 17, hurt: [cap(0, 200, 0, 950, 260)] }],
  });
  const frenzy = move(kit, { id: 'frenzy', kind: 'special', input: motion('22', PUNCH), startup: 16, active: 1, recovery: 12, hypeCost: 1000, tags: ['install'] });
  return {
    slot: 'RAP_HYPHY_ELDER', kit, archetype: 'rushdown', health: 9500, walk: { f: 80, b: 58 },
    tune: { '5L': { S: 3, dmg: 100 }, '5M': { S: 5 }, '2L': { S: 3 }, '5H': { S: 11 } },
    specials: [slang, skid, frenzy],
    supers: [
      rush(kit, 'turfRush', '236', { dmg: [600, 700, 900], reach: 1000 }),
      showstopper(kit, 'overdrive'),
    ],
    projectiles: [
      proj('slang', { behavior: 'sine', speed: 36, life: 110, damage: 600, sine: { amp: 380, period: 56 } }),
      proj('slang:ex', { behavior: 'sine', speed: 48, life: 110, damage: 600, hits: 2, power: 2, sine: { amp: 380, period: 56 } }),
    ],
    gimmick: { id: 'frenzy', params: { frames: 360, walkPct: 125, startupCut: 2 } },
    shutdownTags: ['finisher', 'sigil'],
    ai: { aggression: 75, zoning: 25, antiAir: 40, throwRate: 30, blockRate: 45, shutdownRate: 60, reaction: [12, 26], habits: habits(['walk_in', 'poke_neutral', 'dash_in', 'block_reach', 'jump_in', 'throw_close']) },
  };
}

function lyricist(): Spec {
  const kit = 'rap_lyricist';
  const sal: MoveIn = { id: 'wordSalvo', kind: 'special', input: motion('236', PUNCH), startup: 15, active: 1, recovery: 30, ex: true, tags: ['bubble'], spawn: [{ frame: 15, def: 'salvo', ox: 650, oy: 1100 }] };
  const rew: MoveIn = {
    id: 'rewind', kind: 'special', input: motion('214', KICK), startup: 8, active: 1, recovery: 24, ex: true, tags: ['hop'],
    motion: [{ frame: 1, vx: -42, vy: 55 }, { frame: 7, vx: -42, vy: -55 }, { frame: 13, vx: 0, vy: 0 }],
    spawn: [{ frame: 5, def: 'blot', ox: 300, oy: 700 }],
  };
  const hs: MoveIn = {
    id: 'hardStop', kind: 'special', input: motion('623', PUNCH), startup: 5, active: 9, recovery: 28, ex: true, tags: ['antiair'],
    hits: [{ from: 5, hit: hit({ damage: 900, boxes: [cap(300, 900, 600, 1800, 250)], hitstun: 0, blockstun: 14, hitstop: 12, pushHit: 0, pushBlock: 300, launch: { vx: 10, vy: 110, kd: 'hard' }, juggle: { cost: 1, limit: 3 } }) }],
    invuln: [{ from: 1, to: 7, kind: 'strike' }], motion: [{ frame: 1, vx: 12, vy: 0 }, { frame: 9, vx: 0, vy: 0 }],
  };
  const specials = [sal, rew, hs].map((m) => move(kit, { ...m, cancels: stringCancel(m) }));
  return {
    slot: 'RAP_LYRICIST', kit, archetype: 'zoner-string', health: 10000, walk: { f: 62, b: 48 },
    tune: { '5H': { S: 11, reach: 110 }, '2M': { reach: 108 } },
    specials,
    supers: [waveSuper(kit, 'wallOfWords', 'wall', { startup: 9 }), showstopper(kit, 'finalDraft')],
    projectiles: [
      proj('salvo', { speed: 30, life: 100, damage: 250, hits: 3 }),
      proj('salvo:ex', { speed: 38, life: 100, damage: 250, hits: 3, power: 2 }),
      proj('blot', { speed: 22, life: 70, damage: 500, boxes: [cap(-120, 0, 120, 0, 170)] }),
      proj('blot:ex', { speed: 30, life: 70, damage: 500, power: 2, hits: 2 }),
      proj('wall', { speed: 20, life: 72, damage: 420, hits: 4, power: 3, boxes: [cap(-200, -200, 200, 700, 260)] }),
    ],
    gimmick: { id: 'string', params: { max: 2 } },
    shutdownTags: ['finisher', 'line'],
    ai: { aggression: 35, zoning: 75, antiAir: 55, throwRate: 15, blockRate: 55, shutdownRate: 60, reaction: [12, 26], habits: habits(['walk_in', 'fireball_zone', 'block_reach', 'anti_air', 'poke_neutral', 'punish_unsafe']) },
  };
}

function visionary(): Spec {
  const kit = 'tech_visionary';
  const disp = move(kit, { id: 'dispatchAgent', kind: 'special', input: motion('236', PUNCH), startup: 14, active: 1, recovery: 24, tags: ['drone'], spawn: [{ frame: 14, def: 'agent', ox: 0, oy: 0 }] });
  const piv = move(kit, {
    id: 'pivot', kind: 'special', input: motion('214', KICK), startup: 10, active: 1, recovery: 16, hypeCost: 1000, tags: ['teleport', 'once'],
    invuln: [{ from: 1, to: 12, kind: 'all' }],
  });
  const rec = move(kit, {
    id: 'recall', kind: 'special', input: motion('623', PUNCH), startup: 12, active: 1, recovery: 16, tags: ['shield'],
    armor: { from: 1, to: 24, hits: 1 }, spawn: [{ frame: 6, def: 'agent:trigger', ox: 0, oy: 0 }],
  });
  const roadmap = rush(kit, 'roadmapRush', '236', { dmg: [550, 650, 850], reach: 950, extra: { spawn: [{ frame: 6, def: 'crew', ox: 350, oy: 800 }], tags: ['super', 'crew'] } });
  return {
    slot: 'TECH_VISIONARY', kit, archetype: 'setplay-drones', health: 10000, walk: { f: 60, b: 46 },
    tune: { '5M': { S: 7 }, '2M': { S: 8 } },
    specials: [disp, piv, rec],
    supers: [roadmap, showstopper(kit, 'hardPivot')],
    projectiles: [
      ward('agent', { behavior: 'orbit', life: 900, orbit: { radius: 650, period: 128, height: 1500 }, child: { defs: ['agentShot'], every: 48, first: 24 } }),
      ward('agent:trigger', { behavior: 'orbit', life: 1 }),
      ward('crew', { behavior: 'summon', life: 150, summon: { moveSet: 'crewVolley', hypeCost: 0 }, child: { defs: ['crewShot', 'crewShot'], every: 24, first: 18 } }),
      proj('agentShot', { behavior: 'sine', speed: 34, life: 70, damage: 300, sine: { amp: 160, period: 32 }, boxes: [cap(-100, 0, 100, 0, 150)] }),
      proj('crewShot', { speed: 42, life: 60, damage: 350, boxes: [cap(-120, 0, 120, 0, 170)] }),
    ],
    gimmick: { id: 'agents', params: { maxDrones: 2 } },
    shutdownTags: ['finisher', 'paper'],
    ai: { aggression: 45, zoning: 60, antiAir: 45, throwRate: 20, blockRate: 55, shutdownRate: 60, reaction: [12, 26], habits: habits(['walk_in', 'fireball_zone', 'block_reach', 'poke_neutral', 'anti_air', 'punish_unsafe']) },
  };
}

function hacker(): Spec {
  const kit = 'tech_hacker';
  const patch = move(kit, {
    id: 'patch', kind: 'special', input: motion('236', PUNCH), startup: 26, active: 3, recovery: 18, tags: ['counter', 'stance'],
    armor: { from: 1, to: 25, hits: 1 },
    hits: [{ from: 26, hit: hit({ damage: 950, boxes: [cap(300, 900, 950, 1200, 250)], hitstun: 24, blockstun: 16, hitstop: 12, pushHit: 300, launch: { vx: 10, vy: 90, kd: 'soft' }, juggle: { cost: 1, limit: 1 } }) }],
  });
  const glitch = move(kit, {
    id: 'glitchStep', kind: 'special', input: motion('214', KICK), startup: 9, active: 3, recovery: 14, ex: true, tags: ['feint', 'advance'],
    motion: [{ frame: 3, vx: 100, vy: 0 }, { frame: 9, vx: 0, vy: 0 }],
    hits: [{ from: 9, hit: hit({ damage: 550, boxes: [cap(300, 700, 700, 800, 200)], hitstun: 23, blockstun: 16 }) }],
  });
  const echo = move(kit, { id: 'echo', kind: 'special', input: motion('623', PUNCH), startup: 16, active: 1, recovery: 30, ex: true, tags: ['copy'], spawn: [{ frame: 16, def: 'echo', ox: 650, oy: 1100 }] });
  return {
    slot: 'TECH_HACKER', kit, archetype: 'counter-feint', health: 10000, walk: { f: 68, b: 52 },
    tune: { '5L': { S: 4 }, '2L': { S: 4 }, '5H': { S: 11 }, '2H': { S: 10 } },
    specials: [patch, glitch, echo],
    supers: [rush(kit, 'hotfixBarrage', '236', { dmg: [600, 700, 900], reach: 1000 }), showstopper(kit, 'rollback')],
    projectiles: [
      proj('echo', { speed: 40, life: 80, damage: 420 }),
      proj('echo:ex', { speed: 52, life: 80, damage: 420, power: 2, hits: 2 }),
    ],
    gimmick: { id: 'patch', params: { counterFrames: 24 } },
    shutdownTags: ['finisher', 'panel'],
    ai: { aggression: 50, zoning: 40, antiAir: 50, throwRate: 30, blockRate: 55, shutdownRate: 60, reaction: [12, 26], habits: habits(['walk_in', 'poke_neutral', 'block_reach', 'punish_unsafe', 'anti_air', 'throw_close']) },
  };
}

function shooter(): Spec {
  const kit = 'ath_shooter';
  const arcShot = move(kit, { id: 'arcShot', kind: 'special', input: motion('236', PUNCH), startup: 16, active: 1, recovery: 26, tags: ['charge', 'gumball'], spawn: [{ frame: 16, def: 'arc1', ox: 600, oy: 1300 }] });
  const fade = move(kit, {
    id: 'backstepFade', kind: 'special', input: motion('214', KICK), startup: 12, active: 1, recovery: 12, tags: ['evade'],
    invuln: [{ from: 1, to: 10, kind: 'strike' }], motion: [{ frame: 1, vx: -48, vy: 0 }, { frame: 13, vx: 0, vy: 0 }],
  });
  const lob = move(kit, { id: 'lobCover', kind: 'special', input: motion('22', PUNCH), startup: 14, active: 1, recovery: 26, tags: ['lob'], spawn: [{ frame: 14, def: 'lob', ox: 450, oy: 1200 }] });
  const triple = move(kit, {
    id: 'tripleArc', kind: 'super', input: motion('236', PUNCH), startup: 8, active: 1, recovery: 40, hypeCost: 2000, invuln: [{ from: 1, to: 10, kind: 'all' }], tags: ['super'],
    spawn: [{ frame: 8, def: 'arc2', ox: 600, oy: 1300 }, { frame: 14, def: 'arc2', ox: 600, oy: 1300 }, { frame: 20, def: 'arc2', ox: 600, oy: 1300 }],
  });
  return {
    slot: 'ATH_SHOOTER', kit, archetype: 'zoner-arc', health: 10000, walk: { f: 58, b: 50 },
    tune: { '5H': { reach: 108 } },
    specials: [arcShot, fade, lob],
    supers: [triple, showstopper(kit, 'gumballVolley')],
    projectiles: [
      proj('arc1', { behavior: 'arc', speed: 55, life: 140, damage: 600, arc: { vy: 90, gravity: 6 } }),
      proj('arc2', { behavior: 'arc', speed: 58, life: 140, damage: 900, power: 2, arc: { vy: 90, gravity: 6 } }),
      proj('arc3', { behavior: 'arc', speed: 62, life: 140, damage: 1300, power: 3, arc: { vy: 90, gravity: 6 } }),
      proj('lob', { behavior: 'arc', speed: 14, life: 90, damage: 700, arc: { vy: 120, gravity: 8 }, boxes: [cap(-150, -100, 150, 300, 200)] }),
    ],
    gimmick: { id: 'charge', params: { holdFrame: 3, maxHold: 40 } },
    shutdownTags: ['finisher', 'gumball'],
    ai: { aggression: 30, zoning: 80, antiAir: 50, throwRate: 15, blockRate: 55, shutdownRate: 60, reaction: [12, 26], habits: habits(['fireball_zone', 'walk_in', 'block_reach', 'anti_air', 'poke_neutral', 'punish_unsafe']) },
  };
}

function powerBack(): Spec {
  const kit = 'ath_power_back';
  const shoulder = move(kit, {
    id: 'shoulderCharge', kind: 'special', input: motion('236', PUNCH), startup: 14, active: 10, recovery: 22, ex: true, tags: ['advance'],
    armor: { from: 6, to: 24, hits: 1 }, motion: [{ frame: 6, vx: 90, vy: 0 }, { frame: 24, vx: 0, vy: 0 }],
    hits: [{ from: 14, hit: hit({ damage: 850, boxes: [cap(250, 800, 650, 1000, 330)], hitstun: 22, blockstun: 16, hitstop: 12, pushHit: 300, pushBlock: 350, launch: { vx: 9, vy: 70, kd: 'soft' }, juggle: { cost: 1, limit: 1 } }) }],
  });
  const collar = move(kit, {
    id: 'collarToss', kind: 'special', input: motion('63214', PUNCH), startup: 8, active: 2, recovery: 26, tags: ['grab'],
    hits: [{ from: 8, hit: hit({ damage: 1200, boxes: [], guard: 'throw', hitstun: 24, blockstun: 0, hitstop: 14, pushHit: 600, pushBlock: 0, hype: { hit: 100, block: 0, whiff: 0 }, fx: { spark: 'heavy', cue: 'hit.throw' } }) }],
    tracks: [{ from: 8, to: 9, throw: { x: 0, y: 0, w: 950, h: 1500 } }],
  });
  const brace = move(kit, { id: 'brace', kind: 'special', input: motion('22', PUNCH), startup: 4, active: 1, recovery: 36, tags: ['stance'], armor: { from: 1, to: 40, hits: 2 } });
  const wreck = rush(kit, 'wreckingRun', '236', { dmg: [600, 700, 950], reach: 1000, armor: true });
  return {
    slot: 'ATH_POWER_BACK', kit, archetype: 'armored-grappler', health: 10500, walk: { f: 52, b: 42 },
    tune: { '5L': { dmg: 110 }, '5M': { dmg: 110 }, '5H': { dmg: 110, S: 10 }, '2H': { dmg: 105 }, throw: { dmg: 110 } },
    specials: [shoulder, collar, brace],
    supers: [wreck, showstopper(kit, 'fullClearance', { armor: true })],
    projectiles: [],
    gimmick: { id: 'armor', params: { hits: 1 } },
    shutdownTags: ['finisher', 'cushion'],
    ai: { aggression: 65, zoning: 10, antiAir: 40, throwRate: 55, blockRate: 50, shutdownRate: 60, reaction: [12, 26], habits: habits(['walk_in', 'throw_close', 'poke_neutral', 'block_reach', 'heavy_bait', 'punish_unsafe']) },
  };
}

function influencer(): Spec {
  const kit = 'influencer';
  const take = move(kit, { id: 'hotTake', kind: 'special', input: motion('236', PUNCH), startup: 10, active: 1, recovery: 24, ex: true, tags: ['quick'], spawn: [{ frame: 10, def: 'take', ox: 650, oy: 1100 }] });
  const swap = move(kit, { id: 'swapPlaces', kind: 'special', input: motion('214', KICK), startup: 12, active: 1, recovery: 16, tags: ['swap', 'once'], invuln: [{ from: 1, to: 12, kind: 'strike' }] });
  const pop = move(kit, { id: 'pollPop', kind: 'special', input: motion('22', PUNCH), startup: 14, active: 1, recovery: 26, tags: ['zone'], spawn: [{ frame: 14, def: 'burst', ox: 550, oy: 0 }] });
  return {
    slot: 'INFLUENCER', kit, archetype: 'buff-mixup', health: 10000, walk: { f: 66, b: 52 },
    tune: { '5L': { S: 4 }, '2M': { S: 7 } },
    specials: [take, swap, pop],
    supers: [rush(kit, 'viralMoment', '236', { dmg: [600, 700, 900], reach: 1000 }), showstopper(kit, 'trending')],
    projectiles: [
      proj('take', { speed: 62, life: 50, damage: 450 }),
      proj('take:ex', { speed: 74, life: 50, damage: 450, power: 2, hits: 2 }),
      proj('burst', { behavior: 'trap', speed: 0, life: 18, damage: 700, boxes: [cap(-350, 200, 350, 900, 380)] }),
    ],
    gimmick: { id: 'poll', params: { cycle: 600 } },
    shutdownTags: ['finisher', 'badge'],
    ai: { aggression: 55, zoning: 45, antiAir: 45, throwRate: 30, blockRate: 50, shutdownRate: 60, reaction: [12, 26], habits: habits(['walk_in', 'poke_neutral', 'block_reach', 'throw_close', 'fireball_zone', 'jump_in']) },
  };
}

// ---- balance knobs (scripts/kit-knobs.json, written by the tuning loop) -------------------------------------------------------------
interface Knobs { health?: number; dmg?: number; proj?: number; walk?: number }
const knobsFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kit-knobs.json');
let knobs: Record<string, Knobs> = {};
try { knobs = JSON.parse(readFileSync(knobsFile, 'utf8')) as Record<string, Knobs>; } catch { /* none yet */ }
const scaleDmg = (h: HitDef, pct: number): void => { h.damage = Math.max(1, Math.round((h.damage * pct) / 100 / 5) * 5); };
/** Applies the knobs of a slot: health, damage of normals, specials and the throw, damage of shots (the Arc Shot levels stay 600 / 900 / 1,300), walk speed. */
function applyKnobs(d: FighterDef): void {
  const k = knobs[d.slot];
  if (k === undefined) return;
  if (k.health !== undefined) d.health = k.health;
  if (k.walk !== undefined) { d.walk = { f: Math.round((d.walk.f * k.walk) / 100), b: Math.round((d.walk.b * k.walk) / 100) }; }
  if (k.dmg !== undefined) for (const m of d.moves) for (const h of m.hits) scaleDmg(h.hit, k.dmg);
  const pp = k.proj ?? k.dmg;
  if (pp !== undefined) for (const p of d.projectiles) if (p.hit.damage > 0 && !p.id.startsWith('arc')) scaleDmg(p.hit, pp);
}

// ---- assembly ------------------------------------------------------------------------------------------------------
function build(s: Spec): FighterDef {
  const shutdown = JSON.parse(JSON.stringify(base.shutdown)) as MoveDef;
  shutdown.nameKey = `fighter.${s.kit}.move.shutdown`; shutdown.tags = s.shutdownTags;
  const taunt = JSON.parse(JSON.stringify(base.taunt)) as MoveDef;
  taunt.nameKey = `fighter.${s.kit}.move.taunt`; taunt.tags = ['taunt'];
  return {
    slot: s.slot, kit: s.kit, archetype: s.archetype, health: s.health, walk: s.walk, dash: s.dash ?? base.dash, jump: base.jump, push: base.push,
    hurtDefault: base.hurtDefault, moves: [...normals(s.kit, s.tune, false), ...s.specials], supers: s.supers, shutdown, taunt,
    autoCombo: base.autoCombo, projectiles: s.projectiles, gimmick: s.gimmick, ai: s.ai,
  };
}

const specs = [hyphy(), lyricist(), visionary(), hacker(), shooter(), powerBack(), influencer()];

function fixSalvo(d: FighterDef): void {
  // Word Salvo hits three times from one projectile: the re-hit interval lives on the HitDef.
  for (const p of d.projectiles) if (p.id.startsWith('salvo')) p.hit.multi = { every: 6, max: 3 };
  for (const p of d.projectiles) if (p.id === 'wall') p.hit.multi = { every: 8, max: 4 };
}

/** rap_new_wave.json is the M08a2 kit; its pristine copy lives in scripts/base and only the balance knobs are applied on top. */
function newWave(): FighterDef {
  const d = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'base', 'rap_new_wave.json'), 'utf8')) as FighterDef;
  d.ai.habits = habits(['walk_in', 'fireball_zone', 'block_reach', 'poke_neutral', 'anti_air', 'punish_unsafe']);
  applyKnobs(d);
  return d;
}

function main(): void {
  const check = args().includes('--check');
  let bad = 0;
  const all: { file: string; def: FighterDef }[] = [{ file: 'rap_new_wave', def: newWave() }];
  for (const s of specs) { const def = build(s); fixSalvo(def); applyKnobs(def); all.push({ file: s.kit, def }); }
  for (const { file: name, def } of all) {
    const file = path.join(kitDir, `${name}.json`);
    const text = `${JSON.stringify(def, null, 2)}\n`;
    if (check) {
      let cur = '';
      try { cur = readFileSync(file, 'utf8'); } catch { /* missing */ }
      if (cur !== text) { console.error(`gen-kits: ${path.relative(root, file)} differs from the tables`); bad++; }
    } else {
      writeFileSync(file, text);
      console.log(`wrote ${path.relative(root, file)}`);
    }
  }
  if (bad > 0) process.exit(1);
}
main();
