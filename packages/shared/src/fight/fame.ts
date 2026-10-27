// packages/shared/src/fight/fame.ts — the fame-domain rule (FX4.1, FX4.2, M08b1). Pure: the lint, the roster loader and the CI gate share it.
// `config/fame-domains.json` maps a domain to the words a kit may not use; a parody subject is never shown in their fame domain.
import type { FighterDef, MoveDef } from './types.ts';

export interface FameConfig {
  schema: 'fame-domains/1';
  domains: Record<string, string[]>;
  /** The domain(s) each roster slot reserves, whoever fills the slot. */
  slots: Record<string, string[]>;
  /** Domain -> stage tags its fighters may not fight on (a `basketball` fighter never gets a stage tagged `arena_court`). */
  forbiddenStageTags: Record<string, string[]>;
}

/** Splits camelCase and every non-alphanumeric run (a hyphen included) into lower-case words. */
export function fameWords(text: string): string[] {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^A-Za-z0-9]+/g, ' ').trim().toLowerCase();
  return spaced === '' ? [] : spaced.split(' ');
}

/** Does `text` contain the keyword as whole words (a plural `s` is allowed)? A keyword of several words must appear in order. */
export function fameMatches(text: string, keyword: string): boolean {
  const words = fameWords(text), key = fameWords(keyword);
  if (key.length === 0) return false;
  for (let i = 0; i + key.length <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < key.length; j++) {
      const w = words[i + j] as string, k = key[j] as string;
      if (w !== k && w !== `${k}s`) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

export interface FameHit { where: string; text: string; keyword: string; domain: string }

/** The domains in force for a slot: the slot's reserved ones plus the ones the bound soul declares. */
export function domainsFor(cfg: FameConfig, slot: string, soulDomains: readonly string[] = []): string[] {
  return [...new Set([...(cfg.slots[slot] ?? []), ...soulDomains])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function movesOf(k: FighterDef): MoveDef[] { return [...k.moves, ...k.supers, k.shutdown, k.taunt]; }

/** Every kit string the rule reads: move ids, tags and name keys, projectile ids and the cue names of hits. */
export function kitStrings(k: FighterDef): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const m of movesOf(k)) {
    out.push({ where: `${m.id}.id`, text: m.id }, { where: `${m.id}.nameKey`, text: m.nameKey });
    m.tags.forEach((t, i) => out.push({ where: `${m.id}.tags[${i}]`, text: t }));
    m.hits.forEach((h, i) => out.push({ where: `${m.id}.hits[${i}].fx.cue`, text: h.hit.fx.cue }));
  }
  for (const p of k.projectiles) out.push({ where: `projectiles.${p.id}`, text: p.id }, { where: `projectiles.${p.id}.fx.cue`, text: p.hit.fx.cue });
  return out;
}

/** Kit strings that contain a forbidden word of any of `domains`. */
export function kitFameHits(k: FighterDef, cfg: FameConfig, domains: readonly string[]): FameHit[] {
  const hits: FameHit[] = [];
  for (const s of kitStrings(k)) {
    for (const d of domains) {
      for (const kw of cfg.domains[d] ?? []) if (fameMatches(s.text, kw)) hits.push({ where: s.where, text: s.text, keyword: kw, domain: d });
    }
  }
  return hits;
}

/** Stage tags a fighter of these domains may not fight on, that the stage carries. */
export function stageFameHits(cfg: FameConfig, domains: readonly string[], stageTags: readonly string[]): FameHit[] {
  const hits: FameHit[] = [];
  for (const d of domains) for (const t of cfg.forbiddenStageTags[d] ?? []) if (stageTags.includes(t)) hits.push({ where: 'stage.tags', text: t, keyword: t, domain: d });
  return hits;
}
