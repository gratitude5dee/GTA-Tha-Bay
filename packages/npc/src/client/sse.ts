import type { DialogueEvent } from '@dv/shared/contracts/c10-npc';

/**
 * Server-sent-events framing for the dialogue stream (route 31). `EventSource` cannot POST, so the client reads the response body
 * itself (04-npc.md section 5.1, Client). The parser takes text in chunks of any size and cuts frames only at a blank line, so a chunk
 * boundary inside an event, inside a line, or between the CR and the LF of a CRLF never loses or splits anything.
 */
export interface SseFrame {
  event: string;
  data: string;
}

export class SseParser {
  private buf = '';

  /** Adds a chunk and returns the frames it completed. */
  feed(chunk: string): SseFrame[] {
    this.buf += chunk;
    const out: SseFrame[] = [];
    // normalise only complete line ends; a trailing lone CR may still become CRLF with the next chunk
    for (;;) {
      const m = /\r\n\r\n|\n\n|\r\r/.exec(this.buf);
      if (m === null) break;
      const block = this.buf.slice(0, m.index);
      this.buf = this.buf.slice(m.index + m[0].length);
      const frame = parseBlock(block);
      if (frame !== null) out.push(frame);
    }
    return out;
  }

  /** Bytes held back because their frame is not complete. */
  pending(): number {
    return this.buf.length;
  }
}

function parseBlock(block: string): SseFrame | null {
  let event = 'message';
  const data: string[] = [];
  for (const raw of block.split(/\r\n|\n|\r/)) {
    if (raw === '' || raw.startsWith(':')) continue; // comment or keep-alive
    const colon = raw.indexOf(':');
    const field = colon < 0 ? raw : raw.slice(0, colon);
    const value = colon < 0 ? '' : raw.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length === 0 ? null : { event, data: data.join('\n') };
}

const EVENTS: ReadonlySet<string> = new Set(['meta', 'line.delta', 'line.done', 'effects', 'fallback', 'done']);

/** A frame as a C10 `DialogueEvent`, or null for an event name the contract does not have or a body that is not JSON. */
export function toDialogueEvent(f: SseFrame): DialogueEvent | null {
  if (!EVENTS.has(f.event)) return null;
  try {
    const data = JSON.parse(f.data) as unknown;
    if (typeof data !== 'object' || data === null) return null;
    return { event: f.event, data } as DialogueEvent;
  } catch {
    return null;
  }
}
