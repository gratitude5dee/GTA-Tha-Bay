/**
 * DialogueSession (M06a5, 04-npc.md 5.1 client, 5.5, 5.10): the main-thread adapter that turns `NpcRuntime` events into the view state of
 * the dialogue bubble. It owns no UI; `DialogueBubble` renders `state()`.
 *
 *  - Opens on `sys.dialogue.open` (`bindDialogueOpen`; the Talk handler of M06c and `__dvBridge.npc.talk` in QA builds patch it) and
 *    closes on `done {closed:true}`, a `farewell` intent, Esc, `UiBack` or the Close button.
 *  - The line is revealed by `LineReveal` (never ahead of the audio); the full line is always one call away (`showFull`).
 *  - The AI character badge is on for as long as the panel is open, ink fallback lines included.
 *  - A `fallback` event swaps in the ink lines that follow, with no error state of any kind.
 *  - The safety card shows for typed self-harm text, for `meta.data.safety === 'crisis'`, and stays after `effects.endConversation`.
 *  - The likeness card shows once per save profile for a non-original NPC, before the first line; `markMet` tells the talk path.
 *  - Each finished line is patched as `hud.subtitle` and stays at least `max(1.5 s, 0.06 s per character)`.
 */
import type { DialogueEvent, NPCDialogueContext, NPCDialogueRequest, PlayerIntent } from '@dv/shared/contracts/c10-npc';
import { hasSelfHarm } from '@dv/shared/npc/safety-lists';
import { reportRequest, type DialogueReportClient, type ReportCategory } from './capabilities.ts';
import { LineReveal, type AudioClockPort } from './reveal.ts';

export const DIALOGUE_OPEN_KEY = 'sys.dialogue.open';
/** The longest typed turn (C10 `NPCDialogueRequest.turn.text`). */
export const TEXT_MAX = 280;
/** How long a closing line stays up after it is fully shown, at least. */
export const CLOSE_HOLD_MIN_MS = 1500;
export const SUBTITLE_MIN_MS = 1500;
export const SUBTITLE_MS_PER_CHAR = 60;

/** The six intents the panel offers, in order. `ask_mission` needs an offered mission. */
export const INTENTS = ['greet', 'smalltalk', 'ask_mission', 'trade', 'compliment', 'farewell'] as const;
export type PanelIntent = (typeof INTENTS)[number];

export type Disclaimer = 'courtesy' | 'parody' | 'fictional' | 'none';

export interface SpeakerInfo {
  name: string;
  disclaimer: Disclaimer;
}

export interface DialogueOpenValue {
  npcId: string;
  intent?: PlayerIntent;
  /** Changes with every request, so the same NPC can be opened again. */
  id: number;
}

/** The slice of `NpcRuntime` the session calls. */
export interface DialogueRuntimePort {
  talk(
    npcId: string,
    turn: NPCDialogueRequest['turn'],
    ctx: NPCDialogueContext,
    on: (e: DialogueEvent) => void,
    signal?: AbortSignal,
  ): Promise<{ encounterId: string | null; source: 'llm' | 'ink' }>;
  endEncounter(npcId: string): void;
}

export interface SubtitleCue {
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface TimerPort {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const GLOBAL_TIMERS: TimerPort = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export interface DialogueSessionOptions {
  runtime: DialogueRuntimePort;
  /** Name and disclaimer of an NPC (the public soul in the roster). */
  speaker(npcId: string): SpeakerInfo;
  /** The client-built context of a turn: offers, relation (`met`), mode. */
  context(npcId: string): NPCDialogueContext;
  /** Called once, when the likeness card is dismissed; the talk path records `met` (the UI never writes C05). */
  markMet?(npcId: string): void;
  /** Patches `hud.subtitle`; null clears it. */
  subtitle?(cue: SubtitleCue | null): void;
  /** Clears `sys.dialogue.open` after a close. */
  onClosed?(npcId: string): void;
  /** The profile's voice setting allows speech (`ProfileSettings.npc.voice !== 'off'`). Default true. */
  voiceOn?(): boolean;
  audio?: AudioClockPort | null;
  /** The C12 client, for the report control. */
  reports?: DialogueReportClient | null;
  /** Milliseconds, monotonic. Default `performance.now()`. */
  nowMs?: () => number;
  timers?: TimerPort;
  /** Flat screens only: XR text entry is flat-only (DL-142). Default true. */
  canType?: boolean;
}

export type DialogueCard =
  | { kind: 'likeness'; disclaimer: Exclude<Disclaimer, 'none'>; name: string }
  | { kind: 'safety'; resources: boolean };

export interface DialogueChoice {
  intent: PanelIntent;
}

export interface DialogueTurnRef {
  npcId: string;
  encounterId: string;
  turnIndex: number;
}

export interface DialogueView {
  open: boolean;
  npcId: string;
  speaker: string;
  /** The AI character badge. */
  badge: boolean;
  /** The line as shown now, and the whole of it. */
  shown: string;
  full: string;
  /** Words are still being held back for the audio or the timer. */
  revealing: boolean;
  choices: DialogueChoice[];
  /** The ink fallback is playing (no error is shown for it). */
  fallback: boolean;
  /** The conversation ended; the panel closes once the last line has been read. */
  closing: boolean;
  busy: boolean;
  card: DialogueCard | null;
  /** The model turn that produced the line, for the report control; null for ink lines. */
  turn: DialogueTurnRef | null;
  canType: boolean;
  /** The report control has been used for this turn. */
  reported: boolean;
}

const EMPTY: DialogueView = {
  open: false,
  npcId: '',
  speaker: '',
  badge: true,
  shown: '',
  full: '',
  revealing: false,
  choices: [],
  fallback: false,
  closing: false,
  busy: false,
  card: null,
  turn: null,
  canType: true,
  reported: false,
};

type TurnResult = { encounterId: string | null; source: 'llm' | 'ink' };

export class DialogueSession {
  private view: DialogueView = EMPTY;
  private readonly listeners = new Set<() => void>();
  private readonly met = new Set<string>();
  private readonly timers: TimerPort;
  private readonly nowMs: () => number;
  private ctx: NPCDialogueContext | null = null;
  private reveal: LineReveal | null = null;
  private tickHandle: unknown = null;
  private closeHandle: unknown = null;
  private subtitleHandle: unknown = null;
  private abort: AbortController | null = null;
  private lastOpenId: number | null = null;
  /** A turn asked for while the likeness card is up: it runs when the card is dismissed. */
  private pending: { turn: NPCDialogueRequest['turn']; tap: ((e: DialogueEvent) => void) | undefined; resolve: ((r: TurnResult | null) => void) | null } | null = null;
  /** The finished lines of this turn and the line still arriving. */
  private committed = '';
  private streaming = '';
  private voiced = false;
  private selfHarmTurn = false;
  private runId = 0;

  constructor(private readonly o: DialogueSessionOptions) {
    this.timers = o.timers ?? GLOBAL_TIMERS;
    this.nowMs = o.nowMs ?? ((): number => (typeof performance === 'undefined' ? Date.now() : performance.now()));
  }

  state(): DialogueView {
    return this.view;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<DialogueView>): void {
    this.view = { ...this.view, ...patch };
    for (const fn of [...this.listeners]) fn();
  }

  /** Opens the panel for an NPC. `intent` starts that turn at once (after the likeness card, when one is due). A repeat of the same request is ignored. */
  open(npcId: string, opts: { intent?: PlayerIntent; id?: number } = {}): void {
    if (this.view.open && this.view.npcId === npcId && (opts.id === undefined || opts.id === this.lastOpenId)) return;
    if (this.view.open) this.close(true);
    this.lastOpenId = opts.id ?? null;
    const info = this.o.speaker(npcId);
    const ctx = this.o.context(npcId);
    this.ctx = ctx;
    this.committed = '';
    this.streaming = '';
    this.selfHarmTurn = false;
    this.reveal = null;
    const needsCard = !ctx.relation.met && !this.met.has(npcId) && info.disclaimer !== 'none';
    this.view = {
      ...EMPTY,
      open: true,
      npcId,
      speaker: info.name,
      choices: INTENTS.filter((i) => i !== 'ask_mission' || ctx.offers.missionIds.length > 0).map((intent) => ({ intent })),
      canType: this.o.canType ?? true,
      card: needsCard ? { kind: 'likeness', disclaimer: info.disclaimer as Exclude<Disclaimer, 'none'>, name: info.name } : null,
    };
    this.pending = null;
    for (const fn of [...this.listeners]) fn();
    if (opts.intent !== undefined) void this.say({ intent: opts.intent });
  }

  /** The player has read the likeness card: the conversation begins. */
  dismissCard(): void {
    const card = this.view.card;
    if (card === null || card.kind !== 'likeness') return;
    this.met.add(this.view.npcId);
    this.o.markMet?.(this.view.npcId);
    this.set({ card: null });
    const next = this.pending;
    this.pending = null;
    if (next !== null) void this.say(next.turn, next.tap).then((r) => next.resolve?.(r));
  }

  /** Runs one turn through the runtime and folds its events into the view. `tap` sees every event (the QA bridge records them). */
  async say(turn: NPCDialogueRequest['turn'], tap?: (e: DialogueEvent) => void): Promise<TurnResult | null> {
    const { npcId } = this.view;
    if (!this.view.open || this.view.busy || this.ctx === null) return null;
    // Before the first line comes the likeness card; the turn waits for it.
    if (this.view.card?.kind === 'likeness') {
      return new Promise((resolve) => {
        this.pending = { turn, tap, resolve };
      });
    }
    this.cancelClose();
    const run = ++this.runId;
    this.committed = '';
    this.streaming = '';
    this.voiced = false;
    this.reveal = new LineReveal({ npcId, nowMs: this.nowMs, audio: this.o.audio ?? null });
    this.abort = new AbortController();
    this.set({ busy: true, shown: '', full: '', revealing: false, fallback: false, turn: null, reported: false, closing: false });
    let closed = false;
    const on = (e: DialogueEvent): void => {
      if (run !== this.runId) return;
      tap?.(e);
      if (e.event === 'done' && e.data.closed) closed = true;
      this.fold(e);
    };
    let result: TurnResult | null = null;
    try {
      result = await this.o.runtime.talk(npcId, turn, this.ctx, on, this.abort.signal);
    } catch {
      // the runtime plays ink on every failure it knows; a throw that is left leaves the line as it is and no error is shown
    }
    if (run !== this.runId) return result;
    this.abort = null;
    this.set({ busy: false });
    this.refresh();
    if (closed || turn.intent === 'farewell') this.scheduleClose();
    return result;
  }

  /** A choice button. */
  choose(intent: PanelIntent): Promise<unknown> {
    this.selfHarmTurn = false;
    return this.say({ intent });
  }

  /** The typed line. Text is cut to 280 characters; a self-harm phrase brings the safety card up at once. */
  sendText(raw: string): Promise<unknown> {
    const text = raw.normalize('NFC').trim().slice(0, TEXT_MAX);
    if (text === '' || !this.view.open) return Promise.resolve(null);
    if (hasSelfHarm(text)) {
      this.selfHarmTurn = true;
      this.set({ card: { kind: 'safety', resources: false } });
    } else this.selfHarmTurn = false;
    return this.say({ text, intent: 'smalltalk' });
  }

  /** "Show full line". */
  showFull(): void {
    this.reveal?.showAll();
    this.refresh();
  }

  toggleResources(): void {
    const card = this.view.card;
    if (card?.kind === 'safety') this.set({ card: { kind: 'safety', resources: !card.resources } });
  }

  /** Files a report for the line on screen; false when there is nothing to report or no client. */
  async report(category: ReportCategory): Promise<boolean> {
    const t = this.view.turn;
    const client = this.o.reports ?? null;
    if (t === null || client === null) return false;
    try {
      await client.report(reportRequest(t.npcId, t.encounterId, t.turnIndex, category));
    } catch {
      return false;
    }
    this.set({ reported: true });
    return true;
  }

  /** Closes the panel: the turn in flight is dropped, the encounter ends, the subtitle clears. `silent` leaves `sys.dialogue.open` alone (another request is replacing this one). */
  close(silent = false): void {
    if (!this.view.open) return;
    const npcId = this.view.npcId;
    this.runId++;
    this.abort?.abort();
    this.abort = null;
    this.cancelClose();
    this.stopTick();
    this.clearSubtitle();
    try {
      this.o.runtime.endEncounter(npcId);
    } catch {
      // nothing to end
    }
    this.reveal = null;
    this.view = EMPTY;
    this.pending?.resolve?.(null);
    this.pending = null;
    for (const fn of [...this.listeners]) fn();
    if (!silent) this.o.onClosed?.(npcId);
  }

  dispose(): void {
    this.close();
    this.listeners.clear();
  }

  /** One frame of the reveal; the panel's own timer calls it, and tests do. */
  tick(): void {
    this.refresh();
  }

  private fold(e: DialogueEvent): void {
    switch (e.event) {
      case 'meta': {
        this.voiced = e.data.voice !== 'text' && (this.o.voiceOn?.() ?? true);
        const turn: DialogueTurnRef = { npcId: e.data.npcId, encounterId: e.data.encounterId, turnIndex: e.data.turnIndex };
        this.set({ turn, badge: e.data.disclosure.aiCharacter, ...(e.data.safety === 'crisis' ? { card: { kind: 'safety', resources: false } as DialogueCard } : {}) });
        break;
      }
      case 'line.delta':
        if (typeof e.data.text === 'string') this.streaming += e.data.text;
        break;
      case 'line.done':
        this.committed = this.committed === '' ? e.data.text : `${this.committed} ${e.data.text}`;
        this.streaming = '';
        this.cue(e.data.text);
        break;
      case 'effects':
        if (e.data.endConversation === true && this.selfHarmTurn && this.view.card?.kind !== 'safety') this.set({ card: { kind: 'safety', resources: false } });
        break;
      case 'fallback':
        // the partial line is dropped; the ink lines of the knot follow, spoken by nobody and shown at once
        this.committed = '';
        this.streaming = '';
        this.voiced = false;
        this.set({ fallback: true, turn: null });
        break;
      case 'done':
        break;
    }
    this.refresh();
  }

  private currentText(): string {
    return this.streaming === '' ? this.committed : this.committed === '' ? this.streaming : `${this.committed} ${this.streaming}`;
  }

  private refresh(): void {
    const reveal = this.reveal;
    if (reveal === null || !this.view.open) return;
    const full = this.currentText();
    reveal.feed(full, this.voiced);
    const frame = reveal.tick();
    const revealing = !frame.caughtUp;
    if (frame.shown !== this.view.shown || full !== this.view.full || revealing !== this.view.revealing) this.set({ shown: frame.shown, full, revealing });
    if (revealing) this.startTick();
    else this.stopTick();
  }

  private startTick(): void {
    if (this.tickHandle !== null) return;
    this.tickHandle = this.timers.setInterval(() => this.refresh(), 50);
  }

  private stopTick(): void {
    if (this.tickHandle === null) return;
    this.timers.clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  /** `hud.subtitle` for a finished line: at least `max(1.5 s, 0.06 s x characters)` on screen. */
  private cue(text: string): void {
    const sink = this.o.subtitle;
    if (sink === undefined) return;
    const start = Math.round(this.nowMs());
    const ms = Math.max(SUBTITLE_MIN_MS, SUBTITLE_MS_PER_CHAR * text.length);
    sink({ speaker: this.view.speaker, text, startMs: start, endMs: start + ms });
    if (this.subtitleHandle !== null) this.timers.clearTimeout(this.subtitleHandle);
    this.subtitleHandle = this.timers.setTimeout(() => {
      this.subtitleHandle = null;
      sink(null);
    }, ms);
  }

  private clearSubtitle(): void {
    if (this.subtitleHandle !== null) this.timers.clearTimeout(this.subtitleHandle);
    this.subtitleHandle = null;
    this.o.subtitle?.(null);
  }

  /** The conversation is over: the panel closes once the last line is fully shown and has had its reading time. A safety card is closed by the player. */
  private scheduleClose(): void {
    this.set({ closing: true });
    this.cancelClose();
    const wait = (): void => {
      this.closeHandle = null;
      if (!this.view.open) return;
      if (this.view.card?.kind === 'safety') return;
      if (this.view.revealing) {
        this.closeHandle = this.timers.setTimeout(wait, 100);
        return;
      }
      this.closeHandle = this.timers.setTimeout(() => {
        this.closeHandle = null;
        if (this.view.card?.kind !== 'safety') this.close();
      }, Math.max(CLOSE_HOLD_MIN_MS, SUBTITLE_MS_PER_CHAR * this.view.full.length));
    };
    wait();
  }

  private cancelClose(): void {
    if (this.closeHandle !== null) this.timers.clearTimeout(this.closeHandle);
    this.closeHandle = null;
  }
}

// ---- the registry the app fills and the panel reads

let current: DialogueSession | null = null;
const registryListeners = new Set<() => void>();

export function setDialogueSession(s: DialogueSession | null): void {
  current = s;
  for (const fn of [...registryListeners]) fn();
}

export function getDialogueSession(): DialogueSession | null {
  return current;
}

export function onDialogueSession(fn: () => void): () => void {
  registryListeners.add(fn);
  return () => registryListeners.delete(fn);
}

/** Esc, Backspace and the pad's B button: closes an open dialogue and says so. */
export function dialogueBack(): boolean {
  if (current === null || !current.state().open) return false;
  current.close();
  return true;
}

/** Opens the session when `sys.dialogue.open` gets a request and closes it when the key is cleared. Returns the unsubscribe. */
export function bindDialogueOpen(vm: { get(key: string): unknown; subscribe(key: string, cb: (v: unknown) => void): () => void }, session: DialogueSession): () => void {
  const apply = (v: unknown): void => {
    const req = v as Partial<DialogueOpenValue> | undefined | null;
    if (req && typeof req.npcId === 'string') session.open(req.npcId, { ...(req.intent === undefined ? {} : { intent: req.intent }), ...(typeof req.id === 'number' ? { id: req.id } : {}) });
    else if (session.state().open) session.close();
  };
  const off = vm.subscribe(DIALOGUE_OPEN_KEY, apply);
  apply(vm.get(DIALOGUE_OPEN_KEY));
  return off;
}
