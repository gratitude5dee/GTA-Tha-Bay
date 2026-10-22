import { parse } from 'yaml';
import type { GoldenFile, ProbeDef, ProbesFile, RedteamFile, Suites } from './types.ts';

/**
 * Parsing and shape checks of the suite files (`redteam/*.yaml`, `golden/<npcId>.yaml`, `builder-probes.yaml`). Pure over strings; the CLI reads
 * the files. The counts of 04-npc-builder.md section C6 are enforced by `validateSuites`: at least 40 red-team probes, 10 golden conversations per
 * active soul, the 5 builder probes.
 */
export const REDTEAM_MIN = 40;
export const GOLDEN_CONVERSATIONS = 10;
export const BUILDER_PROBES = 5;
const ID = /^[a-z0-9][a-z0-9_-]{1,40}$/;
const REPLY_NAMES = new Set(['deflect', 'ai', 'care', 'greet']);

function probeProblems(p: unknown, where: string): string[] {
  const out: string[] = [];
  if (typeof p !== 'object' || p === null) return [`${where}: not an object`];
  const o = p as Partial<ProbeDef>;
  if (typeof o.id !== 'string' || !ID.test(o.id)) out.push(`${where}: id must match ${ID}`);
  if (typeof o.category !== 'string' || o.category === '') out.push(`${where}: category is required`);
  const say = o.say;
  if (typeof say !== 'object' || say === null || (say.text === undefined && say.intent === undefined)) out.push(`${where}: say needs text or intent`);
  else if (say.text !== undefined && (typeof say.text !== 'string' || Array.from(say.text).length > 280)) out.push(`${where}: say.text is longer than 280 characters`);
  if (o.reply === undefined || (typeof o.reply === 'string' && !REPLY_NAMES.has(o.reply))) out.push(`${where}: reply must be deflect, ai, care, greet or an object`);
  return out;
}

function load(text: string, schema: string, what: string): Record<string, unknown> {
  const doc = parse(text) as Record<string, unknown> | null;
  if (doc === null || typeof doc !== 'object' || doc['schema'] !== schema) throw new Error(`${what}: expected schema "${schema}"`);
  return doc;
}

export function parseRedteam(text: string, what = 'redteam'): ProbeDef[] {
  const doc = load(text, 'npc-evals-redteam/1', what) as unknown as Partial<RedteamFile>;
  if (!Array.isArray(doc.probes)) throw new Error(`${what}: probes must be a list`);
  return doc.probes;
}

export function parseBuilderProbes(text: string, what = 'builder-probes'): ProbeDef[] {
  const doc = load(text, 'npc-evals-builder-probes/1', what) as unknown as Partial<ProbesFile>;
  if (!Array.isArray(doc.probes)) throw new Error(`${what}: probes must be a list`);
  return doc.probes;
}

export function parseGolden(text: string, what = 'golden'): GoldenFile {
  const doc = load(text, 'npc-evals-golden/1', what) as unknown as GoldenFile;
  if (typeof doc.npc !== 'string' || !Array.isArray(doc.conversations)) throw new Error(`${what}: npc and conversations are required`);
  return doc;
}

/** Every problem of a loaded suite set, as lines. Empty when the set is complete. */
export function validateSuites(s: Suites, activeSouls: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  s.redteam.forEach((p, i) => {
    out.push(...probeProblems(p, `redteam[${i}]`));
    if (seen.has(p.id)) out.push(`redteam: duplicate id ${p.id}`);
    seen.add(p.id);
  });
  // Two probes that say the same in the same scene would share one recording.
  const requests = new Set<string>();
  for (const p of [...s.redteam, ...s.probes]) {
    const k = JSON.stringify([p.say, p.context ?? {}]);
    if (requests.has(k)) out.push(`${p.id}: another probe says the same in the same scene (they would share one recording)`);
    requests.add(k);
  }
  if (s.redteam.length < REDTEAM_MIN) out.push(`redteam: ${s.redteam.length} probes, at least ${REDTEAM_MIN} are required`);
  if (s.probes.length !== BUILDER_PROBES) out.push(`builder-probes: ${s.probes.length} probes, exactly ${BUILDER_PROBES} are required`);
  s.probes.forEach((p, i) => out.push(...probeProblems(p, `builder-probes[${i}]`)));
  for (const id of activeSouls) {
    const g = s.golden.get(id);
    if (g === undefined) {
      out.push(`golden: no golden/${id}.yaml for the active soul ${id}`);
      continue;
    }
    // The first turn of every conversation is a request of its own: it may not repeat a probe or another conversation.
    const firsts = new Set(requests);
    for (const c of g.conversations) {
      const first = c.turns?.[0];
      if (first === undefined) continue;
      const k = JSON.stringify([first.say, { ...(g.context ?? {}), ...(first.context ?? {}) }]);
      if (firsts.has(k) && JSON.stringify([first.say, first.context ?? null]) !== '') out.push(`golden/${id}/${c.id}: its first turn repeats a probe or another conversation (they would share one recording)`);
      firsts.add(k);
    }
    if (g.conversations.length !== GOLDEN_CONVERSATIONS) out.push(`golden/${id}: ${g.conversations.length} conversations, exactly ${GOLDEN_CONVERSATIONS} are required`);
    for (const k of ['deflect', 'ai', 'care', 'greet'] as const) if (typeof g.lines?.[k] !== 'string' || g.lines[k] === '') out.push(`golden/${id}: lines.${k} is required`);
    const ids = new Set<string>();
    g.conversations.forEach((c, i) => {
      if (typeof c.id !== 'string' || !ID.test(c.id)) out.push(`golden/${id}: conversations[${i}].id is invalid`);
      if (ids.has(c.id)) out.push(`golden/${id}: duplicate conversation ${c.id}`);
      ids.add(c.id);
      if (!Array.isArray(c.turns) || c.turns.length === 0) out.push(`golden/${id}/${c.id}: no turns`);
      else c.turns.forEach((t, j) => {
        if (t.say === undefined || (t.say.text === undefined && t.say.intent === undefined)) out.push(`golden/${id}/${c.id}#${j + 1}: say needs text or intent`);
        if (t.reply === undefined) out.push(`golden/${id}/${c.id}#${j + 1}: reply is required for a synthetic recording`);
      });
    });
  }
  return out;
}
