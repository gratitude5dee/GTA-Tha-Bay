/**
 * Shared helpers of the fighter specs: the frame-data pack, a match with scripted inputs, and a fake `ModeContext` that records what
 * the mode publishes (view-model patches, events, camera directives, telemetry) so a session can run in Node.
 */
import { Rng } from '@dv/shared';
import type { CameraDirective, InputFrame, JsonValue, ModeContext, ModeOrigin, SimEvent } from '@dv/shared';
import { FB, toInputFrame } from '@dv/shared/fight';
import type { FightRules, FighterLoadout } from '@dv/shared/fight';
import { fighterPack } from '../src/sim/data.ts';
import { FighterMatch } from '../src/sim/match.ts';

export const pack = fighterPack();

export const RULES: FightRules = {
  roundsToWin: 2, timerFrames: 5940, simpleDmgPct: 80, leniencyX100: 100, cpuLevel: [null, null], training: false, shutdowns: false, cinematics: 'off',
};

export const PLAYER: FighterLoadout = { slot: 'PLAYER_FIGHTER', fighterId: 'player', scheme: 'classic', costume: 0 };
export const WAVE: FighterLoadout = { slot: 'RAP_NEW_WAVE', fighterId: 'standin_rap_new_wave', scheme: 'classic', costume: 0 };

export function newMatch(over: Partial<FightRules> = {}, lineup: [FighterLoadout, FighterLoadout] = [PLAYER, WAVE], seed = 7): FighterMatch {
  return new FighterMatch({ pack, rules: { ...RULES, ...over }, seed, lineup, stage: 'powell_turntable' });
}

export { FB };

export interface FakeCtx extends ModeContext {
  patches: { k: string; v: JsonValue | null }[];
  events: ModeContext['events'] & { log: SimEvent[] };
  directives: CameraDirective[];
  telemetryLog: { name: string; props: Record<string, string | number | boolean> }[];
  saved: string[];
  setTick(t: number): void;
  /** The frames `ctx.input.frame(player)` returns. */
  frames: [InputFrame, InputFrame];
  pushed: string[];
  vm(key: string): JsonValue | null | undefined;
}

export function fakeCtx(origin: ModeOrigin = { kind: 'menu' }, unlocks: string[] = ['unlock.fighter']): FakeCtx {
  let tick = 0;
  const neutral = toInputFrame(0, 0, 0);
  const frames: [InputFrame, InputFrame] = [neutral, neutral];
  const log: SimEvent[] = [];
  const patches: { k: string; v: JsonValue | null }[] = [];
  const directives: CameraDirective[] = [];
  const telemetryLog: { name: string; props: Record<string, string | number | boolean> }[] = [];
  const saved: string[] = [];
  const pushed: string[] = [];
  const latest = new Map<string, JsonValue | null>();
  const rngs = new Map<string, Rng>();
  const ctx = {
    get tick() { return tick; },
    dt: 1 / 60,
    origin,
    ecs: { store() { throw new Error('no components in this fake'); }, resolve: () => null, byKey: () => 0 },
    prefabs: { spawn() { throw new Error('no prefabs in this fake'); }, despawn() {} },
    rng: (name: string): Rng => { let r = rngs.get(name); if (!r) { r = new Rng(name.length * 977 + 5); rngs.set(name, r); } return r; },
    camera: { direct: (d: CameraDirective) => void directives.push(d), release: () => undefined },
    input: {
      frame: (p = 0) => frames[p === 1 ? 1 : 0],
      push: (c: string) => void pushed.push(`+${c}`),
      pop: (c: string) => void pushed.push(`-${c}`),
    },
    unlocks: { list: () => unlocks, has: (id: string) => unlocks.includes(id), emit: () => true },
    events: { emit: (e: SimEvent) => void log.push(e), on: () => () => undefined, log },
    ui: {
      patch: (k: string, v: JsonValue | null) => { patches.push({ k, v }); latest.set(k, v); },
      toast() {},
      openApp() {},
      closeOverlay() {},
    },
    assets: { request() {}, ready: () => true },
    save: { request: (r: string) => void saved.push(r) },
    telemetry: { emit: (name: string, props: Record<string, string | number | boolean>) => void telemetryLog.push({ name, props }) },
    net: null,
    startChild: () => false,
    patches, directives, telemetryLog, saved, frames, pushed,
    setTick: (t: number) => { tick = t; },
    vm: (k: string) => latest.get(k),
  };
  return ctx as unknown as FakeCtx;
}

/** A frame whose FighterInput word maps back to `word`. */
export const frameOf = (word: number, tick = 0): InputFrame => toInputFrame(word, tick, 0);
