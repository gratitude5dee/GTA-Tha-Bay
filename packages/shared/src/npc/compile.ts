/**
 * Soul compiler (spec/domains/04-npc-contracts.md section B3, B7): soul.md bytes plus the block A version in, the
 * byte-stable block B prompt text, the server view and the public view out. No clock, network, randomness or model call;
 * token counts, the prompt key's upload and `compiledAt` are added by tools/soul.
 */
import type {
  CompiledSoul,
  CompiledSoulAssets,
  CompiledSoulPublic,
  SoulFrontmatter,
} from '../contracts/c10-npc.ts';
import { canonicalize } from '../json.ts';
import { sha256Hex } from '../hash.ts';
import { SECTION_ORDER, normalizeNewlines, parseSoul } from './parse.ts';
import { formatIssue, validateSoul } from './validate.ts';

export interface RulesBlock { version: number; text: string }

export interface CompiledOutputs {
  promptTxt: string;
  compiled: Omit<CompiledSoul, 'prompt' | 'compiledAt'>;
  publicSoul: CompiledSoulPublic;
}

export class SoulCompileError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(issues.length ? `${message}: ${issues.join('; ')}` : message);
    this.name = 'SoulCompileError';
    this.issues = issues;
  }
}

/** Section headings that must be present and are compiled for this soul, in section B3 order. */
export function requiredSections(front: SoulFrontmatter): string[] {
  return SECTION_ORDER.filter((name) => {
    if (name === 'Relationships') return front.relations.length > 0;
    if (name === 'Culture Wars') return front.roles.fighter;
    if (name === 'Tycoon') return front.roles.tycoonActor;
    return true;
  });
}

/** Strings a user-authored sheet must not contain, because they would close or fake the surrounding markup. */
export function stripUserMarkup(text: string): string {
  let out = text;
  for (;;) {
    const next = out.replace(/<\/character_sheet>|<system|<\/character>/gi, '');
    if (next === out) return out;
    out = next;
  }
}

/** Frontmatter rails as the bullet list closing block B. */
export function railsList(rails: SoulFrontmatter['rails']): string {
  const lines: string[] = [];
  for (const n of rails.never) lines.push(`- never: ${n}`);
  for (const t of rails.forbiddenTopics) lines.push(`- off limits: ${t}`);
  lines.push(`- when pushed: ${rails.deflectionStyle}`);
  lines.push(`- real events: ${rails.mayReferenceRealEvents ? 'may be mentioned' : 'not mentioned'}`);
  return lines.join('\n');
}

function publicOf(front: SoulFrontmatter, assets: CompiledSoulAssets): CompiledSoulPublic {
  const pub: CompiledSoulPublic = {
    schema: 'soul-public/1',
    id: front.id,
    soulVersion: front.soulVersion,
    // Drafts never reach a bundle: tools/soul build keeps active souls only.
    status: front.status === 'retired' ? 'retired' : 'active',
    origin: front.origin,
    name: front.name,
    shortBio: front.shortBio,
    archetype: front.archetype,
    tags: [...front.tags],
    tier: front.tier,
    basis: front.likeness.basis,
    disclaimer: front.likeness.disclaimer,
    fameDomain: [...front.likeness.fameDomain],
    marketingAllowed: front.likeness.basis === 'original' || (front.tier === 'consented' && front.likeness.consentScopes.includes('marketing')),
    ugcCameo: front.tier !== 'parody',
    standIn: front.standIn,
    heightM: front.heightM,
    moves: [...front.moves],
    roles: { ...front.roles },
    locations: { districts: [...front.locations.districts], home: front.locations.home, hangouts: [...front.locations.hangouts] },
    schedule: front.schedule.map((b) => ({ ...b, days: Array.isArray(b.days) ? [...b.days] : b.days })),
    goals: [...front.goals],
    voice: { tier: front.voice.tier, voiceRef: front.voice.voiceRef, speed: front.voice.speed },
    dialogue: { modelTier: front.dialogue.modelTier, maxTurnsPerEncounter: front.dialogue.maxTurnsPerEncounter },
    stats: front.stats,
    assets,
  };
  if (front.fighter) pub.fighter = front.fighter;
  if (front.tycoon) pub.tycoon = front.tycoon;
  return pub;
}

/** Asset references derived from the soul alone. Portraits, mouth atlases, animation sets and bark pools arrive with M10a1 and M06c. */
export function deriveAssets(front: SoulFrontmatter): CompiledSoulAssets {
  return {
    model: `character/${front.id}`,
    rig: 'rig/bay_rig_v1',
    anim: [],
    portrait: null,
    mouthAtlas: null,
    voice: front.voice.voiceRef,
    ink: `data/ink.${front.id}`,
    barks: null,
  };
}

export function compileSoul(md: string, rules: RulesBlock): CompiledOutputs {
  const { front, sections } = parseSoul(md);
  const issues = validateSoul(front);
  if (issues.length) throw new SoulCompileError('frontmatter does not match soul-1.0', issues.slice(0, 8).map(formatIssue));

  const user = front.origin === 'user';
  const clean = (s: string): string => (user ? stripUserMarkup(s) : s);
  const body: string[] = [];
  const missing: string[] = [];
  for (const name of requiredSections(front)) {
    const text = sections[name];
    if (text === undefined || text.trim() === '') {
      missing.push(`## ${name}`);
      continue;
    }
    body.push(`## ${name}\n${clean(normalizeNewlines(text).replace(/[ \t]+$/gm, ''))}`);
  }
  if (missing.length) throw new SoulCompileError('required sections are missing or empty', missing);
  body.push(`## Rail list\n${clean(railsList(front.rails))}`);

  const inner = body.join('\n\n');
  const wrapped = user ? `<character_sheet origin="user" trust="untrusted">\n${inner}\n</character_sheet>` : inner;
  const promptTxt = [
    `<character id="${front.id}" version="${front.soulVersion}" tier="${front.tier}">`,
    `<limits max_words="${front.speech.maxWordsPerLine}" profanity="${front.speech.profanity}" rating="${front.rails.rating}"/>`,
    wrapped,
    '</character>',
    '',
  ].join('\n');

  const publicSoul = publicOf(front, deriveAssets(front));
  const { schema: _schema, voice: _voice, ...shared } = publicSoul;
  const compiled: Omit<CompiledSoul, 'prompt' | 'compiledAt'> = {
    ...shared,
    schema: 'soul-compiled/1',
    voice: front.voice,
    minor: false,
    likeness: front.likeness,
    visual_brief: front.visual_brief,
    speech: front.speech,
    rails: front.rails,
    sourceSha256: sha256Hex(md),
    rulesVersion: rules.version,
  };
  return { promptTxt, compiled, publicSoul };
}

/** sha256 of the canonical public JSON: the "public JSON changed" half of lint L14. */
export const publicSoulHash = (s: CompiledSoulPublic): string => sha256Hex(canonicalize(s));
export const promptHash = (promptTxt: string): string => sha256Hex(promptTxt);
