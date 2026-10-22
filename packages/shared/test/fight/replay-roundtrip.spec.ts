import { describe, expect, it } from 'vitest';
import { decodeInputs, decodeReplay, encodeInputs, encodeReplay, recordReplay, verifyReplay } from '../../src/fight/replay.ts';
import type { DvFightReplay } from '../../src/fight/replay.ts';
import { buildPack } from '../../src/fight/pack.ts';
import { LINEUP, PACK, PLAYER, RULES, TUNING, randomBot } from './helpers.ts';

const rules = { ...RULES, roundsToWin: 1 as const, timerFrames: 400 };
function record(): DvFightReplay {
  const a = randomBot(31, 4000, 1), b = randomBot(32, 4000, -1);
  return recordReplay(PACK, rules, 9, LINEUP, 'powell_turntable', 'test', (t) => [a[t] as number, b[t] as number], 4000);
}

describe('input RLE', () => {
  it('round-trips arbitrary streams, long runs and every base64 padding length', () => {
    const cases: number[][] = [[], [0], [5, 5], [1, 2, 3], [65535, 0, 65535, 0], new Array(70000).fill(9), [1, 1, 1, 2, 2, 3]];
    for (const c of cases) expect(Array.from(decodeInputs(encodeInputs(c)))).toEqual(c);
    const rnd = randomBot(1, 5000, 1);
    expect(Array.from(decodeInputs(encodeInputs(rnd)))).toEqual(rnd);
  });
  it('a run of identical frames is small', () => {
    expect(encodeInputs(new Array(3000).fill(0)).length).toBeLessThan(16);
  });
});

describe('.dvfight v1', () => {
  const rep = record();
  it('records a finished match with a checkpoint every 60 ticks and verifies it', () => {
    const ticks = decodeInputs(rep.inputs[0]).length;
    expect(rep.checkpoints.every).toBe(60);
    expect(rep.checkpoints.hashes).toHaveLength(Math.floor(ticks / 60));
    expect(rep.v).toBe(1);
    expect(rep.fightDataVersion).toBe(1);
    expect(rep.frameDataHash).toBe(PACK.hash);
    expect(rep.final.winner).toBeGreaterThanOrEqual(0);
    const v = verifyReplay(PACK, rep);
    expect(v.ok).toBe(true);
    if (v.ok) expect([v.winner, v.rounds]).toEqual([rep.final.winner, rep.final.rounds]);
  });
  it('encode -> decode -> encode is byte-identical', () => {
    const text = encodeReplay(rep);
    expect(encodeReplay(decodeReplay(text))).toBe(text);
    expect(decodeReplay(text)).toEqual(rep);
  });
  it('an altered frameDataHash or data version refuses with REPLAY_MISMATCH', () => {
    const bad = { ...rep, frameDataHash: '0'.repeat(64) };
    const r = verifyReplay(PACK, bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('REPLAY_MISMATCH');
    const v2 = verifyReplay(PACK, { ...rep, fightDataVersion: 2 as unknown as 1 });
    expect(v2.ok === false && v2.code).toBe('REPLAY_MISMATCH');
  });
  it('a kit whose 5L startup is 5 instead of 4 refuses, and forced verification names the first bad checkpoint', () => {
    const kit = structuredClone(PLAYER);
    const m = kit.moves.find((x) => x.id === '5L');
    if (!m) throw new Error('5L');
    m.startup = 5; (m.hits[0] as { from: number }).from = 5;
    const mutated = buildPack({ PLAYER_FIGHTER: kit }, TUNING);
    const refused = verifyReplay(mutated, rep);
    expect(refused.ok === false && refused.code).toBe('REPLAY_MISMATCH');
    const forced = verifyReplay(mutated, rep, true);
    expect(forced.ok).toBe(false);
    if (!forced.ok) {
      expect(['CHECKPOINT_MISMATCH', 'FINAL_MISMATCH']).toContain(forced.code);
      if (forced.code === 'CHECKPOINT_MISMATCH') expect(forced.checkpoint).toBeGreaterThanOrEqual(0);
    }
  });
  it('a tampered checkpoint is named', () => {
    const hashes = rep.checkpoints.hashes.map((h) => [...h] as [number, number]);
    (hashes[2] as [number, number])[0] ^= 1;
    const r = verifyReplay(PACK, { ...rep, checkpoints: { every: 60, hashes } });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('CHECKPOINT_MISMATCH'); expect(r.checkpoint).toBe(2); expect(r.tick).toBe(180); }
  });
  it('a tampered final result is caught', () => {
    const r = verifyReplay(PACK, { ...rep, final: { winner: 1 - rep.final.winner, rounds: rep.final.rounds } });
    expect(r.ok === false && r.code).toBe('FINAL_MISMATCH');
  });
});
