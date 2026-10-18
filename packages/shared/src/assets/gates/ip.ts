/**
 * Pure cores of ip:signatures, ip:extensions and ip:strings (research/legal-ip-likeness.md section 2.4).
 * No IO, no clock: the CLIs in tools/ci read files and call these. The terms, extensions and needles come from
 * config/ip-denylist.json so that no denylisted string appears in source.
 */
import { finding, type GateFinding } from './types.ts';

export interface IpDenylistConfig {
  schema: 'ip-denylist/1';
  /** Case-insensitive substring terms. */
  terms: string[];
  /** Case-insensitive terms matched on word boundaries. */
  words: string[];
  /** Extra regular expressions (id, source, flags). */
  patterns: { id: string; regex: string; flags: string }[];
  /** R-NAME-2 shipped-name regex. */
  nameRegex: { regex: string; flags: string };
  /** Lower-case extensions with a leading dot. */
  extensions: string[];
  /** Byte strings searched in the WASM `name` section. */
  wasmNameNeedles: string[];
  /** Face-detector model strings (likeness:gate). */
  faceDetectorTerms: string[];
  /** Header words that make a `.dat` file under `data/` a denylisted data table. */
  datHeaderTerms: string[];
  /** Full-string exceptions; matched by the whole string, never by path. */
  exceptions: { match: string; reason: string }[];
}

const GATE_SIG = 'ip:signatures';
const GATE_EXT = 'ip:extensions';
const GATE_STR = 'ip:strings';

// ---------------------------------------------------------------------------------------------
// byte helpers

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function startsWithBytes(bytes: Uint8Array, magic: ArrayLike<number>, offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[offset + i] !== magic[i]) return false;
  return true;
}

export function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0];
  if (first === undefined) return from;
  let i = hay.indexOf(first, from);
  while (i >= 0 && i + needle.length <= hay.length) {
    let j = 1;
    while (j < needle.length && hay[i + j] === needle[j]) j++;
    if (j === needle.length) return i;
    i = hay.indexOf(first, i + 1);
  }
  return -1;
}

function u32le(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;
}

function readLeb(b: Uint8Array, at: number): { value: number; next: number } | null {
  let result = 0;
  let mul = 1;
  let i = at;
  for (let n = 0; n < 5; n++, i++) {
    const byte = b[i];
    if (byte === undefined) return null;
    result += (byte & 0x7f) * mul;
    mul *= 128;
    if ((byte & 0x80) === 0) return { value: result, next: i + 1 };
  }
  return null;
}

// Magic numbers (research/legal-ip-likeness.md section 2.4): bytes, not text.
const MAGIC_RPF7 = [0x37, 0x46, 0x50, 0x52];
const MAGIC_RSC7 = [0x52, 0x53, 0x43, 0x37];
const MAGIC_GXT2 = [0x32, 0x54, 0x58, 0x47];
const MAGIC_DXBC = [0x44, 0x58, 0x42, 0x43];
const MAGIC_WASM = [0x00, 0x61, 0x73, 0x6d];
const MAGIC_ZIP = [0x50, 0x4b, 0x03, 0x04];
const MAGIC_IMG_V2 = [0x56, 0x45, 0x52, 0x32];
const RW_CLUMP = 0x10;
const RW_TEXDICT = 0x16;

export function extensionOf(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? '';
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i).toLowerCase();
}

function wasmNameSectionHas(bytes: Uint8Array, needles: Uint8Array[]): boolean {
  let at = 8;
  while (at < bytes.length) {
    const id = bytes[at];
    const size = readLeb(bytes, at + 1);
    if (id === undefined || !size) return false;
    const end = size.next + size.value;
    if (end > bytes.length) return false;
    if (id === 0) {
      const nameLen = readLeb(bytes, size.next);
      if (nameLen) {
        const nameEnd = nameLen.next + nameLen.value;
        const secName = String.fromCharCode(...bytes.subarray(nameLen.next, Math.min(nameEnd, nameLen.next + 16)));
        if (secName === 'name') {
          const payload = bytes.subarray(nameEnd, end);
          if (needles.some((n) => indexOfBytes(payload, n) >= 0)) return true;
        }
      }
    }
    at = end;
  }
  return false;
}

/** ip:signatures: magic bytes and structures of other publishers' formats. `path` only selects the extension rules. */
export function scanSignatures(path: string, bytes: Uint8Array, cfg: Pick<IpDenylistConfig, 'wasmNameNeedles'>): GateFinding[] {
  const out: GateFinding[] = [];
  const add = (rule: string, detail: string): void => {
    out.push(finding(GATE_SIG, path, rule, detail));
  };
  if (startsWithBytes(bytes, MAGIC_RPF7)) add('sig-rpf7', 'archive magic at offset 0');
  if (startsWithBytes(bytes, MAGIC_RSC7)) add('sig-rsc7', 'resource magic at offset 0');
  if (startsWithBytes(bytes, MAGIC_GXT2)) add('sig-gxt2', 'text table magic at offset 0');
  const ext = extensionOf(path);
  if ((ext === '.fxc' || ext === '.bin') && indexOfBytes(bytes, Uint8Array.from(MAGIC_DXBC)) >= 0) {
    add('sig-dxbc', 'compiled shader container');
  }
  if (startsWithBytes(bytes, MAGIC_WASM) && wasmNameSectionHas(bytes, cfg.wasmNameNeedles.map(ascii))) {
    add('sig-wasm-name', 'WASM name section carries a denylisted symbol prefix');
  }
  if (startsWithBytes(bytes, MAGIC_ZIP) && indexOfBytes(bytes, ascii('assembly.xml')) >= 0) {
    add('sig-oiv-package', 'zip with assembly.xml');
  }
  if ((ext === '.dff' || ext === '.txd') && bytes.length >= 12) {
    const type = u32le(bytes, 0);
    const size = u32le(bytes, 4);
    const stamp = u32le(bytes, 8);
    if ((type === RW_CLUMP || type === RW_TEXDICT) && size + 12 <= bytes.length && stamp >>> 16 !== 0) {
      add('sig-renderware', 'RenderWare chunk header');
    }
  }
  if (startsWithBytes(bytes, MAGIC_IMG_V2) && bytes.length >= 8 && 8 + u32le(bytes, 4) * 32 <= bytes.length) {
    add('sig-img-v2', 'IMG v2 archive header');
  }
  return out;
}

/**
 * ip:extensions. `head` (first bytes, optional) is only used for `.dat`, which fails only under a `data/` path
 * with a header word from datHeaderTerms.
 */
export function scanExtension(path: string, cfg: Pick<IpDenylistConfig, 'extensions' | 'datHeaderTerms'>, head?: Uint8Array): GateFinding[] {
  const ext = extensionOf(path);
  if (ext === '') return [];
  if (ext === '.dat') {
    const inData = path.replace(/\\/g, '/').split('/').includes('data');
    if (!inData || !head) return [];
    const text = String.fromCharCode(...head.subarray(0, 512)).toLowerCase();
    if (!cfg.datHeaderTerms.some((t) => text.includes(t.toLowerCase()))) return [];
    return [finding(GATE_EXT, path, 'ext-dat-data', 'data table with a denylisted header')];
  }
  return cfg.extensions.includes(ext) ? [finding(GATE_EXT, path, 'ext-denylisted', `extension ${ext}`)] : [];
}

// ---------------------------------------------------------------------------------------------
// strings

export interface StringMatcher {
  exceptions: string[];
  terms: RegExp | null;
  words: RegExp | null;
  patterns: { id: string; re: RegExp }[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compileStringMatcher(cfg: Pick<IpDenylistConfig, 'terms' | 'words' | 'patterns' | 'exceptions'>): StringMatcher {
  const alt = (list: string[]): string => list.map(escapeRe).join('|');
  return {
    exceptions: cfg.exceptions.map((e) => e.match).filter((m) => m.length > 0),
    terms: cfg.terms.length ? new RegExp(alt(cfg.terms), 'gi') : null,
    words: cfg.words.length ? new RegExp(`\\b(?:${alt(cfg.words)})\\b`, 'gi') : null,
    patterns: cfg.patterns.map((p) => ({ id: p.id, re: new RegExp(p.regex, p.flags.includes('g') ? p.flags : `${p.flags}g`) })),
  };
}

/** Base64 runs of 256+ characters and `data:` URLs become spaces (length preserved) before a dist scan. */
export function stripEncodedBlobs(text: string): string {
  const blank = (m: string): string => ' '.repeat(m.length);
  return text.replace(/data:[^,\s'"`)]*,[^\s'"`)]*/g, blank).replace(/[A-Za-z0-9+/=]{256,}/g, blank);
}

export function removeExceptions(text: string, exceptions: readonly string[]): string {
  let out = text;
  for (const ex of exceptions) out = out.split(ex).join(' '.repeat(ex.length));
  return out;
}

export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export interface StringHit { line: number; rule: string; match: string }

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < index; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

/** All denylist hits in `text` (exceptions removed first), at most `limit`. */
export function scanText(text: string, m: StringMatcher, limit = 20): StringHit[] {
  const t = removeExceptions(text, m.exceptions);
  const hits: StringHit[] = [];
  const run = (re: RegExp | null, rule: string): void => {
    if (!re) return;
    re.lastIndex = 0;
    let x = re.exec(t);
    while (x && hits.length < limit) {
      hits.push({ line: lineOf(t, x.index), rule, match: x[0].toLowerCase() });
      if (x[0].length === 0) re.lastIndex++;
      x = re.exec(t);
    }
  };
  run(m.terms, 'str-term');
  run(m.words, 'str-word');
  for (const p of m.patterns) run(p.re, `str-pattern:${p.id}`);
  return hits;
}

/** ip:strings for one file. Callers apply the path allowlist and the binary skip. */
export function scanStrings(path: string, text: string, m: StringMatcher): GateFinding[] {
  return scanText(text, m).map((h) => finding(GATE_STR, path, h.rule, `line ${h.line}: ${h.match}`));
}
