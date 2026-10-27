/**
 * The roster loader (FX1, FX4, M08b1). `content/fighter/roster.json` binds a kit to a slot and a slot to a character; the likeness tier
 * comes from the character's compiled public soul (C10 `CompiledSoulPublic.tier`, `fameDomain`), never from fighter data. The roster
 * row carries `expectedTier` only so CI can compare it (`likeness:gate`). A slot whose soul is missing (killed, retired, not yet
 * supplied) loads as its stand-in: same kit, the stand-in's name and assets, tier `fictionalized`. Pure; sim code under the C02 lint.
 */
import { domainsFor, stageFameHits } from '@dv/shared/fight';
import type { FameConfig, FighterSlotId, RosterAssets, RosterEntry, RosterTier } from '@dv/shared/fight';

/** The part of `CompiledSoulPublic` the roster reads. */
export interface SoulLite {
  id: string;
  soulVersion: number;
  tier: 'consented' | 'parody' | 'fictionalized';
  fameDomain: readonly string[];
  standIn: string | null;
  name: string;
}

export interface LoadedFighter {
  slot: FighterSlotId;
  kit: string;
  /** The id the game shows and saves: the soul id, or the stand-in id when the soul is missing. */
  fighterId: string;
  soulVersion: number;
  /** From the compiled soul. `fictionalized` for a stand-in. */
  tier: RosterTier;
  /** Domains the fighter is never shown in: the slot's reserved ones plus the soul's own. */
  fameDomains: string[];
  name: string;
  assets: RosterAssets;
  homeStage: string;
  v1: boolean;
  /** The soul was missing or older than the roster row asks for, so the stand-in was loaded. */
  standInLoaded: boolean;
}

export interface RosterIssue { slot: string; message: string }

export function loadRoster(entries: readonly RosterEntry[], souls: ReadonlyMap<string, SoulLite>, fame: FameConfig): { fighters: LoadedFighter[]; issues: RosterIssue[] } {
  const fighters: LoadedFighter[] = [];
  const issues: RosterIssue[] = [];
  for (const e of entries) {
    const soul = souls.get(e.fighterId);
    if (soul === undefined || soul.soulVersion < e.soulVersion) {
      issues.push({ slot: e.slot, message: soul === undefined ? `soul ${e.fighterId} is not in the bundle: loading the stand-in` : `soul ${e.fighterId} is version ${soul.soulVersion}, the roster wants ${e.soulVersion}: loading the stand-in` });
      fighters.push({
        slot: e.slot, kit: e.kit, fighterId: e.standIn.fighterId, soulVersion: e.soulVersion, tier: 'fictionalized', fameDomains: domainsFor(fame, e.slot),
        name: e.standIn.fighterId, assets: e.standIn.assets, homeStage: e.homeStage, v1: e.v1, standInLoaded: true,
      });
      continue;
    }
    if (soul.tier !== e.expectedTier) issues.push({ slot: e.slot, message: `expectedTier ${e.expectedTier} differs from the soul's tier ${soul.tier}; the soul wins` });
    fighters.push({
      slot: e.slot, kit: e.kit, fighterId: e.fighterId, soulVersion: soul.soulVersion, tier: soul.tier, fameDomains: domainsFor(fame, e.slot, soul.fameDomain),
      name: soul.name, assets: e.assets, homeStage: e.homeStage, v1: e.v1, standInLoaded: false,
    });
  }
  return { fighters, issues };
}

/** FX4.2: a fighter is never offered a stage that carries a tag forbidden for one of the fighter's fame domains. */
export function stageAllowed(f: Pick<LoadedFighter, 'fameDomains'>, stageTags: readonly string[], fame: FameConfig): boolean {
  return stageFameHits(fame, f.fameDomains, stageTags).length === 0;
}

/** FX4.3: the card text key shown on the select and first-appearance cards. `original` shows nothing. */
export function disclaimerKey(tier: RosterTier): string | null {
  switch (tier) {
    case 'parody': return 'fighter.card.parody';
    case 'fictionalized': return 'fighter.card.fictional';
    case 'consented': return 'fighter.card.consented';
    default: return null;
  }
}

/** FX4.4: marketing material (select-screen art as a share image) is allowed only for a consented character. */
export const marketingAllowed = (tier: RosterTier): boolean => tier === 'consented' || tier === 'original';
