/**
 * Deterministic soul.md writer of the NPC builder (spec/domains/04-npc-builder.md section C4, M06b1). Pure: no clock, network or randomness.
 *
 * The model writes the subset in `soul-1.0.llm.schema.json` (`LlmSoul`). The server owns every other field (`BuilderServerFields`):
 * `assembleSoul` merges the two into a `SoulFrontmatter` plus the Markdown sections, `writeSoulMd` turns them into soul.md bytes (YAML
 * frontmatter in a fixed key order, sections in the order of section B3), and `deriveInk` writes the minimal ink source of the fallback knots from the
 * tagged example lines. The same inputs always give the same bytes (golden in packages/shared/test/npc/soul-write.spec.ts).
 */
import { Document, isScalar, visit } from 'yaml';
import type { Archetype, ScheduleBlock, SoulFrontmatter } from '../contracts/c10-npc.ts';
import { sha256Hex } from '../hash.ts';
import { stripUserMarkup } from './compile.ts';
import { parseExampleLines } from './parse.ts';

/** What the model writes (the shape of soul-1.0.llm.schema.json). Optional source fields arrive as null. */
export interface LlmSoul {
  shortBio: string;
  speech: {
    register: string[];
    dialectNotes: string | null;
    lexicon: { term: string; gloss: string; freq: 'rare' | 'sometimes' | 'often' }[];
    catchphrases: string[];
    avoid: string[];
    verbosity: 'terse' | 'normal' | 'chatty';
    maxWordsPerLine: number;
    profanity: 'none' | 'mild' | 'strong';
    languages: string[];
  };
  personality: SoulFrontmatter['personality'];
  knowledge: { knows: string[]; doesNotKnow: string[]; era: string };
  locations: { home: string; hangouts: string[] };
  schedule: ScheduleBlock[];
  goals: string[];
  visual_brief: string;
  rails: { forbiddenTopics: string[]; never: string[]; deflectionStyle: string };
  sections: {
    identity: string;
    voice: string;
    personality: string;
    knowledge: string;
    placesAndSchedule: string;
    rails: string;
    exampleLines: { tag: string; text: string }[];
  };
  realPersonSuspected: boolean;
  namedPeople: string[];
}

/** The fields the server fills in (section C4 "Server-owned fields"). */
export interface BuilderServerFields {
  npcId: string;
  soulVersion: number;
  ownerProfileId: string;
  name: string;
  archetype: Archetype;
  tags: readonly string[];
  /** The draft's chosen district; the soul lives there. */
  district: string;
  /** `voice/<id>` of a t1 synthetic voice from the catalog, or null for a text-only NPC. */
  voiceRef: string | null;
  heightM: number;
  /** The model id and the UTC date (YYYY-MM-DD) of the generation, for provenance. */
  model: string;
  date: string;
}

/** The sections of a soul in the order of section B3 that the builder writes. */
export const BUILDER_SECTIONS = ['Identity', 'Voice', 'Personality', 'Knowledge', 'Places and schedule', 'Rails', 'Example lines'] as const;

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Section text with CRLF folded, trailing blanks removed and no line that would start a new `## ` section. */
export function cleanSectionText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, '').replace(/^\s{0,3}#{1,6}(\s|$)/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function exampleLinesText(lines: readonly { tag: string; text: string }[]): string {
  return lines.map((l) => `[${l.tag}] "${oneLine(l.text).replace(/^["“]+|["”]+$/g, '')}"`).join('\n');
}

export interface AssembledSoul {
  front: SoulFrontmatter;
  sections: Record<string, string>;
}

/** Merges the model's output with the server-owned fields. Nothing is validated here; the schema and the lints run on the result. */
export function assembleSoul(server: BuilderServerFields, llm: LlmSoul): AssembledSoul {
  const id = server.npcId;
  const sections: Record<string, string> = {
    Identity: cleanSectionText(llm.sections.identity),
    Voice: cleanSectionText(llm.sections.voice),
    Personality: cleanSectionText(llm.sections.personality),
    Knowledge: cleanSectionText(llm.sections.knowledge),
    'Places and schedule': cleanSectionText(llm.sections.placesAndSchedule),
    Rails: cleanSectionText(llm.sections.rails),
    'Example lines': exampleLinesText(llm.sections.exampleLines),
  };
  const body = BUILDER_SECTIONS.map((n) => `## ${n}\n${sections[n] ?? ''}`).join('\n\n');
  const speech: SoulFrontmatter['speech'] = {
    register: llm.speech.register,
    ...(llm.speech.dialectNotes === null ? {} : { dialectNotes: llm.speech.dialectNotes }),
    lexicon: llm.speech.lexicon,
    catchphrases: llm.speech.catchphrases,
    avoid: llm.speech.avoid,
    verbosity: llm.speech.verbosity,
    maxWordsPerLine: llm.speech.maxWordsPerLine,
    profanity: llm.speech.profanity,
    languages: llm.speech.languages,
  };
  const front: SoulFrontmatter = {
    schema: 'soul/1.0',
    id,
    soulVersion: server.soulVersion,
    status: 'draft',
    origin: 'user',
    ownerProfileId: server.ownerProfileId,
    name: server.name,
    shortBio: oneLine(llm.shortBio),
    archetype: server.archetype,
    tags: [...server.tags],
    tier: 'fictionalized',
    minor: false,
    likeness: {
      basis: 'original',
      subjectId: null,
      consentRecordId: null,
      consentScopes: [],
      deceased: false,
      faceReferenceAllowed: false,
      fameDomain: [],
      nameDistanceOk: true,
      disclaimer: 'fictional',
    },
    visual_brief: oneLine(llm.visual_brief),
    standIn: null,
    heightM: server.heightM,
    moves: [],
    roles: { hero: false, questGiver: false, vendor: false, fighter: false, tycoonActor: false, racer: false },
    speech,
    voice: { tier: server.voiceRef === null ? 'text' : 't1', design_prompt: '', voiceRef: server.voiceRef, speed: 1 },
    personality: llm.personality,
    knowledge: { knows: llm.knowledge.knows, doesNotKnow: llm.knowledge.doesNotKnow, era: llm.knowledge.era, realWorldRefs: 'none' },
    relations: [],
    locations: { districts: [server.district], home: llm.locations.home, hangouts: llm.locations.hangouts },
    schedule: llm.schedule,
    goals: llm.goals,
    stats: {},
    rails: {
      rating: 'T',
      forbiddenTopics: llm.rails.forbiddenTopics,
      never: llm.rails.never,
      deflectionStyle: llm.rails.deflectionStyle,
      mayReferenceRealEvents: false,
    },
    dialogue: {
      modelTier: 'haiku',
      maxTurnsPerEncounter: 12,
      ink: `content-private/npcs/${id}/${id}.ink`,
      barkPool: `content-private/npcs/${id}/barks.json`,
    },
    provenance: {
      authoredBy: 'user',
      generatedBy: { model: server.model, date: server.date },
      reviewedBy: null,
      reviewedAt: null,
      contentSha256: sha256Hex(body),
    },
  };
  return { front, sections };
}

/** soul.md bytes: `---`, the frontmatter as block YAML in the key order of the object, `---`, then the sections. */
export function writeSoulMd(front: SoulFrontmatter, sections: Readonly<Record<string, string>>): string {
  const doc = new Document(front, { aliasDuplicateObjects: false });
  // Clock strings stay quoted so a YAML 1.1 reader does not take "09:00" for a number.
  visit(doc, {
    Scalar(_key, node) {
      if (isScalar(node) && typeof node.value === 'string' && /^\d\d:\d\d$/.test(node.value)) node.type = 'QUOTE_DOUBLE';
    },
  });
  const yaml = doc.toString({ lineWidth: 0 });
  const body = BUILDER_SECTIONS.map((n) => `## ${n}\n${sections[n] ?? ''}`).join('\n\n');
  return `---\n${yaml}---\n${body}\n`;
}

/** The knots every ink file needs (tools/soul REQUIRED_KNOTS) and the example-line tag each is drawn from. */
const KNOT_FROM_TAG: readonly (readonly [knot: string, tag: string, index: number])[] = [
  ['greeting', 'greeting', 0],
  ['smalltalk', 'mission', 0],
  ['busy', 'deflect', 1],
  ['deflect', 'deflect', 0],
  ['farewell', 'farewell', 0],
];

/** Characters that mean something to the ink compiler at the start of a line or inside one. */
const inkSafe = (s: string): string => oneLine(s).replace(/[{}|\\]/g, '').replace(/^[-=>~*+<]+\s*/, '').replace(/\/\/|\/\*|\*\//g, ' ');

/**
 * A minimal ink file with the five knots of the fallback path (`greeting`, `smalltalk`, `busy`, `deflect`, `farewell`), each one line taken from the
 * tagged example lines. A tag with no line (or too few) falls back to the first line of the same tag, then to the first line at all.
 */
export function deriveInk(exampleLines: string): string {
  const { lines } = parseExampleLines(exampleLines);
  const pick = (tag: string, index: number): string => {
    const same = lines.filter((l) => l.tag === tag);
    return inkSafe((same[index] ?? same[0] ?? lines[0])?.text ?? '...');
  };
  const out: string[] = ['// Fallback lines derived from the example lines of the soul (NPC builder, M06b1).', ''];
  for (const [knot, tag, index] of KNOT_FROM_TAG) out.push(`=== ${knot} ===`, pick(tag, index), '-> END', '');
  return out.join('\n');
}

/** The `<character_sheet>` wrapper strings the model must not see in user text (compile strips the same set from the prompt). */
export const stripSheetMarkup = stripUserMarkup;
