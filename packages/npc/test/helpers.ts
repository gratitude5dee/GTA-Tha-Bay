import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DialogueEvent, NPCDialogueContext } from '@dv/shared/contracts/c10-npc';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The compiled ink of the shipped test NPC (`pnpm npc:build` output kept in assets/src/data). */
export const npcTestInk = (): string => readFileSync(path.join(repoRoot, 'assets/src/data/ink.npc_test/ink.json'), 'utf8');

export const context = (over: Partial<NPCDialogueContext> = {}): NPCDialogueContext => ({
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
  ...over,
});

export const LINE = 'Good day, Zoë. Please confirm the lot is clear. 😀 Done.';

/** The events of one good turn as the Worker writes them. */
export function goodTurn(line = LINE): DialogueEvent[] {
  const events: DialogueEvent[] = [
    {
      event: 'meta',
      data: { encounterId: '0198aaaa-bbbb-7ccc-8ddd-eeeeffff0000', turnIndex: 0, npcId: 'npc_test', soulVersion: 1, model: 'haiku', voice: 'text', turnsLeft: 5, disclosure: { aiCharacter: true, disclaimer: 'none' }, gov: 0 },
    },
  ];
  const points = Array.from(line);
  for (let i = 0; i < points.length; i += 7) events.push({ event: 'line.delta', data: { seq: i / 7, text: points.slice(i, i + 7).join('') } });
  events.push({ event: 'line.done', data: { text: line, words: line.split(' ').length } });
  events.push({ event: 'effects', data: { mood: 'neutral' } });
  events.push({ event: 'done', data: { costMicros: 348, turnsLeft: 5, closed: false } });
  return events;
}

export const sseText = (events: readonly DialogueEvent[], eol = '\n'): string => events.map((e) => `event: ${e.event}${eol}data: ${JSON.stringify(e.data)}${eol}${eol}`).join('');

/** A streaming Response over the given byte chunks; a chunk that is an Error makes the stream fail there. */
export function streamResponse(chunks: readonly (Uint8Array | Error)[], init: ResponseInit = {}): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const c = chunks[i++];
      if (c === undefined) controller.close();
      else if (c instanceof Error) controller.error(c);
      else controller.enqueue(c);
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' }, ...init });
}

export const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Splits bytes into chunks at the given offsets. */
export function splitAt(data: Uint8Array, offsets: readonly number[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  let from = 0;
  for (const o of [...offsets, data.length]) {
    if (o > from) out.push(data.slice(from, o));
    from = Math.max(from, o);
  }
  return out;
}

export const errorResponse = (code: string, status: number, details?: Record<string, unknown>): Response =>
  new Response(JSON.stringify({ error: { code, message: 'x', requestId: 'r', ...(details === undefined ? {} : { details }) } }), { status, headers: { 'Content-Type': 'application/json' } });

export const auth = (): Promise<{ Authorization: string }> => Promise.resolve({ Authorization: 'PlayToken test' });
