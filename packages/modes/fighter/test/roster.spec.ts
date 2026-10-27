// M08b1 AC-8: the roster binds eight slots to compiled souls; the tier comes from the soul; the canary slot loads as fictionalized with its stand-in.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { FameConfig, RosterEntry } from '@dv/shared/fight';
import rosterSchema from '../../../shared/src/fight/schema/roster.v1.schema.json';
import stageSchema from '../../../shared/src/fight/schema/stage.v1.schema.json';
import { ROSTER, ROSTER_ENTRIES, FAME, fighterRoster, loadedFighterOf } from '../src/sim/data.ts';
import { disclaimerKey, loadRoster, marketingAllowed, stageAllowed } from '../src/sim/roster.ts';
import type { SoulLite } from '../src/sim/roster.ts';
import { fighterRows } from '../src/sim/menu.ts';

const root = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as T;
const bundle = read<{ souls: (SoulLite & { schema: string })[] }>('content/npcs/fighters-dev/bundle.json');
const souls = new Map<string, SoulLite>(bundle.souls.map((s) => [s.id, s]));
const ajv = new Ajv2020({ allErrors: true, strict: false });

describe('content/fighter/roster.json', () => {
  it('passes the roster schema and names the eight v1 slots', () => {
    const v = ajv.compile(rosterSchema);
    expect(v(ROSTER_ENTRIES), JSON.stringify(v.errors)).toBe(true);
    expect(ROSTER_ENTRIES.map((e) => e.slot)).toEqual([
      'RAP_HYPHY_ELDER', 'RAP_LYRICIST', 'RAP_NEW_WAVE', 'TECH_VISIONARY', 'TECH_HACKER', 'ATH_SHOOTER', 'ATH_POWER_BACK', 'INFLUENCER',
    ]);
    expect(ROSTER_ENTRIES.every((e) => e.v1)).toBe(true);
  });
  it('the stage file passes the stage schema', () => {
    const v = ajv.compile(stageSchema);
    const s = read('content/fighter/stages/powell_turntable.json');
    expect(v(s), JSON.stringify(v.errors)).toBe(true);
  });
  it('every slot has its kit file and the kit file names the slot', () => {
    for (const e of ROSTER_ENTRIES) expect(read<{ slot: string }>(`content/fighter/kits/${e.kit}.json`).slot).toBe(e.slot);
  });
  it('the UI roster (the picker) lists the player and the eight slots with distinct ids', () => {
    expect(ROSTER).toHaveLength(9);
    expect(new Set(ROSTER.map((r) => r.id)).size).toBe(9);
    expect(ROSTER.map((r) => r.slot).sort()).toEqual(['ATH_POWER_BACK', 'ATH_SHOOTER', 'INFLUENCER', 'PLAYER_FIGHTER', 'RAP_HYPHY_ELDER', 'RAP_LYRICIST', 'RAP_NEW_WAVE', 'TECH_HACKER', 'TECH_VISIONARY']);
  });
});

describe('the loader reads the tier from the compiled soul', () => {
  it('loads the eight slots from the development bundle with no issue', () => {
    const r = fighterRoster();
    expect(r.issues).toEqual([]);
    expect(r.fighters).toHaveLength(8);
    for (const f of r.fighters) {
      const soul = souls.get(f.fighterId) as SoulLite;
      expect(f.tier, f.slot).toBe(soul.tier);
      expect(f.standInLoaded).toBe(false);
    }
  });
  it('the canary slot loads as fictionalized, with its stand-in on record', () => {
    const f = fighterRoster().fighters.find((x) => x.slot === 'RAP_NEW_WAVE');
    expect(f?.fighterId).toBe('canary-mc');
    expect(f?.tier).toBe('fictionalized');
    const e = ROSTER_ENTRIES.find((x) => x.slot === 'RAP_NEW_WAVE') as RosterEntry;
    expect(e.standIn.fighterId).toBe('standin_rap_new_wave');
    expect(e.standIn.assets.model).toBe('character/graybox.standin');
    expect(disclaimerKey(f?.tier ?? 'original')).toBe('fighter.card.fictional');
  });
  it('a soul that changes tier changes the loaded tier; fighter data never decides it (expectedTier is only compared)', () => {
    const changed = new Map(souls);
    const s = changed.get('dev_hacker') as SoulLite;
    changed.set('dev_hacker', { ...s, tier: 'parody', fameDomain: ['streaming'] });
    const r = loadRoster(ROSTER_ENTRIES, changed, FAME);
    const f = r.fighters.find((x) => x.slot === 'TECH_HACKER');
    expect(f?.tier).toBe('parody');
    expect(r.issues.map((i) => i.slot)).toEqual(['TECH_HACKER']);
    expect(r.issues[0]?.message).toContain('the soul wins');
    expect(disclaimerKey('parody')).toBe('fighter.card.parody');
    expect(marketingAllowed('parody')).toBe(false);
    expect(marketingAllowed('fictionalized')).toBe(false);
  });
  it('a missing soul loads the stand-in (same kit, the stand-in name and assets)', () => {
    const gone = new Map(souls);
    gone.delete('dev_shooter');
    const r = loadRoster(ROSTER_ENTRIES, gone, FAME);
    const f = r.fighters.find((x) => x.slot === 'ATH_SHOOTER');
    expect(f?.standInLoaded).toBe(true);
    expect(f?.fighterId).toBe('standin_ath_shooter');
    expect(f?.kit).toBe('ath_shooter');
    expect(f?.assets.model).toBe('character/graybox.standin');
    expect(r.issues).toHaveLength(1);
  });
  it('fame domains: the slot reserves them, the soul adds its own; a basketball fighter is not offered an arena_court stage', () => {
    const f = fighterRoster().fighters.find((x) => x.slot === 'ATH_SHOOTER');
    expect(f?.fameDomains).toEqual(['basketball']);
    expect(stageAllowed(f as { fameDomains: string[] }, ['arena_court'], FAME as FameConfig)).toBe(false);
    expect(stageAllowed(f as { fameDomains: string[] }, ['turntable', 'street'], FAME as FameConfig)).toBe(true);
    const v = fighterRoster().fighters.find((x) => x.slot === 'TECH_VISIONARY');
    expect(stageAllowed(v as { fameDomains: string[] }, ['arena_court'], FAME as FameConfig)).toBe(true);
  });
});

describe('the select menu', () => {
  it('shows the likeness card of every roster fighter and none for the player', () => {
    const rows = fighterRows(ROSTER.map((r) => r.id));
    expect(rows.find((r) => r.id === 'player')?.card).toBeNull();
    for (const r of rows.filter((x) => x.id !== 'player')) expect(r.card, r.id).toBe('fighter.card.fictional');
    expect(loadedFighterOf('dev_hyphy_elder')?.slot).toBe('RAP_HYPHY_ELDER');
  });
});
