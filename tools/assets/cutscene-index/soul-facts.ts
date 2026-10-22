/**
 * Soul facts for the cutscene index (M05b2): the id, `soulVersion`, likeness tier and text-only visual brief of each cast member,
 * read from the soul.md frontmatter through a port. M06a2's soul compiler replaces the file reader behind `SoulFactsPort`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { LikenessTier } from '../../../packages/shared/src/assets/c07.ts';
import { assetTier } from '../../../packages/shared/src/contracts/c10-npc.ts';
import { parseSoul } from '../../../packages/shared/src/npc/parse.ts';

export interface SoulFacts {
  id: string;
  soulVersion: number;
  /** C10 `assetTier`: `original` for an invented character, else the soul's tier. */
  tier: LikenessTier;
  /** The soul's text-only `visual_brief` (the only source of a `subject_brief_n` slot). */
  visualBrief: string;
  /** Kill scopes in force (`cutscene`, `all`, ...). The file reader derives them from the roster status. */
  killed: readonly string[];
}

export interface SoulFactsPort {
  lookup(id: string): SoulFacts | null;
}

interface RosterFile {
  entries: { id: string; soul: string; status: string }[];
}

/** Reads `content/npcs/roster.json` (and `content-private/npcs/roster.json` when mounted) and each listed soul.md. */
export function fileSoulFacts(root: string, extraKilled: readonly string[] = []): SoulFactsPort {
  const cache = new Map<string, SoulFacts | null>();
  const rows = new Map<string, { soul: string; status: string; base: string }>();
  for (const base of [root, path.join(root, 'content-private')]) {
    const file = path.join(base, base === root ? 'content/npcs/roster.json' : 'npcs/roster.json');
    if (!existsSync(file)) continue;
    for (const e of (JSON.parse(readFileSync(file, 'utf8')) as RosterFile).entries) rows.set(e.id, { soul: e.soul, status: e.status, base: root });
  }
  return {
    lookup(id) {
      if (cache.has(id)) return cache.get(id) ?? null;
      const row = rows.get(id);
      let facts: SoulFacts | null = null;
      if (row) {
        const abs = path.join(row.base, row.soul);
        if (existsSync(abs)) {
          const { front } = parseSoul(readFileSync(abs, 'utf8'));
          const f = front as unknown as { id: string; soulVersion: number; tier: LikenessTier & ('consented' | 'parody' | 'fictionalized'); likeness: { basis: Parameters<typeof assetTier>[0]['basis'] }; visual_brief?: string };
          const killed = row.status !== 'active' || extraKilled.includes(id) ? ['all'] : [];
          facts = { id: f.id, soulVersion: f.soulVersion, tier: assetTier({ basis: f.likeness.basis, tier: f.tier }), visualBrief: String(f.visual_brief ?? ''), killed };
        }
      }
      cache.set(id, facts);
      return facts;
    },
  };
}

/** An in-memory port for tests. */
export function memorySoulFacts(list: readonly SoulFacts[]): SoulFactsPort {
  const byId = new Map(list.map((s) => [s.id, s]));
  return { lookup: (id) => byId.get(id) ?? null };
}
