/**
 * soulVersion rule (lint L14, spec/domains/04-npc-contracts.md section B1 rule 3 and B8): the version increases by 1 or more
 * whenever the compiled prompt bytes or the public JSON change, and only then. Pure.
 */
export interface SoulHashes {
  soulVersion: number;
  /** sha256 of soul.prompt.txt. */
  promptSha256: string;
  /** sha256 of the canonical public JSON (CompiledSoulPublic). */
  publicSha256: string;
}

/** A message when `cur` breaks the rule against the last release `prev`, else null. No previous release means no constraint. */
export function soulVersionProblem(prev: SoulHashes | undefined | null, cur: SoulHashes): string | null {
  if (!prev) return null;
  const unchanged = prev.promptSha256 === cur.promptSha256 && prev.publicSha256 === cur.publicSha256;
  if (!unchanged && cur.soulVersion <= prev.soulVersion) {
    return `the prompt or public JSON changed but soulVersion is ${cur.soulVersion} (last release ${prev.soulVersion}); raise it`;
  }
  if (unchanged && cur.soulVersion !== prev.soulVersion) {
    return `nothing changed but soulVersion moved from ${prev.soulVersion} to ${cur.soulVersion}`;
  }
  return null;
}
