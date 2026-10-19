/**
 * Volatile user message of a dialogue turn (spec/domains/04-npc-contracts.md section B7): a fixed template rendered from
 * validated context, memory notes and the player's turn. Everything that reaches the model is an enum, a number, a
 * sanitised id or player text that has been NFC-normalised and stripped of control and tag characters.
 */
import type { MemoryHit, NPCDialogueContext, NPCDialogueRequest } from '../contracts/c10-npc.ts';
import { WEEKDAYS, formatClock, minuteOfDay, weekdayOf } from './schedule.ts';

export const PLAYER_TEXT_MAX = 280;
export const MEMORY_SUMMARY_MAX_CHARS = 600;
export const MEMORY_HITS_MAX = 6;

// C0 and C1 controls, Unicode tag characters (U+E0000..E007F), zero-width and bidi format characters, and angle brackets.
const STRIP_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿<>]|[\u{e0000}-\u{e007f}]/gu;

/** Player text as it enters the prompt: NFC, stripped, whitespace collapsed, at most 280 code points. */
export function sanitizePlayerText(raw: string): string {
  const nfc = raw.normalize('NFC').replace(STRIP_RE, ' ').replace(/\s+/g, ' ').trim();
  const points = Array.from(nfc);
  return points.length > PLAYER_TEXT_MAX ? points.slice(0, PLAYER_TEXT_MAX).join('').trimEnd() : nfc;
}

/** Ids and enum-like values inside attributes: letters, digits and a few separators only. */
const attr = (v: string | null | undefined): string => {
  const s = (v ?? '').replace(/[^A-Za-z0-9_.:/-]/g, '_');
  return s === '' ? 'none' : s.slice(0, 64);
};
const num = (n: number): string => String(Math.round(Number.isFinite(n) ? n : 0));
const list = (xs: readonly string[]): string => xs.map((x) => attr(x)).join(',');

/** Free text inside an attribute or element: no quotes or angle brackets, no line breaks, no control characters. */
const noteText = (s: string, max: number): string => {
  const clean = s.normalize('NFC').replace(STRIP_RE, ' ').replace(/&/g, ' and ').replace(/"/g, "'").replace(/\s+/g, ' ').trim();
  const points = Array.from(clean);
  return points.length > max ? points.slice(0, max).join('').trimEnd() : clean;
};

function tycoonAttr(t: NPCDialogueContext['tycoon']): string {
  if (!t) return 'none';
  const deals = t.deals.map((d) => `${attr(d.id)}:${num(d.amountCents)}:${num(d.preMoneyCents)}:${num(d.poolBp)}:${d.boardSeat ? 1 : 0}:${d.liq}`).join(',');
  return `round=${attr(t.roundId)};stance=${t.stance};week=${num(t.week)};mood=${num(t.mood)};sector=${attr(t.sector)};bands=${t.arrBand},${t.growthBand},${t.runwayBand};weak=${attr(t.weakestMetric)};deals=${deals}`;
}

export function renderScene(
  ctx: NPCDialogueContext,
  mem: { summary: string; hits: readonly MemoryHit[] },
  turn: NPCDialogueRequest['turn'],
): string {
  const t = Math.max(0, Math.floor(ctx.clockT));
  const scene = [
    `<scene t="${t}" hour="${formatClock(minuteOfDay(t))}" weekday="${WEEKDAYS[weekdayOf(t)] ?? 'mon'}" chunk="${attr(ctx.chunkKey)}" poi="${attr(ctx.poiId)}" mode="${ctx.mode}" mission="${attr(ctx.missionId)}" step="${attr(ctx.missionStep)}"`,
    ` heat="${ctx.player.heat}" vehicle="${ctx.player.inVehicle ? 'true' : 'false'}" health="${ctx.player.health}" trust="${num(ctx.relation.trust)}" met="${ctx.relation.met ? 'true' : 'false'}" events="${ctx.events.length ? list(ctx.events.slice(0, 5)) : 'none'}"`,
    ` offers="mission:${list(ctx.offers.missionIds)};race:${list(ctx.offers.raceIds)};deal:${list(ctx.offers.dealIds)}" tycoon="${tycoonAttr(ctx.tycoon)}"/>`,
  ].join('\n');
  const hits = mem.hits.slice(0, MEMORY_HITS_MAX).map((h) => `<m k="${h.kind}">${noteText(h.text, 240)}</m>`).join('');
  const memory = `<memory summary="${noteText(mem.summary, MEMORY_SUMMARY_MAX_CHARS)}">${hits}</memory>`;
  const player = `<player intent="${turn.intent ? attr(turn.intent) : 'none'}">${sanitizePlayerText(turn.text ?? '')}</player>`;
  return `${scene}\n${memory}\n${player}\n`;
}
