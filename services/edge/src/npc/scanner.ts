/**
 * The partial-JSON scanner of the dialogue stream (04-npc.md section 5.1 step 6). The model answers with one JSON object
 * (`npc-turn-1.0`) whose first property is `line`, so the text of the line can be shown while the rest of the object is still arriving.
 *
 * `partialLine(buffer)` reads the text received so far and returns the decoded value of the top-level `"line"` string up to the last
 * complete character, and whether the closing quote has arrived. It is a pure function of the buffer, so any split of the text into
 * chunks gives the same result at every boundary (the chunk-split tests of AC-10). Nothing here logs or stores text.
 */
export interface PartialLine {
  /** The decoded `line` value so far. */
  text: string;
  /** The closing quote of the value has been read. */
  closed: boolean;
}

const WS = /\s/;
const SIMPLE_ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/** End index (exclusive) of the string that starts at `from` (a quote), or -1 when it is not complete yet. */
function stringEnd(buf: string, from: number): number {
  for (let i = from + 1; i < buf.length; i++) {
    const c = buf[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '"') return i + 1;
  }
  return -1;
}

/** End index (exclusive) of any JSON value that starts at `from`, or -1 when it is not complete yet. */
function valueEnd(buf: string, from: number): number {
  const c = buf[from];
  if (c === undefined) return -1;
  if (c === '"') return stringEnd(buf, from);
  if (c === '{' || c === '[') {
    let depth = 0;
    for (let i = from; i < buf.length; i++) {
      const d = buf[i];
      if (d === '"') {
        const e = stringEnd(buf, i);
        if (e < 0) return -1;
        i = e - 1;
      } else if (d === '{' || d === '[') depth++;
      else if (d === '}' || d === ']') {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }
  // number, true, false, null: ends at a delimiter, which must have arrived
  for (let i = from; i < buf.length; i++) {
    const d = buf[i] as string;
    if (d === ',' || d === '}' || d === ']' || WS.test(d)) return i;
  }
  return -1;
}

/** Decodes the string body that starts after the opening quote at `from - 1`. Stops before an escape that is not complete. */
function decodeString(buf: string, from: number): PartialLine {
  let out = '';
  for (let i = from; i < buf.length; i++) {
    const c = buf[i] as string;
    if (c === '"') return { text: out, closed: true };
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = buf[i + 1];
    if (n === undefined) return { text: out, closed: false };
    const simple = SIMPLE_ESCAPES[n];
    if (simple !== undefined) {
      out += simple;
      i++;
      continue;
    }
    if (n === 'u') {
      const hex = buf.slice(i + 2, i + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return { text: out, closed: false };
      const code = parseInt(hex, 16);
      if (code >= 0xd800 && code <= 0xdbff) {
        // a high surrogate waits for its pair, so a split pair is never shown as two broken characters
        const low = /^\\u([dD][c-fC-F][0-9a-fA-F]{2})/.exec(buf.slice(i + 6, i + 12));
        if (low === null) return { text: out, closed: false };
        out += String.fromCharCode(code, parseInt(low[1] as string, 16));
        i += 11;
        continue;
      }
      out += String.fromCharCode(code);
      i += 5;
      continue;
    }
    // an escape JSON does not have: keep the character, as a lenient reader would
    out += n;
    i++;
  }
  return { text: out, closed: false };
}

/** The decoded top-level `line` value in `buf`, or null while it has not started. */
export function partialLine(buf: string): PartialLine | null {
  let i = 0;
  const skipWs = (): void => {
    while (i < buf.length && WS.test(buf[i] as string)) i++;
  };
  skipWs();
  if (buf[i] !== '{') return null;
  i++;
  for (;;) {
    skipWs();
    if (buf[i] === ',') {
      i++;
      skipWs();
    }
    if (buf[i] !== '"') return null;
    const keyEnd = stringEnd(buf, i);
    if (keyEnd < 0) return null;
    const key = buf.slice(i + 1, keyEnd - 1);
    i = keyEnd;
    skipWs();
    if (buf[i] !== ':') return null;
    i++;
    skipWs();
    if (key === 'line') {
      if (buf[i] !== '"') return null;
      return decodeString(buf, i + 1);
    }
    const end = valueEnd(buf, i);
    if (end < 0) return null;
    i = end;
  }
}

/** Feeds text deltas in and hands back the new part of the line each time. */
export class LineScanner {
  private buf = '';
  private shown = 0;
  private done = false;

  /** Appends a delta. Returns the new line text since the last call (empty when nothing new is complete). */
  feed(delta: string): string {
    this.buf += delta;
    const p = partialLine(this.buf);
    if (p === null) return '';
    if (p.closed) this.done = true;
    const fresh = p.text.slice(this.shown);
    this.shown = p.text.length;
    return fresh;
  }

  /** The whole text received. */
  text(): string {
    return this.buf;
  }

  /** The closing quote of `line` has arrived. */
  get lineClosed(): boolean {
    return this.done;
  }
}
