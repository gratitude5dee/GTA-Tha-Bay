/**
 * soul.md reader (spec/domains/04-npc-contracts.md section B3). Pure: takes the file text, returns the frontmatter
 * object and the Markdown sections keyed by heading. It does not validate; schema errors are the lint's job.
 */
import { parse as parseYaml } from 'yaml';
import type { SoulFrontmatter } from '../contracts/c10-npc.ts';

export class SoulParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoulParseError';
  }
}

/** Section headings in compile order (section B3). */
export const SECTION_ORDER = [
  'Identity', 'Voice', 'Personality', 'Knowledge', 'Relationships', 'Places and schedule', 'Culture Wars', 'Tycoon', 'Rails', 'Example lines',
] as const;
export const BACKSTORY_SECTION = 'Backstory';

export interface ParsedSoul {
  front: SoulFrontmatter;
  sections: Record<string, string>;
  /** Section headings in file order, for order and duplicate checks. */
  headings: string[];
}

/** CRLF to LF; nothing else changes. */
export const normalizeNewlines = (s: string): string => s.replace(/\r\n?/g, '\n');

export function splitFrontmatter(md: string): { yaml: string; body: string } {
  const text = normalizeNewlines(md.startsWith('﻿') ? md.slice(1) : md);
  if (!text.startsWith('---\n')) throw new SoulParseError('soul.md must start with a "---" frontmatter line');
  const end = text.indexOf('\n---\n', 3);
  const endAtEof = text.endsWith('\n---') ? text.length - 4 : -1;
  const at = end >= 0 ? end : endAtEof;
  if (at < 0) throw new SoulParseError('frontmatter has no closing "---" line');
  return { yaml: text.slice(4, at), body: end >= 0 ? text.slice(end + 5) : '' };
}

export function parseSoul(md: string): ParsedSoul {
  const { yaml, body } = splitFrontmatter(md);
  let front: unknown;
  try {
    front = parseYaml(yaml, { maxAliasCount: 0, uniqueKeys: true, strict: true });
  } catch (e) {
    throw new SoulParseError(`frontmatter is not valid YAML: ${(e as Error).message.split('\n')[0] ?? ''}`);
  }
  if (front === null || typeof front !== 'object' || Array.isArray(front)) throw new SoulParseError('frontmatter must be a YAML mapping');

  const sections: Record<string, string> = {};
  const headings: string[] = [];
  let current: string | null = null;
  let buf: string[] = [];
  const flush = (): void => {
    if (current !== null) sections[current] = buf.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
    buf = [];
  };
  for (const line of body.split('\n')) {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) {
      flush();
      current = m[1] as string;
      if (headings.includes(current)) throw new SoulParseError(`duplicate section "## ${current}"`);
      headings.push(current);
    } else if (current === null) {
      if (line.trim() !== '') throw new SoulParseError('text before the first "## " section');
    } else buf.push(line);
  }
  flush();
  return { front: front as SoulFrontmatter, sections, headings };
}

export interface ExampleLine { tag: string; text: string }

/** `[tag] "text"` lines of the Example lines section. Lines that do not match are returned in `bad`. */
export function parseExampleLines(section: string): { lines: ExampleLine[]; bad: string[] } {
  const lines: ExampleLine[] = [];
  const bad: string[] = [];
  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const m = /^\[([a-z][a-z-]*)\]\s*(.+)$/.exec(line);
    if (!m) {
      bad.push(line);
      continue;
    }
    let text = (m[2] as string).trim();
    const q = /^["“](.*)["”]$/s.exec(text);
    if (q) text = (q[1] as string).trim();
    lines.push({ tag: m[1] as string, text });
  }
  return { lines, bad };
}
