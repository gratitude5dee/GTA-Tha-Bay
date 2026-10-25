/**
 * The reveal rule of the dialogue bubble (M06a5, 10-ui-hud-xr.md 2.10 item 1): streamed text appears progressively and never faster than
 * the audio plays; with voice off it shows as it arrives; the full line is always available.
 *
 *  - `instant`: the text received so far (voice off, a recorded ink line, or the audio has ended).
 *  - `audio`: words in proportion to the audio clock: `floor(words * (now - start) / duration)`. While the audio is still arriving the
 *    duration is at least a speaking-rate estimate of the whole line, so the first sentence cannot reveal the rest.
 *  - `timer`: one word every `TIMER_WORD_MS`, for a voiced line whose audio clock is unavailable (the page has had no gesture yet, or no
 *    audio arrived within `AUDIO_GRACE_MS`). The line is never held back for good.
 * The count only grows, whatever the mode does.
 */

export const TIMER_WORD_MS = 180;
/** How long a voiced line waits for its first audio before it falls back to the timer. */
export const AUDIO_GRACE_MS = 1200;
/** Speaking rate used to estimate the length of audio that has not all arrived (about 150 words a minute). */
export const SPEECH_WORDS_PER_S = 2.5;

/** The scheduled window of a line's audio on the audio-context clock (`TtsPlayer.clock`). */
export interface AudioLineClock {
  startS: number;
  endS: number;
  nowS: number;
  /** Every sentence of the line is scheduled; `endS` is final. */
  complete: boolean;
}

/** What the reveal needs from the audio side. */
export interface AudioClockPort {
  /** False while the audio is locked or missing (before the first gesture). */
  available(): boolean;
  /** The line the NPC is speaking, or null before its first sentence starts and after the line has ended. */
  line(npcId: string): AudioLineClock | null;
}

export type RevealMode = 'instant' | 'audio' | 'timer' | 'hold';

/** The words of a text with the whitespace that follows each, so a prefix keeps the original spacing. */
export function wordTokens(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

export function wordCount(text: string): number {
  return wordTokens(text).length;
}

/** The first `n` words of `text`, spacing kept, no trailing space. */
export function firstWords(text: string, n: number): string {
  if (n <= 0) return '';
  const tokens = wordTokens(text);
  return n >= tokens.length ? text.trim() : tokens.slice(0, n).join('').trimEnd();
}

/** Words an audio window has revealed by `nowS` (a pure function of the clock; the caller keeps the count from shrinking). */
export function audioWords(total: number, clock: AudioLineClock): number {
  const played = Math.max(0, clock.nowS - clock.startS);
  const scheduled = Math.max(0, clock.endS - clock.startS);
  const duration = clock.complete ? scheduled : Math.max(scheduled, total / SPEECH_WORDS_PER_S);
  if (duration <= 0) return clock.complete ? total : 0;
  return Math.min(total, Math.floor((total * played) / duration));
}

/** Words the timer has revealed `elapsedMs` after it started (the first word at once). */
export function timerWords(total: number, elapsedMs: number): number {
  return Math.min(total, 1 + Math.floor(Math.max(0, elapsedMs) / TIMER_WORD_MS));
}

export interface RevealOptions {
  npcId: string;
  /** Milliseconds, monotonic. */
  nowMs: () => number;
  audio?: AudioClockPort | null;
}

export interface RevealFrame {
  /** The text to show now. */
  shown: string;
  /** Words shown and words known so far. */
  revealed: number;
  total: number;
  mode: RevealMode;
  /** Everything received so far is shown. */
  caughtUp: boolean;
}

/** One line's reveal. `feed` takes the text received so far; `tick` is called by whatever drives the frames. */
export class LineReveal {
  private text = '';
  private voiced = false;
  private count = 0;
  private forced = false;
  private fedAtMs: number | null = null;
  private timerFromMs: number | null = null;
  private sawClock = false;

  constructor(private readonly opts: RevealOptions) {}

  /** The text so far (the whole text, not a delta) and whether this line is spoken. */
  feed(fullText: string, voiced: boolean): void {
    if (this.fedAtMs === null && fullText !== '') this.fedAtMs = this.opts.nowMs();
    this.text = fullText;
    this.voiced = voiced;
  }

  /** "Show full line": everything now, and for the rest of the line. */
  showAll(): void {
    this.forced = true;
  }

  tick(): RevealFrame {
    const total = wordCount(this.text);
    const mode = this.mode();
    let n = this.count;
    if (mode === 'instant') n = total;
    else if (mode === 'audio') {
      const clock = this.opts.audio?.line(this.opts.npcId);
      if (clock) n = Math.max(n, audioWords(total, clock));
    } else if (mode === 'timer') {
      const now = this.opts.nowMs();
      this.timerFromMs ??= now;
      n = Math.max(n, timerWords(total, now - this.timerFromMs));
    }
    this.count = Math.min(Math.max(this.count, n), total);
    return { shown: firstWords(this.text, this.count), revealed: this.count, total, mode, caughtUp: this.count >= total };
  }

  private mode(): RevealMode {
    if (this.forced || !this.voiced) return 'instant';
    const audio = this.opts.audio ?? null;
    if (audio === null || !audio.available()) return 'timer';
    if (audio.line(this.opts.npcId) !== null) {
      this.sawClock = true;
      return 'audio';
    }
    // The audio of this line has played out: nothing more to wait for.
    if (this.sawClock) return 'instant';
    // Not started yet: wait a moment for the first sentence, then stop waiting.
    const waited = this.fedAtMs === null ? 0 : this.opts.nowMs() - this.fedAtMs;
    return waited < AUDIO_GRACE_MS ? 'hold' : 'timer';
  }
}
