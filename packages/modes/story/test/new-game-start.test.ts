/**
 * Fix S (BD-FIX-SPAWN-01): a new game's first auto mission moves the player to its start through the world's teleport, and starts only
 * once the teleport has put the player on the ground there. The owner's report was a player dropped at the resolver's fallback height
 * over ground that was not resident yet, falling through the void while the mission ran at the Yard above it.
 */
import type { StorySlice, TeleportKind, TeleportResult, TeleportTarget } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { at, circle, defineMission, npc, stage, waitFor } from '../src/authoring/index.ts';
import type { CatalogPayload } from '../src/missions/store.ts';
import { StoryController } from '../src/mode.ts';
import { flatResolver, ll, makeHarness, type Harness } from './harness.ts';

const START = { x: 2000, z: 3000 };
const mission = defineMission({
  id: 'm.t.first',
  version: 1,
  district: 'd3',
  cast: { pal: npc({ soul: 'npc_test', role: 'ally', spawn: at(...ll(START.x + 10, START.z)) }) },
  zones: { z: circle(...ll(START.x, START.z), 5) },
  stages: [stage('a', [waitFor(6000, { id: 'long' })])],
});

interface Asked {
  kind: TeleportKind;
  to: TeleportTarget;
  answer(r: TeleportResult): void;
  tick: number;
}

interface Setup {
  h: Harness;
  c: StoryController;
  asked: Asked[];
  /** The tick of every toast, by its text key, in the order shown. */
  shown: { tick: number; text: string }[];
  run(ticks: number): Promise<void>;
}

function setup(answer?: (n: number) => TeleportResult | null, opts: { bake?: string } = {}): Setup {
  const h = makeHarness();
  if (opts.bake !== undefined) (h.ctx.world as unknown as { resolver: unknown }).resolver = flatResolver(opts.bake);
  const asked: Asked[] = [];
  const shown: { tick: number; text: string }[] = [];
  (h.ctx.world as unknown as { teleport: unknown }).teleport = {
    request: (kind: TeleportKind, to: TeleportTarget) =>
      new Promise<TeleportResult>((resolve) => {
        const a: Asked = { kind, to, answer: resolve, tick: h.tickNo.n };
        asked.push(a);
        const now = answer?.(asked.length);
        if (now) resolve(now);
      }),
    candidates: () => [],
  };
  const [lat, lng] = ll(START.x, START.z);
  const payload: CatalogPayload = { missions: [mission], directors: [], cutscenes: [], lines: {}, names: {}, autoStart: { lat, lng, yawDeg: 90 }, triggers: true };
  const c = new StoryController({ qa: false, bootConfig: () => ({ story: payload }) });
  c.attach(h.ctx, h.story as unknown as StorySlice);
  const run = async (ticks: number): Promise<void> => {
    for (let i = 0; i < ticks; i++) {
      const before = h.calls.toasts.length;
      c.advance(h.ctx);
      for (const t of h.calls.toasts.slice(before)) shown.push({ tick: h.tickNo.n, text: t.text });
      h.tickNo.n++;
      await Promise.resolve();
    }
  };
  return { h, c, asked, shown, run };
}

const notLoaded = (): TeleportResult => ({ ok: false, reason: 'not-loaded', messageKey: 'world.teleport.notLoaded' });
const fails = (h: Harness): unknown[] => h.calls.telemetry.filter((t) => t.name === 'mission.fail').map((t) => t.props['reason']);
/** About 3 minutes of sim time (60 Hz), the retry budget of the move to the start. */
const BUDGET_TICKS = 10800;

const ok = (): TeleportResult => ({ ok: true, x: START.x, y: 4, z: START.z, yaw: 0 });

describe('new game start (BD-FIX-SPAWN-01)', () => {
  it('asks the teleport for a respawn at the start and starts the mission only once it answers ok', async () => {
    const { h, c, asked, run } = setup();
    await run(16);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.kind).toBe('respawn');
    const to = asked[0]!.to as { x: number; z: number; yaw: number };
    expect(to.x).toBeCloseTo(START.x, 3);
    expect(to.z).toBeCloseTo(START.z, 3);
    expect(to.yaw).toBeCloseTo(Math.PI / 2, 6);
    // the teleport is still streaming the destination: no mission, no other trigger, no second request
    await run(300);
    expect(c.rt).toBeNull();
    expect(asked).toHaveLength(1);
    // the player stands there now: the mission starts on the next trigger pass
    h.put(h.player, START.x, START.z, 4);
    asked[0]!.answer(ok());
    await run(16);
    expect(c.rt?.active).toBe(true);
    expect(c.rt?.missionId).toBe('m.t.first');
  });

  it('a slow load: several not-loaded answers, then ok, starts the mission with a loading hint and no failure', async () => {
    const { h, c, asked, shown, run } = setup((n) => (n <= 6 ? notLoaded() : ok()));
    await run(4000);
    expect(asked).toHaveLength(7);
    expect(c.rt?.active).toBe(true);
    expect(c.rt?.missionId).toBe('m.t.first');
    expect(h.calls.toasts.map((t) => t.text)).not.toContain('mission.startUnreachable');
    expect(fails(h)).toEqual([]);
    // the retries are spaced out: each gap at least as long as the one before, the first at least 1 s
    const gaps = asked.slice(1).map((a, i) => a.tick - asked[i]!.tick);
    expect(gaps[0]).toBeGreaterThanOrEqual(60);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThanOrEqual(gaps[i - 1]!);
    const hints = shown.filter((t) => t.text === 'mission.startLoading');
    expect(hints.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps asking while the destination is not loaded for about 3 minutes, hinting at most every 20 s, then gives up', async () => {
    const { h, c, asked, shown, run } = setup(notLoaded);
    await run(BUDGET_TICKS - 600);
    expect(c.rt).toBeNull();
    expect(h.calls.toasts.map((t) => t.text)).not.toContain('mission.startUnreachable');
    expect(fails(h)).toEqual([]);
    const midway = asked.length;
    expect(midway).toBeGreaterThan(5);
    await run(1800);
    expect(c.rt).toBeNull();
    const texts = shown.map((t) => t.text);
    expect(texts.filter((t) => t === 'mission.startUnreachable')).toHaveLength(1);
    expect(texts[texts.length - 1]).toBe('mission.startUnreachable');
    expect(fails(h)).toEqual(['unresolved']);
    // the hint: never more often than once every 20 s (1,200 ticks)
    const hints = shown.filter((t) => t.text === 'mission.startLoading').map((t) => t.tick);
    expect(hints.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < hints.length; i++) expect(hints[i]! - hints[i - 1]!).toBeGreaterThanOrEqual(1200);
    // tried once per session: no further requests, no second failure
    const final = asked.length;
    await run(1200);
    expect(asked).toHaveLength(final);
    expect(fails(h)).toEqual(['unresolved']);
  });

  it('a request with no answer counts as a timeout and is asked again, not given up', async () => {
    const { h, c, asked, run } = setup((n) => (n === 1 ? null : ok()));
    await run(1800 + 200);
    expect(asked).toHaveLength(2);
    expect(c.rt?.active).toBe(true);
    expect(fails(h)).toEqual([]);
  });

  it('a gray-box world (no baked world) fails at once, without asking the teleport', async () => {
    const { h, c, asked, run } = setup(notLoaded, { bake: 'graybox' });
    await run(16);
    expect(asked).toHaveLength(0);
    expect(c.rt).toBeNull();
    expect(h.calls.toasts.map((t) => t.text)).toEqual(['mission.startUnreachable']);
    expect(fails(h)).toEqual(['unresolved']);
    await run(600);
    expect(asked).toHaveLength(0);
    expect(fails(h)).toEqual(['unresolved']);
  });

  it('a start in the water or out of bounds is not retried and the mission does not start', async () => {
    const { h, c, asked, run } = setup(() => ({ ok: false, reason: 'water', messageKey: 'world.teleport.water' }));
    await run(600);
    expect(asked).toHaveLength(1);
    expect(c.rt).toBeNull();
    expect(h.calls.toasts.map((t) => t.text)).toEqual(['mission.startUnreachable']);
  });

  it('a busy teleport (the boot spawn still settling) is asked again and then succeeds', async () => {
    const { c, asked, run } = setup((n) => (n === 1 ? { ok: false, reason: 'blocked', messageKey: 'world.teleport.busy' } : ok()));
    await run(200);
    expect(asked).toHaveLength(2);
    expect(c.rt?.active).toBe(true);
  });

  it('a player already at the start begins at once, without a teleport', async () => {
    const { h, c, asked, run } = setup();
    h.put(h.player, START.x + 50, START.z, 0);
    await run(16);
    expect(asked).toHaveLength(0);
    expect(c.rt?.active).toBe(true);
  });
});
