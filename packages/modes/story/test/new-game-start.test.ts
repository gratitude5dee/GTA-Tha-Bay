/**
 * Fix S (BD-FIX-SPAWN-01): a new game's first auto mission moves the player to its start through the world's teleport, and starts only
 * once the teleport has put the player on the ground there. The owner's report was a player dropped at the resolver's fallback height
 * over ground that was not resident yet, falling through the void while the mission ran at the Yard above it.
 */
import type { StorySlice, TeleportKind, TeleportResult, TeleportTarget } from '@dv/shared';
import { describe, expect, it } from 'vitest';
import { at, circle, defineMission, npc, stage, waitFor } from '../src/authoring/index.ts';
import type { CatalogPayload } from '../src/missions/store.ts';
import { PLACE_ANSWER_TICKS, PLACE_BUDGET_TICKS, PLACE_RETRY_FIRST_TICKS, PLACE_RETRY_MAX_TICKS, placeRetryGap, StoryController } from '../src/mode.ts';
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
  shown: { tick: number; text: string; id: string }[];
  /** Sends the Jobs app's `mission.start` for `id` (a press on its row). */
  jobsStart(id: string): void;
  run(ticks: number): Promise<void>;
}

function setup(answer?: (n: number) => TeleportResult | null, opts: { bake?: string } = {}): Setup {
  const h = makeHarness();
  if (opts.bake !== undefined) (h.ctx.world as unknown as { resolver: unknown }).resolver = flatResolver(opts.bake);
  const asked: Asked[] = [];
  const shown: { tick: number; text: string; id: string }[] = [];
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
      for (const t of h.calls.toasts.slice(before)) shown.push({ tick: h.tickNo.n, text: t.text, id: t.id });
      h.tickNo.n++;
      await Promise.resolve();
    }
  };
  const jobsStart = (id: string): void => {
    const before = h.calls.toasts.length;
    c.onEvent(h.ctx, { t: 'mode.cmd', tick: h.tickNo.n, s: JSON.stringify({ mode: 'story', name: 'mission.start', args: { id } }) });
    for (const t of h.calls.toasts.slice(before)) shown.push({ tick: h.tickNo.n, text: t.text, id: t.id });
  };
  return { h, c, asked, shown, jobsStart, run };
}

const notLoaded = (): TeleportResult => ({ ok: false, reason: 'not-loaded', messageKey: 'world.teleport.notLoaded' });
const fails = (h: Harness): unknown[] => h.calls.telemetry.filter((t) => t.name === 'mission.fail').map((t) => t.props['reason']);
/** About 3 minutes of sim time (60 Hz), the retry budget of the move to the start. */
const BUDGET_TICKS = 10800;
/** The trigger pass runs every 15 ticks: an answer is looked at, and a retry sent, on the first pass at or after it is due. */
const PASS = 15;
const LOADING = 'mission.startLoading';
const UNREACHABLE = 'mission.startUnreachable';
type JobRowLike = { id: string; state: string; retry?: boolean };
const jobRow = (h: Harness, id: string): JobRowLike | undefined => ((h.vm.get('mode.story.jobs') ?? []) as unknown as JobRowLike[]).find((r) => r.id === id);

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
    // the retries: the gap after each answer doubles from 60 up to 600 ticks and stays there (each ask waits one trigger pass for
    // the answer, then the gap, both on 15-tick passes)
    const gaps = asked.slice(1).map((a, i) => a.tick - asked[i]!.tick - PASS);
    const want = gaps.map((_, i) => Math.min(PLACE_RETRY_FIRST_TICKS * 2 ** i, PLACE_RETRY_MAX_TICKS));
    expect(gaps).toEqual(want);
    expect(want.slice(0, 6)).toEqual([60, 120, 240, 480, 600, 600]);
    expect(gaps.filter((g) => g === PLACE_RETRY_MAX_TICKS).length).toBeGreaterThan(10);
    // no request goes out once the budget is spent: the last one leaves inside it, and the wait ends within budget + one answer time
    const first = asked[0]!.tick;
    for (const a of asked) expect(a.tick - first).toBeLessThan(PLACE_BUDGET_TICKS);
    const failedAt = shown.find((t) => t.text === UNREACHABLE)!.tick;
    expect(failedAt - first).toBeGreaterThanOrEqual(PLACE_BUDGET_TICKS);
    expect(failedAt - first).toBeLessThanOrEqual(PLACE_BUDGET_TICKS + PLACE_ANSWER_TICKS);
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

  it('the retry gap doubles from 60 to 600 ticks', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(placeRetryGap)).toEqual([60, 120, 240, 480, 600, 600, 600]);
  });

  it('takes the loading hint off the screen when the mission starts', async () => {
    const { c, shown, run } = setup((n) => (n <= 4 ? notLoaded() : ok()));
    await run(2000);
    expect(c.rt?.active).toBe(true);
    const loading = shown.filter((t) => t.id === 'mission:m.t.first:loading').map((t) => t.text);
    expect(loading.length).toBeGreaterThanOrEqual(2);
    expect(loading.slice(0, -1).every((t) => t === LOADING)).toBe(true);
    expect(loading[loading.length - 1]).toBe('');   // the dismiss: the hint's id with an empty text
  });

  it('takes the loading hint off the screen when the start turns out unreachable', async () => {
    const { shown, run } = setup((n) => (n <= 3 ? notLoaded() : { ok: false, reason: 'water', messageKey: 'world.teleport.water' }));
    await run(1500);
    const texts = shown.map((t) => `${t.id}=${t.text}`);
    const dismiss = texts.indexOf('mission:m.t.first:loading=');
    const warn = texts.indexOf(`mission:m.t.first:start=${UNREACHABLE}`);
    expect(texts).toContain(`mission:m.t.first:loading=${LOADING}`);
    expect(dismiss).toBeGreaterThanOrEqual(0);
    expect(warn).toBeGreaterThan(dismiss);
  });

  it('an unreachable start stays available with a Start action in Jobs, which runs the move again with a fresh budget (DL-734)', async () => {
    let refuse = true;
    const { h, c, asked, shown, jobsStart, run } = setup(() => (refuse ? { ok: false, reason: 'blocked', messageKey: 'world.teleport.blocked' } : null));
    await run(60);
    expect(asked).toHaveLength(1);
    expect(c.rt).toBeNull();
    expect(fails(h)).toEqual(['unresolved']);
    expect(jobRow(h, 'm.t.first')).toMatchObject({ state: 'available', retry: true });
    expect(h.story.missions['m.t.first']?.state ?? 'available').toBe('available');
    // the auto trigger does not try again on its own
    await run(600);
    expect(asked).toHaveLength(1);

    // Start in Jobs: a new request at once, then the same waiting rules from a fresh budget
    refuse = false;
    const pressed = h.tickNo.n;
    jobsStart('m.t.first');
    expect(asked).toHaveLength(2);
    expect(asked[1]!.kind).toBe('respawn');
    expect(asked[1]!.tick).toBe(pressed);
    // a second press while it moves: busy, no third request
    jobsStart('m.t.first');
    expect(asked).toHaveLength(2);
    expect(shown[shown.length - 1]?.text).toBe('jobs.busy');
    // the teleport arrives: the mission starts and the row loses its Start action
    await run(30);
    expect(c.rt).toBeNull();
    h.put(h.player, START.x, START.z, 4);
    asked[1]!.answer(ok());
    await run(31);
    expect(c.rt?.active).toBe(true);
    expect(c.rt?.missionId).toBe('m.t.first');
    expect(jobRow(h, 'm.t.first')?.retry).toBeUndefined();
    expect(fails(h)).toEqual(['unresolved']);
  });

  it('a Jobs Start after the budget ran out gets a whole new budget', async () => {
    const { h, c, asked, jobsStart, run } = setup(notLoaded);
    await run(BUDGET_TICKS + 1900);
    expect(c.rt).toBeNull();
    expect(jobRow(h, 'm.t.first')?.retry).toBe(true);
    const before = asked.length;
    const pressed = h.tickNo.n;
    jobsStart('m.t.first');
    expect(asked).toHaveLength(before + 1);
    // still asking well past one budget after the first request, because the budget counts from the press
    await run(BUDGET_TICKS - 900);
    expect(c.rt).toBeNull();
    expect(asked[asked.length - 1]!.tick - pressed).toBeGreaterThan(BUDGET_TICKS - 1600);
    expect(fails(h)).toEqual(['unresolved']);
    await run(2700);
    expect(fails(h)).toEqual(['unresolved', 'unresolved']);
  });

  it('a Jobs Start on a gray-box world refuses again with the toast and keeps the Start action', async () => {
    const { h, asked, shown, jobsStart, run } = setup(notLoaded, { bake: 'graybox' });
    await run(16);
    expect(jobRow(h, 'm.t.first')?.retry).toBe(true);
    jobsStart('m.t.first');
    expect(asked).toHaveLength(0);
    expect(shown.filter((t) => t.text === UNREACHABLE)).toHaveLength(2);
    expect(jobRow(h, 'm.t.first')?.retry).toBe(true);
  });
});
