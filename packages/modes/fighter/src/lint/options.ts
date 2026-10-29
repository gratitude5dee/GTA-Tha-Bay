/**
 * Node-side loader of the lint options (M08b1): `config/fame-domains.json`, the habit ids of `content/fighter/ai/habits.json` and the
 * fame domains the bound soul declares (roster slot -> fighter id -> compiled public soul in the dev bundle). Used by `fighter:lint`,
 * `check:fighter` and the specs; the lint rules themselves stay pure (`index.ts`).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FameConfig, RosterEntry } from '@dv/shared/fight';
import type { LintOptions } from './index.ts';

const readJson = <T>(root: string, rel: string): T | null => {
  const p = path.join(root, rel);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null;
};

export function loadFame(root: string): FameConfig {
  const cfg = readJson<FameConfig>(root, 'config/fame-domains.json');
  if (cfg === null || cfg.schema !== 'fame-domains/1') throw new Error('config/fame-domains.json is missing or has the wrong schema');
  return cfg;
}

export function loadHabitIds(root: string): ReadonlySet<string> {
  const f = readJson<{ habits: { id: string }[] }>(root, 'content/fighter/ai/habits.json');
  if (f === null) throw new Error('content/fighter/ai/habits.json is missing');
  return new Set(f.habits.map((h) => h.id));
}

/** The soul fame domains of each roster slot, read from the roster and the compiled bundle (empty when either is absent). */
export function soulDomainsBySlot(root: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const roster = readJson<RosterEntry[]>(root, 'content/fighter/roster.json');
  const bundle = readJson<{ souls: { id: string; fameDomain: string[] }[] }>(root, 'content/npcs/fighters-dev/bundle.json');
  if (roster === null || bundle === null) return out;
  for (const e of roster) out.set(e.slot, bundle.souls.find((s) => s.id === e.fighterId)?.fameDomain ?? []);
  return out;
}

export function loadFameOptions(root: string): (slot: string) => LintOptions {
  const fame = loadFame(root), habits = loadHabitIds(root), soul = soulDomainsBySlot(root);
  return (slot) => ({ fame, habits, soulDomains: soul.get(slot) ?? [] });
}
