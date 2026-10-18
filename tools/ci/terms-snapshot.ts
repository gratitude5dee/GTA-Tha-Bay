/**
 * legal:snapshot. Stores the ten vendor texts of 05-assets-pipeline.md section 9 under docs/legal/vendor-terms/ and
 * keeps docs/legal/vendor-terms/index.json ({url, path, sha256, checked_at, status}).
 *
 *   tsx tools/ci/terms-snapshot.ts [--only <id>] [--date YYYY-MM-DD]   fetch, strip to text, write, update index
 *   tsx tools/ci/terms-snapshot.ts --verify                            offline: recompute hashes against the index
 *
 * A page that cannot be fetched, or that renders no text without JavaScript, is recorded as `pending-manual`; the
 * operator saves the text by hand later. --verify still passes for those entries.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { finding, type GateFinding } from '../../packages/shared/src/assets/gates/types.ts';
import { args } from './run.ts';
import { isMain, report, sha256Hex, toolsRoot } from './lib/common.ts';

const GATE = 'legal:snapshot';
const DIR = 'docs/legal/vendor-terms';
const MIN_TEXT_CHARS = 1500;

export interface TermsSource { id: string; vendor: string; title: string; url: string | null }

/** The ten texts (M00b "Vendor-terms snapshots"). The H3 Q&A has no URL in the research: pending-manual. */
export const TERMS_SOURCES: readonly TermsSource[] = [
  { id: 'fal-tos', vendor: 'fal', title: 'fal Terms of Service', url: 'https://fal.ai/legal/terms-of-service' },
  { id: 'fal-aup', vendor: 'fal', title: 'fal Acceptable Use Policy', url: 'https://fal.ai/legal/acceptable-use-policy' },
  { id: 'fal-api-services', vendor: 'fal', title: 'fal API Services Terms', url: 'https://fal.ai/legal/api-services' },
  { id: 'minimax-h3-license', vendor: 'minimax', title: 'MiniMax H3 Community License', url: 'https://huggingface.co/MiniMaxAI/MiniMax-H3/raw/main/LICENSE' },
  { id: 'minimax-h3-qa', vendor: 'minimax', title: 'MiniMax H3 licence Q&A', url: null },
  { id: 'minimax-platform-tos', vendor: 'minimax', title: 'MiniMax Open Platform Terms of Service', url: 'https://platform.minimax.io/protocol/terms-of-service' },
  { id: 'gemini-api-terms', vendor: 'google', title: 'Gemini API Additional Terms of Service', url: 'https://ai.google.dev/gemini-api/terms' },
  { id: 'ltx-license', vendor: 'lightricks', title: 'LTX-2 licence (LICENSE-2_x)', url: 'https://raw.githubusercontent.com/Lightricks/LTX-2/main/LICENSE-2_x' },
  { id: 'elevenlabs-music', vendor: 'elevenlabs', title: 'ElevenLabs Eleven Music model-specific terms', url: 'https://elevenlabs.io/eleven-music-model-specific-terms' },
  { id: 'openai-usage-policies', vendor: 'openai', title: 'OpenAI usage policies', url: 'https://openai.com/policies/usage-policies/' },
];

export type TermsStatus = 'fetched' | 'pending-manual';

export interface TermsEntry {
  id: string;
  title: string;
  url: string | null;
  path: string;
  sha256: string | null;
  checked_at: string;
  status: TermsStatus;
  note?: string;
}

export interface TermsIndex { schema: 'vendor-terms-index/1'; entries: TermsEntry[] }

export function snapshotPath(id: string, date: string): string {
  return `${DIR}/${id}-${date}.md`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };

/** HTML to plain text: drops scripts and styles, keeps block structure as line breaks. Plain text passes through. */
export function htmlToText(input: string): string {
  if (!/<(html|body|div|p|h1|h2|section|article|main)[\s>]/i.test(input)) return input.replace(/\r\n/g, '\n').trim();
  let s = input.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/ul|\/ol)\b[^>]*>/gi, '\n').replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return s.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').trim();
}

async function fetchText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'tha-bay-terms-snapshot/1.0' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (first) {
    // Node's fetch does not use the proxy environment by default; curl does.
    const res = spawnSync('curl', ['-fsSL', '--max-time', '60', '-A', 'tha-bay-terms-snapshot/1.0', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (res.status === 0 && res.stdout) return res.stdout;
    throw new Error(`${(first as Error).message}; curl exit ${res.status}`);
  }
}

export function renderSnapshot(src: TermsSource, text: string, date: string): string {
  return `# ${src.title}\n\n- source: ${src.url}\n- fetched: ${date}\n- stored as plain text by tools/ci/terms-snapshot.ts; the vendor page is authoritative\n\n---\n\n${text}\n`;
}

export function readIndex(root: string): TermsIndex | null {
  const p = path.join(root, DIR, 'index.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as TermsIndex) : null;
}

/** Offline verification: ten entries, hashes of stored files match, entries without a file are pending-manual. */
export function verifyIndex(root: string): { findings: GateFinding[]; scanned: number } {
  const findings: GateFinding[] = [];
  const idx = readIndex(root);
  const file = `${DIR}/index.json`;
  if (!idx) return { findings: [finding(GATE, file, 'index-missing', 'index.json does not exist')], scanned: 0 };
  if (idx.entries.length !== TERMS_SOURCES.length) findings.push(finding(GATE, file, 'entry-count', `expected ${TERMS_SOURCES.length} entries, found ${idx.entries.length}`));
  for (const src of TERMS_SOURCES) if (!idx.entries.some((e) => e.id === src.id)) findings.push(finding(GATE, file, 'entry-missing', `no entry for ${src.id}`));
  for (const e of idx.entries) {
    if (e.status === 'pending-manual') {
      if (e.sha256 !== null) findings.push(finding(GATE, e.path, 'pending-has-hash', `${e.id}: pending-manual entries carry no hash`));
      continue;
    }
    if (e.status !== 'fetched') {
      findings.push(finding(GATE, e.path, 'bad-status', `${e.id}: status ${String(e.status)}`));
      continue;
    }
    const abs = path.join(root, e.path);
    if (!existsSync(abs)) findings.push(finding(GATE, e.path, 'file-missing', `${e.id}: stored file does not exist`));
    else if (sha256Hex(readFileSync(abs)) !== e.sha256) findings.push(finding(GATE, e.path, 'hash-mismatch', `${e.id}: SHA-256 differs from the index`));
  }
  return { findings, scanned: idx.entries.length };
}

export async function snapshotAll(root: string, date: string, only?: string): Promise<TermsIndex> {
  const prev = readIndex(root);
  const entries: TermsEntry[] = [];
  mkdirSync(path.join(root, DIR), { recursive: true });
  for (const src of TERMS_SOURCES) {
    const old = prev?.entries.find((e) => e.id === src.id);
    if (only && src.id !== only && old) {
      entries.push(old);
      continue;
    }
    const rel = snapshotPath(src.id, date);
    const pending = (note: string): TermsEntry => ({ id: src.id, title: src.title, url: src.url, path: rel, sha256: null, checked_at: date, status: 'pending-manual', note });
    if (!src.url) {
      entries.push(pending('no URL in the research; save the text by hand'));
      continue;
    }
    try {
      const text = htmlToText(await fetchText(src.url));
      if (text.length < MIN_TEXT_CHARS) {
        entries.push(pending(`page returned ${text.length} characters of text (renders only with JavaScript?); save the text by hand`));
        continue;
      }
      const body = renderSnapshot(src, text, date);
      writeFileSync(path.join(root, rel), body);
      entries.push({ id: src.id, title: src.title, url: src.url, path: rel, sha256: sha256Hex(Buffer.from(body)), checked_at: date, status: 'fetched' });
    } catch (e) {
      entries.push(pending(`fetch failed: ${(e as Error).message}; save the text by hand`));
    }
  }
  const index: TermsIndex = { schema: 'vendor-terms-index/1', entries };
  writeFileSync(path.join(root, DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: args(),
    options: { verify: { type: 'boolean', default: false }, only: { type: 'string' }, date: { type: 'string' }, root: { type: 'string' } },
  });
  const root = path.resolve(values.root ?? toolsRoot);
  if (values.verify) {
    const { findings, scanned } = verifyIndex(root);
    const idx = readIndex(root);
    if (idx) console.log(`${GATE}: ${idx.entries.filter((e) => e.status === 'fetched').length} fetched, ${idx.entries.filter((e) => e.status === 'pending-manual').length} pending-manual`);
    process.exit(report(GATE, findings, scanned));
  }
  const date = values.date ?? new Date().toISOString().slice(0, 10);
  const idx = await snapshotAll(root, date, values.only);
  for (const e of idx.entries) console.log(`${e.status === 'fetched' ? 'fetched       ' : 'pending-manual'} ${e.id} ${e.note ?? ''}`.trimEnd());
  process.exit(0);
}

if (isMain(import.meta.url)) void main();
