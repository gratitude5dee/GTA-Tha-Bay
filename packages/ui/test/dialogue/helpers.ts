/**
 * Test helpers for the dialogue panel (M06a5): a tree walk over Preact vnodes (the unit tests run in Node, without a DOM), a manual timer,
 * a fake runtime that plays scripted events, and the context a turn needs.
 */
import type { DialogueEvent, NPCDialogueContext, NPCDialogueRequest } from '@dv/shared/contracts/c10-npc';
import type { VNode } from 'preact';
import { DialogueSession, type DialogueRuntimePort, type DialogueSessionOptions, type SpeakerInfo, type TimerPort } from '../../src/dialogue/session.ts';

type AnyVNode = VNode<Record<string, unknown>>;

/** Visits every vnode of a tree. Function components are called with their props and walked through, except those listed in `opaque`. */
export function walk(node: unknown, visit: (v: AnyVNode) => void, opaque: readonly unknown[] = []): void {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit, opaque);
    return;
  }
  const v = node as AnyVNode;
  if (v.type === undefined) return;
  visit(v);
  if (typeof v.type === 'function' && !opaque.includes(v.type)) {
    walk((v.type as (p: unknown) => unknown)(v.props), visit, opaque);
    return;
  }
  walk(v.props?.children, visit, opaque);
}

export function collect(node: unknown, pred: (v: AnyVNode) => boolean, opaque: readonly unknown[] = []): AnyVNode[] {
  const out: AnyVNode[] = [];
  walk(node, (v) => (pred(v) ? out.push(v) : undefined), opaque);
  return out;
}

export const byTestId = (node: unknown, id: string, opaque: readonly unknown[] = []): AnyVNode | undefined =>
  collect(node, (v) => v.props?.['data-testid'] === id, opaque)[0];

/** The text content of a vnode tree (strings and numbers, in order). */
export function textOf(node: unknown, opaque: readonly unknown[] = []): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => textOf(n, opaque)).join('');
  const v = node as AnyVNode;
  if (typeof v.type === 'function' && !opaque.includes(v.type)) return textOf((v.type as (p: unknown) => unknown)(v.props), opaque);
  return textOf(v.props?.children, opaque);
}

/** A timer port that only moves when told to. */
export class ManualTimers implements TimerPort {
  now = 0;
  private seq = 0;
  private readonly jobs = new Map<number, { at: number; every: number | null; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.jobs.set(id, { at: this.now + ms, every: null, fn });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.jobs.delete(h as number);
  }
  setInterval(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.jobs.set(id, { at: this.now + ms, every: ms, fn });
    return id;
  }
  clearInterval(h: unknown): void {
    this.jobs.delete(h as number);
  }
  pending(): number {
    return this.jobs.size;
  }
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let next: [number, { at: number; every: number | null; fn: () => void }] | null = null;
      for (const e of this.jobs) if (e[1].at <= end && (next === null || e[1].at < next[1].at)) next = e;
      if (next === null) break;
      this.now = next[1].at;
      const [id, job] = next;
      if (job.every === null) this.jobs.delete(id);
      else job.at += job.every;
      job.fn();
    }
    this.now = end;
  }
}

export function ctxOf(patch: Partial<NPCDialogueContext> = {}): NPCDialogueContext {
  return {
    schema: 1,
    clockT: 7200,
    chunkKey: '9/256/256',
    poiId: null,
    mode: 'story',
    missionId: null,
    missionStep: null,
    player: { heat: 0, inVehicle: false, health: 'ok', streetCred: 0, techClout: 0 },
    relation: { trust: 0, met: false },
    events: [],
    offers: { missionIds: [], raceIds: [], dealIds: [] },
    tycoon: null,
    voice: 'off',
    locale: 'en-US',
    ...patch,
  };
}

export const META = (over: Record<string, unknown> = {}, turnIndex = 0): DialogueEvent => ({
  event: 'meta',
  data: {
    encounterId: 'E',
    turnIndex,
    npcId: 'npc_test',
    soulVersion: 1,
    model: 'haiku',
    voice: 'text',
    turnsLeft: 5,
    disclosure: { aiCharacter: true, disclaimer: 'none' },
    gov: 0,
    ...over,
  } as never,
});

/** The events of a normal streamed turn. */
export function happyTurn(line: string, opts: { closed?: boolean; turnIndex?: number } = {}): DialogueEvent[] {
  const words = line.split(' ');
  return [
    META({}, opts.turnIndex ?? 0),
    ...words.map((w, i): DialogueEvent => ({ event: 'line.delta', data: { seq: i, text: i === 0 ? w : ` ${w}` } })),
    { event: 'line.done', data: { text: line, words: words.length } },
    { event: 'effects', data: {} },
    { event: 'done', data: { costMicros: 1, turnsLeft: 4, closed: opts.closed === true } },
  ];
}

/** The events the runtime plays for an ink knot after a fallback. */
export function inkTurn(lines: string[]): DialogueEvent[] {
  return [
    ...lines.flatMap((text, i): DialogueEvent[] => [
      { event: 'line.delta', data: { seq: i, text } },
      { event: 'line.done', data: { text, words: text.split(' ').length } },
    ]),
    { event: 'effects', data: {} },
    { event: 'done', data: { costMicros: 0, turnsLeft: 0, closed: false } },
  ];
}

export class FakeRuntime implements DialogueRuntimePort {
  calls: { npcId: string; turn: NPCDialogueRequest['turn']; ctx: NPCDialogueContext }[] = [];
  ended: string[] = [];
  constructor(public script: (turn: NPCDialogueRequest['turn'], call: number) => DialogueEvent[] = () => happyTurn('Good day.')) {}
  async talk(npcId: string, turn: NPCDialogueRequest['turn'], ctx: NPCDialogueContext, on: (e: DialogueEvent) => void) {
    this.calls.push({ npcId, turn, ctx });
    for (const e of this.script(turn, this.calls.length)) on(e);
    return { encounterId: 'E', source: 'llm' as const };
  }
  endEncounter(npcId: string): void {
    this.ended.push(npcId);
  }
}

export const SPEAKERS: Record<string, SpeakerInfo> = {
  npc_test: { name: 'Tester Nine', disclaimer: 'none' },
  parody_pal: { name: 'Parody Pal', disclaimer: 'parody' },
  fiction_pal: { name: 'Fiction Pal', disclaimer: 'fictional' },
  courtesy_pal: { name: 'Courtesy Pal', disclaimer: 'courtesy' },
};

export function makeSession(over: Partial<DialogueSessionOptions> = {}, runtime = new FakeRuntime()): { session: DialogueSession; runtime: FakeRuntime; timers: ManualTimers; ms: { now: number } } {
  const timers = new ManualTimers();
  const ms = { now: 1000 };
  const session = new DialogueSession({
    runtime,
    speaker: (id) => SPEAKERS[id] ?? { name: id, disclaimer: 'none' },
    context: () => ctxOf(),
    timers,
    nowMs: () => ms.now,
    ...over,
  });
  return { session, runtime, timers, ms };
}
