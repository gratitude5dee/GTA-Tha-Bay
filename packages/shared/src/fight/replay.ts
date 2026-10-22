// packages/shared/src/fight/replay.ts — `.dvfight` v1 (FC2 "Replay"): encode, decode, record, verify every 60-tick checkpoint.
import { canonicalize } from '../json.ts';
import type { FightRules, FighterLoadout } from './buffer.ts';
import { FM, NULL_SINK, Phase } from './buffer.ts';
import { FightCore } from './step.ts';
import { hashBuffer } from './hash.ts';
import type { FrameDataPack } from './types.ts';
import { FIGHT_DATA_VERSION } from './types.ts';

export interface DvFightReplay {
  v: 1; build: string; frameDataHash: string; fightDataVersion: 1; seed: number; rules: FightRules;
  lineup: [FighterLoadout, FighterLoadout]; stage: string;
  inputs: [string, string];                                   // base64 RLE of u16 per tick
  checkpoints: { every: 60; hashes: [number, number][] };    // [lo, hi] after tick every*(k+1)
  final: { winner: number; rounds: [number, number] };
}

export type VerifyResult =
  | { ok: true; ticks: number; winner: number; rounds: [number, number] }
  | { ok: false; code: 'REPLAY_MISMATCH' | 'CHECKPOINT_MISMATCH' | 'FINAL_MISMATCH'; detail: string; checkpoint?: number; tick?: number };

// ---- base64 + RLE (pure; no Buffer/btoa) -----------------------------------------------------------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number, b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63] as string + (B64[(n >> 12) & 63] as string);
    out += b === undefined ? '=' : (B64[(n >> 6) & 63] as string);
    out += c === undefined ? '=' : (B64[n & 63] as string);
  }
  return out;
}
function fromBase64(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const q = [0, 1, 2, 3].map((k) => { const ch = s[i + k] as string; return ch === '=' ? -1 : B64.indexOf(ch); });
    const n = ((q[0] as number) << 18) | ((q[1] as number) << 12) | (Math.max(q[2] as number, 0) << 6) | Math.max(q[3] as number, 0);
    out.push((n >> 16) & 255);
    if ((q[2] as number) >= 0) out.push((n >> 8) & 255);
    if ((q[3] as number) >= 0) out.push(n & 255);
  }
  return out;
}

/** u16 per tick -> base64 of runs (value u16 LE, count u16 LE). */
export function encodeInputs(inputs: ArrayLike<number>): string {
  const bytes: number[] = [];
  let i = 0;
  while (i < inputs.length) {
    const v = (inputs[i] as number) & 0xffff;
    let n = 1;
    while (i + n < inputs.length && ((inputs[i + n] as number) & 0xffff) === v && n < 0xffff) n++;
    bytes.push(v & 255, v >> 8, n & 255, n >> 8);
    i += n;
  }
  return toBase64(bytes);
}
export function decodeInputs(s: string): Uint16Array {
  const bytes = fromBase64(s);
  let total = 0;
  for (let i = 0; i + 3 < bytes.length; i += 4) total += (bytes[i + 2] as number) | ((bytes[i + 3] as number) << 8);
  const out = new Uint16Array(total);
  let p = 0;
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    const v = (bytes[i] as number) | ((bytes[i + 1] as number) << 8);
    const n = (bytes[i + 2] as number) | ((bytes[i + 3] as number) << 8);
    out.fill(v, p, p + n);
    p += n;
  }
  return out;
}

/** Canonical JSON: stable key order, so encode(decode(text)) is byte-identical. */
export function encodeReplay(r: DvFightReplay): string { return canonicalize(r); }
export function decodeReplay(text: string): DvFightReplay {
  const r = JSON.parse(text) as DvFightReplay;
  if (r.v !== 1) throw new Error(`dvfight: unsupported version ${String(r.v)}`);
  return r;
}

/**
 * Simulate with `source(tick)` supplying both inputs until the match ends (MatchEnd) or `maxTicks`, then build the replay.
 * The recorded `final` is the state after the last simulated tick.
 */
export function recordReplay(pack: FrameDataPack, rules: FightRules, seed: number, lineup: [FighterLoadout, FighterLoadout],
  stage: string, build: string, source: (tick: number) => readonly [number, number], maxTicks: number): DvFightReplay {
  const sim = new FightCore();
  const buf = sim.init(pack, rules, seed, lineup);
  const in0: number[] = [], in1: number[] = [];
  const hashes: [number, number][] = [];
  for (let t = 0; t < maxTicks; t++) {
    const [a, b] = source(t);
    in0.push(a & 0xffff); in1.push(b & 0xffff);
    sim.step(buf, a, b, NULL_SINK);
    if ((t + 1) % 60 === 0) hashes.push(hashBuffer(buf));
    if ((buf[FM.Phase] as number) === Phase.MatchEnd) break;
  }
  return {
    v: 1, build, frameDataHash: pack.hash, fightDataVersion: FIGHT_DATA_VERSION, seed, rules, lineup, stage,
    inputs: [encodeInputs(in0), encodeInputs(in1)],
    checkpoints: { every: 60, hashes },
    final: { winner: buf[FM.Winner] as number, rounds: [buf[FM.RoundsWon0] as number, buf[FM.RoundsWon1] as number] },
  };
}

/**
 * Re-simulate and compare every checkpoint and the final result. A different `frameDataHash` or data version refuses
 * with REPLAY_MISMATCH unless `force` is set (the mutation self-test and the demo use it to name the first bad checkpoint).
 */
export function verifyReplay(pack: FrameDataPack, r: DvFightReplay, force = false): VerifyResult {
  if (r.fightDataVersion !== FIGHT_DATA_VERSION) return { ok: false, code: 'REPLAY_MISMATCH', detail: `fightDataVersion ${String(r.fightDataVersion)} != ${FIGHT_DATA_VERSION}` };
  if (!force && r.frameDataHash !== pack.hash) return { ok: false, code: 'REPLAY_MISMATCH', detail: `frameDataHash ${r.frameDataHash.slice(0, 12)} != ${pack.hash.slice(0, 12)}` };
  const in0 = decodeInputs(r.inputs[0]), in1 = decodeInputs(r.inputs[1]);
  const n = Math.min(in0.length, in1.length);
  const sim = new FightCore();
  const buf = sim.init(pack, r.rules, r.seed, r.lineup);
  for (let t = 0; t < n; t++) {
    sim.step(buf, in0[t] as number, in1[t] as number, NULL_SINK);
    if ((t + 1) % r.checkpoints.every === 0) {
      const k = (t + 1) / r.checkpoints.every - 1;
      const want = r.checkpoints.hashes[k];
      const got = hashBuffer(buf);
      if (want === undefined || want[0] !== got[0] || want[1] !== got[1]) {
        return { ok: false, code: 'CHECKPOINT_MISMATCH', checkpoint: k, tick: t + 1, detail: `checkpoint ${k} (tick ${t + 1}) differs` };
      }
    }
  }
  const winner = buf[FM.Winner] as number;
  const rounds: [number, number] = [buf[FM.RoundsWon0] as number, buf[FM.RoundsWon1] as number];
  if (winner !== r.final.winner || rounds[0] !== r.final.rounds[0] || rounds[1] !== r.final.rounds[1]) {
    return { ok: false, code: 'FINAL_MISMATCH', tick: n, detail: `final winner ${winner} rounds ${rounds.join('-')} != ${r.final.winner} ${r.final.rounds.join('-')}` };
  }
  return { ok: true, ticks: n, winner, rounds };
}
