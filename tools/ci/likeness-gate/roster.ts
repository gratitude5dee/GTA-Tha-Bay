/**
 * likeness:gate, fighter roster extension (FX4.1, M08b1). Rules over `content/fighter/roster.json`, the compiled public souls the slots are
 * bound to, the stages and the kits:
 *  - roster-tier-mismatch    `expectedTier` equals the compiled soul's tier (the tier lives in the soul, never in fighter data)
 *  - roster-soul-missing     the soul a slot names is in the compiled bundle, at the version the roster asks for
 *  - roster-standin-missing  a stand-in (fighter id and the four assets) is present for every tier other than `original`
 *  - roster-fame-kit         no kit tag, name key, move id or projectile id uses a word of the slot's fame domains (whole words)
 *  - roster-fame-stage       the slot's home stage carries no tag its fame domains forbid (a basketball fighter never gets `arena_court`)
 * The fame domains of a slot are the ones the slot reserves in `config/fame-domains.json` plus the ones its soul declares.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { domainsFor, kitFameHits, stageFameHits } from '../../../packages/shared/src/fight/fame.ts';
import type { FameConfig } from '../../../packages/shared/src/fight/fame.ts';
import type { FighterDef, RosterEntry } from '../../../packages/shared/src/fight/types.ts';
import { finding } from '../../../packages/shared/src/assets/gates/types.ts';
import type { GateFinding } from '../../../packages/shared/src/assets/gates/types.ts';

const GATE = 'likeness:gate';
const ASSET_KEYS = ['model', 'animBase', 'animMoves', 'portrait'] as const;

export interface RosterSoul { id: string; soulVersion: number; tier: string; fameDomain: string[] }
export interface RosterGateInput {
  roster: RosterEntry[];
  souls: RosterSoul[];
  stages: { id: string; tags: string[] }[];
  kits: Record<string, FighterDef>;
  fame: FameConfig;
  /** The file names used in findings. */
  files?: { roster: string };
}

export function rosterFindings(i: RosterGateInput): GateFinding[] {
  const out: GateFinding[] = [];
  const file = i.files?.roster ?? 'content/fighter/roster.json';
  const add = (slot: string, rule: string, detail: string): void => { out.push(finding(GATE, file, rule, `${slot}: ${detail}`)); };
  for (const e of i.roster) {
    const soul = i.souls.find((s) => s.id === e.fighterId);
    if (soul === undefined) { add(e.slot, 'roster-soul-missing', `soul ${e.fighterId} is not in the compiled bundle`); }
    else {
      if (soul.tier !== e.expectedTier) add(e.slot, 'roster-tier-mismatch', `expectedTier ${e.expectedTier}, the compiled soul ${soul.id} is ${soul.tier}`);
      if (soul.soulVersion !== e.soulVersion) add(e.slot, 'roster-soul-missing', `the roster wants soulVersion ${e.soulVersion}, the bundle has ${soul.soulVersion}`);
    }
    if (e.expectedTier !== 'original' || (soul !== undefined && soul.tier !== 'original')) {
      const si = e.standIn as RosterEntry['standIn'] | undefined;
      if (si === undefined || si === null || typeof si.fighterId !== 'string' || si.fighterId === '') add(e.slot, 'roster-standin-missing', `tier ${soul?.tier ?? e.expectedTier} needs a stand-in`);
      else for (const k of ASSET_KEYS) if (typeof si.assets?.[k] !== 'string' || si.assets[k] === '') add(e.slot, 'roster-standin-missing', `the stand-in has no ${k}`);
    }
    const domains = domainsFor(i.fame, e.slot, soul?.fameDomain ?? []);
    const kit = i.kits[e.slot];
    if (kit !== undefined) {
      for (const h of kitFameHits(kit, i.fame, domains)) add(e.slot, 'roster-fame-kit', `${h.where} "${h.text}" uses "${h.keyword}" of the ${h.domain} fame domain`);
    }
    const stage = i.stages.find((s) => s.id === e.homeStage);
    if (stage === undefined) add(e.slot, 'roster-fame-stage', `home stage ${e.homeStage} does not exist`);
    else for (const h of stageFameHits(i.fame, domains, stage.tags)) add(e.slot, 'roster-fame-stage', `home stage ${stage.id} carries the tag ${h.text}, forbidden for the ${h.domain} fame domain`);
  }
  return out;
}

const readJson = <T>(root: string, rel: string): T => JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as T;

/** Reads the repository files the gate needs; `null` when the repository has no fighter roster yet. */
export function loadRosterGateInput(root: string): RosterGateInput | null {
  if (!existsSync(path.join(root, 'content/fighter/roster.json'))) return null;
  const kits: Record<string, FighterDef> = {};
  const kitDir = path.join(root, 'content/fighter/kits');
  for (const f of readdirSync(kitDir).filter((x) => x.endsWith('.json')).sort()) {
    const k = JSON.parse(readFileSync(path.join(kitDir, f), 'utf8')) as FighterDef;
    kits[k.slot] = k;
  }
  const stageDir = path.join(root, 'content/fighter/stages');
  const stages = readdirSync(stageDir).filter((x) => x.endsWith('.json')).sort().map((f) => {
    const s = JSON.parse(readFileSync(path.join(stageDir, f), 'utf8')) as { id: string; tags: string[] };
    return { id: s.id, tags: s.tags };
  });
  const bundle = existsSync(path.join(root, 'content/npcs/fighters-dev/bundle.json'))
    ? readJson<{ souls: RosterSoul[] }>(root, 'content/npcs/fighters-dev/bundle.json').souls : [];
  return { roster: readJson<RosterEntry[]>(root, 'content/fighter/roster.json'), souls: bundle, stages, kits, fame: readJson<FameConfig>(root, 'config/fame-domains.json') };
}

export function runRosterGate(root: string): { findings: GateFinding[]; scanned: number } {
  const input = loadRosterGateInput(root);
  if (input === null) return { findings: [], scanned: 0 };
  return { findings: rosterFindings(input), scanned: input.roster.length };
}
