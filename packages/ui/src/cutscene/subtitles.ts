/**
 * Cutscene subtitles (10-ui-hud-xr.md section 2 item 3, R-ENG-04): a WebVTT parser for the manifest's `subs.<lang>.vtt`, and the
 * timing rule. A cue stays up for at least `max(1.5 s, 0.06 s x characters)` and never shows before its start.
 */

export interface Cue { startMs: number; endMs: number; text: string }

export const MIN_CUE_MS = 1500;
export const MS_PER_CHAR = 60;

/** How long a cue of `text` stays up at least. */
export const cueHoldMs = (text: string): number => Math.max(MIN_CUE_MS, MS_PER_CHAR * [...text].length);

/** When the cue leaves: its own end, or its start plus the hold, whichever is later. */
export const cueLeavesAtMs = (c: Cue): number => Math.max(c.endMs, c.startMs + cueHoldMs(c.text));

const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/;

function parseTime(s: string): number | null {
  const m = TIME.exec(s.trim());
  if (!m) return null;
  const [, h, min, sec, frac] = m;
  return (Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec)) * 1000 + Number((frac ?? '0').padEnd(3, '0'));
}

/** WebVTT cues (identifier line optional, tags stripped, blank-line separated). Malformed blocks are skipped. */
export function parseVtt(text: string): Cue[] {
  const out: Cue[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = (lines[at] as string).split('-->');
    const startMs = parseTime(a ?? '');
    const endMs = parseTime((b ?? '').trim().split(/\s+/)[0] ?? '');
    const body = lines.slice(at + 1).join('\n').replace(/<[^>]*>/g, '').trim();
    if (startMs === null || endMs === null || endMs <= startMs || body === '') continue;
    out.push({ startMs, endMs, text: body });
  }
  return out.sort((x, y) => x.startMs - y.startMs);
}

/** The cue to show at `tMs`: the latest cue that has started and has not left yet; null between cues. */
export function activeCue(cues: readonly Cue[], tMs: number): Cue | null {
  let hit: Cue | null = null;
  for (const c of cues) {
    if (c.startMs <= tMs && tMs < cueLeavesAtMs(c)) hit = c;
  }
  return hit;
}
