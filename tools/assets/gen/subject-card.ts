/**
 * Subject cards (M10a2, BD-M10a2-01): a character the batch generates that is not an NPC. The protagonist `pc-coast` (DL-OWN-05, DL-737) is
 * the one card today. A card is `content/characters/<id>/subject.json`; `loadWorld` turns it into a runnable entry beside the roster ones, so
 * `plan`, `run` and `gate` treat it like any Standard slug, but it has no soul, no `data/npc-roster` row, no dialogue route and no brain.
 *
 *   refs      first-party reference images of the sheet stage, repository paths (PNG, WebP or JPEG; at most three are sent)
 *   signers   a human gate that only this profile may record (`gate --by owner` for H1 and H3 of Coast)
 *   parts     the creator rows the published character is split into (tools/assets/src/coast.ts)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NpcRosterEntry } from '../../../packages/shared/src/contracts/c10-npc.ts';
import { HUMAN_GATES, type CharacterSubject, type HumanGateId } from '../../../services/pipeline/src/steps/character.ts';
import type { KillFlags, LoadedEntry } from './plan.ts';

export const CARD_DIR = 'content/characters';
export const CARD_FILE = 'subject.json';

export interface SubjectCard {
  schema: 'character-subject/1';
  id: string;
  /** What the character is; only `player` exists. */
  kind: 'player';
  pipeline: 'standard';
  /** The roster-style tier and basis, so `assetTier` gives `original`. */
  tier: 'fictionalized';
  basis: 'original';
  soulVersion: number;
  visualBrief: string;
  heightM: number;
  hero: boolean;
  refs: string[];
  signers: Partial<Record<HumanGateId, string>>;
  /** The creator rows the model is split into, in catalog order: `{ row, slot }`. */
  parts: { row: string; slot: string }[];
  note?: string;
}

export interface CardProblem { file: string; detail: string }

const SLUG = /^[a-z][a-z0-9-]{2,47}$/;

/** Structural checks of one card; the strings come back empty when the card is sound. */
export function cardProblems(c: unknown, file: string): string[] {
  const out: string[] = [];
  if (c === null || typeof c !== 'object') return [`${file}: not an object`];
  const o = c as Record<string, unknown>;
  const need = (k: string, ok: boolean, what: string): void => { if (!ok) out.push(`${file}: ${k} must be ${what}`); };
  need('schema', o['schema'] === 'character-subject/1', '"character-subject/1"');
  need('id', typeof o['id'] === 'string' && SLUG.test(o['id']), 'a slug');
  need('kind', o['kind'] === 'player', '"player"');
  need('pipeline', o['pipeline'] === 'standard', '"standard"');
  need('tier', o['tier'] === 'fictionalized', '"fictionalized" (with basis original the asset tier is original)');
  need('basis', o['basis'] === 'original', '"original"');
  need('soulVersion', Number.isInteger(o['soulVersion']) && (o['soulVersion'] as number) >= 1, 'a positive integer');
  need('visualBrief', typeof o['visualBrief'] === 'string' && o['visualBrief'].length >= 40 && o['visualBrief'].length <= 600, 'a text of 40 to 600 characters');
  need('heightM', typeof o['heightM'] === 'number' && o['heightM'] > 1 && o['heightM'] < 2.5, 'a height in metres');
  need('hero', typeof o['hero'] === 'boolean', 'a boolean');
  need('refs', Array.isArray(o['refs']) && o['refs'].length >= 1 && o['refs'].length <= 3 && o['refs'].every((r) => typeof r === 'string'), '1 to 3 repository paths');
  const signers = o['signers'];
  need('signers', signers !== null && typeof signers === 'object' && Object.entries(signers as object).every(([g, who]) => HUMAN_GATES.includes(g as HumanGateId) && typeof who === 'string' && who !== ''), 'a map of human gate to profile');
  need('parts', Array.isArray(o['parts']) && o['parts'].every((p) => p !== null && typeof p === 'object' && typeof (p as { row?: unknown }).row === 'string' && typeof (p as { slot?: unknown }).slot === 'string'), 'a list of { row, slot }');
  if (typeof o['id'] === 'string' && !file.includes(`/${o['id']}/`)) out.push(`${file}: id ${o['id']} does not match the folder`);
  return out;
}

/** Every card under `content/characters/*`. Problems are returned, never thrown, so `plan` can list a broken card as blocked. */
export function readCards(root: string): { cards: SubjectCard[]; problems: CardProblem[] } {
  const dir = path.join(root, CARD_DIR);
  const cards: SubjectCard[] = [];
  const problems: CardProblem[] = [];
  if (!existsSync(dir)) return { cards, problems };
  for (const d of readdirSync(dir).sort()) {
    const rel = `${CARD_DIR}/${d}/${CARD_FILE}`;
    const file = path.join(root, rel);
    if (!existsSync(file)) continue;
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      problems.push({ file: rel, detail: (e as Error).message });
      continue;
    }
    const bad = cardProblems(json, rel);
    if (bad.length > 0) problems.push(...bad.map((detail) => ({ file: rel, detail })));
    else cards.push(json as SubjectCard);
  }
  return { cards, problems };
}

/** A card as a runnable entry: a synthetic roster row (no soul on disk) and the subject the stages read. */
export function cardEntry(c: SubjectCard, kill: KillFlags = {}): LoadedEntry {
  const entry: NpcRosterEntry = {
    id: c.id, soul: `${CARD_DIR}/${c.id}/${CARD_FILE}`, status: 'active', tier: c.tier, basis: c.basis, hero: c.hero, pipeline: c.pipeline,
    priority: 1, research: 'none', standIn: null, modes: ['story'],
  };
  const subject: CharacterSubject = {
    slug: c.id, tier: 'original', soulVersion: c.soulVersion, visualBrief: c.visualBrief, heightM: c.heightM, moves: [], standIn: null, pipeline: c.pipeline, hero: c.hero,
    killed: kill[c.id] ?? [], minor: false, signers: c.signers,
  };
  return { entry, subject, problem: null, card: c };
}

/** The first-party reference images of a slug: the card's `refs`, else `content/npcs/<slug>/refs/*.png`. At most three, in path order. */
export function refPaths(root: string, slug: string, card: SubjectCard | undefined): string[] {
  if (card !== undefined) return card.refs.filter((r) => existsSync(path.join(root, r)));
  const dir = path.join(root, `content/npcs/${slug}/refs`);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => `content/npcs/${slug}/refs/${f}`);
}

/** The media type of an image by its magic bytes (the stage cannot trust a file name); anything unrecognised is sent as PNG, as before M10a2. */
export function sniffImage(b: Uint8Array): 'image/png' | 'image/webp' | 'image/jpeg' {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return 'image/png';
}
