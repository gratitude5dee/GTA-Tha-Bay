import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FB, FF, FIGHTER_BASE, FM, FightCore, Phase, St, buildPack, decodeInputs, decodeReplay, encodeInputs, encodeReplay, verifyReplay,
} from '@dv/shared/fight';
import type { FighterDef, FightEvent } from '@dv/shared/fight';
import { loadPack } from '../src/pack-files.ts';
import { lintReplay } from '../src/lint/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..');
const golden = (n: string): string => path.join(here, '..', 'golden', n);
const pack = loadPack(root);
const text1 = readFileSync(golden('vs-001.dvfight'), 'utf8');
const text2 = readFileSync(golden('vs-002.dvfight'), 'utf8');
const tmp = mkdtempSync(path.join(tmpdir(), 'dv-replay-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('golden replays', () => {
  it('both pass the replay schema and re-simulate to every checkpoint', () => {
    for (const t of [text1, text2]) {
      expect(lintReplay(JSON.parse(t) as unknown)).toEqual([]);
      const rep = decodeReplay(t);
      expect(rep.frameDataHash).toBe(pack.hash);
      const v = verifyReplay(pack, rep);
      expect(v.ok).toBe(true);
      if (v.ok) expect([v.winner, v.rounds]).toEqual([rep.final.winner, rep.final.rounds]);
      expect(rep.checkpoints.hashes).toHaveLength(Math.floor(decodeInputs(rep.inputs[0]).length / 60));
    }
  });

  /** Replay the stream and tally what happened. */
  interface Tally { hit: number; exHit: number; block: number; check: number; super: number; ko: number; tech: number; throw: number; clear: number; rattled: number; maxCombo: number; timeUp: number; counter: number }
  function tally(text: string): Tally {
    const rep = decodeReplay(text);
    const sim = new FightCore();
    const buf = sim.init(pack, rep.rules, rep.seed, rep.lineup);
    const a = decodeInputs(rep.inputs[0]), b = decodeInputs(rep.inputs[1]);
    const t: Tally = { hit: 0, exHit: 0, block: 0, check: 0, super: 0, ko: 0, tech: 0, throw: 0, clear: 0, rattled: 0, maxCombo: 0, timeUp: 0, counter: 0 };
    const sink = {
      push(e: FightEvent): void {
        if (e.kind === 'hit') { t.hit++; if ((e.b & 2) !== 0) t.exHit++; if (e.b === 3) t.throw++; if ((e.b & 1) !== 0) t.counter++; }
        else if (e.kind === 'cue' && e.a === 1) t.tech++;
        else if (e.kind === 'block') t.block++;
        else if (e.kind === 'check') t.check++;
        else if (e.kind === 'super') t.super++;
        else if (e.kind === 'ko') t.ko++;
      },
    };
    for (let i = 0; i < a.length; i++) {
      sim.step(buf, a[i] as number, b[i] as number, sink);
      for (const s of [0, 1]) {
        const o = FIGHTER_BASE[s] as number;
        if ((buf[o + FF.State] as number) === St.Clear) t.clear = 1;
        if ((buf[o + FF.Rattled] as number) !== 0) t.rattled = 1;
        t.maxCombo = Math.max(t.maxCombo, buf[o + FF.ComboHits] as number);
      }
      if ((buf[FM.Phase] as number) === Phase.TimeUp) t.timeUp = 1;
    }
    return t;
  }

  it('vs-001 covers normals, chains, specials, EX, a super and the KO', () => {
    const t = tally(text1);
    expect(t.maxCombo).toBeGreaterThanOrEqual(3);
    expect(t.hit).toBeGreaterThan(10);
    expect(t.exHit).toBeGreaterThanOrEqual(1);
    expect(t.super).toBeGreaterThanOrEqual(1);
    expect(t.ko).toBe(1);
    expect(decodeReplay(text1).final).toEqual({ winner: 0, rounds: [1, 0] });
  });
  it('vs-002 covers projectiles, a throw, a throw tech, Check, Clear, Rattled and the time-out', () => {
    const t = tally(text2);
    expect(t.block).toBeGreaterThanOrEqual(2);   // the projectile and the chip on the Rattled guard
    expect(t.throw).toBeGreaterThanOrEqual(1);
    expect(t.tech).toBeGreaterThanOrEqual(1);
    expect(t.check).toBeGreaterThanOrEqual(1);
    expect(t.clear).toBe(1);
    expect(t.rattled).toBe(1);
    expect(t.timeUp).toBe(1);
    expect(t.ko).toBe(0);
  });
  it('the files are stored in canonical form (encode of decode is byte-identical)', () => {
    expect(encodeReplay(decodeReplay(text1)) + '\n').toBe(text1);
    expect(encodeReplay(decodeReplay(text2)) + '\n').toBe(text2);
  });
});

describe('self-mutants (AC-9)', () => {
  it('an altered frameDataHash refuses with REPLAY_MISMATCH', () => {
    const rep = decodeReplay(text1);
    const r = verifyReplay(pack, { ...rep, frameDataHash: `${'0'.repeat(63)}1` });
    expect(r.ok === false && r.code).toBe('REPLAY_MISMATCH');
  });
  it('5L startup 4 -> 5 refuses, and --force names a checkpoint or the final mismatch', () => {
    const kit = structuredClone(pack.kits.PLAYER_FIGHTER) as FighterDef;
    const m = kit.moves.find((x) => x.id === '5L');
    if (!m) throw new Error('5L');
    m.startup = 5; (m.hits[0] as { from: number }).from = 5;
    const mutated = buildPack({ PLAYER_FIGHTER: kit }, pack.tuning);
    for (const t of [text1, text2]) {
      const rep = decodeReplay(t);
      expect(verifyReplay(mutated, rep).ok).toBe(false);
      const forced = verifyReplay(mutated, rep, true);
      expect(forced.ok).toBe(false);
      if (!forced.ok) expect(['CHECKPOINT_MISMATCH', 'FINAL_MISMATCH']).toContain(forced.code);
    }
    const forced1 = verifyReplay(mutated, decodeReplay(text1), true);
    expect(!forced1.ok && forced1.code === 'CHECKPOINT_MISMATCH' && forced1.checkpoint !== undefined).toBe(true);
  });
  it('dropping the first attack makes verification fail at a named checkpoint', () => {
    const rep = decodeReplay(text1);
    const a = decodeInputs(rep.inputs[0]);
    const i = a.findIndex((v, k) => k > 400 && (v & FB.LP) !== 0);
    expect(i).toBeGreaterThan(0);
    a.fill(0, i, i + 12);   // the first attack is dropped
    const tampered = { ...rep, inputs: [encodeInputs(a), rep.inputs[1]] as [string, string] };
    const r = verifyReplay(pack, tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['CHECKPOINT_MISMATCH', 'FINAL_MISMATCH']).toContain(r.code);
  });
});

describe('fighter:replay CLI', () => {
  it('exits 0 on both goldens and 1 with a named checkpoint on a mutated kit', () => {
    const run = (extra: string[]): ReturnType<typeof spawnSync> =>
      spawnSync('pnpm', ['--filter', '@dv/mode-fighter', 'fighter:replay', '--', ...extra], { cwd: root, encoding: 'utf8' });
    const ok = run([golden('vs-001.dvfight'), golden('vs-002.dvfight')]);
    expect(ok.status).toBe(0);
    expect(String(ok.stdout)).toContain('every checkpoint matches');
    const kit = structuredClone(pack.kits.PLAYER_FIGHTER) as FighterDef;
    const m = kit.moves.find((x) => x.id === '5L') as (typeof kit.moves)[number];
    m.startup = 5; (m.hits[0] as { from: number }).from = 5;
    const kitFile = path.join(tmp, 'player-mutant.json');
    writeFileSync(kitFile, JSON.stringify(kit));
    const refused = run([golden('vs-001.dvfight'), '--kit', kitFile]);
    expect(refused.status).toBe(1);
    expect(String(refused.stderr)).toContain('REPLAY_MISMATCH');
    const forced = run([golden('vs-001.dvfight'), '--kit', kitFile, '--force']);
    expect(forced.status).toBe(1);
    expect(String(forced.stderr)).toMatch(/\[CHECKPOINT_MISMATCH\] checkpoint \d+ tick \d+/);
  }, 120_000);
});
