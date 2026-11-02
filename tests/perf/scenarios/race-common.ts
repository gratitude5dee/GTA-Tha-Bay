import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import type { PerfReport, QualityTierId } from '../../../packages/shared/src/index.ts';

/**
 * What the racing perf scenarios `race-sprint` and `race-pursuit-heat4` share (M11a1). Both run a QA stand-in of the real event on the
 * street at x = 3100 of the streamed city (`PERF_AT` in packages/modes/racing/src/races.ts), because CI has the synth city and the real
 * races are compiled for the baked streets of `sf` (BD-M11a1-05). The page puts the player at the grid first, so the colliders are
 * streamed in before the race loads, starts the race, presses ready so that GO falls about when the window opens, and samples the
 * race and the pursuit while the runner measures. `collect` puts the figures into `report.counts` for `verifyRace` (tools/ci/perf-check.ts).
 *
 * The setup runs with the world's draw held (BD-REPAIR-M11a1-02, the hold of `streamAtPlan`, DL-758): from the reveal until the field has
 * left the grid (and, for the pursuit, the police are there) `RendererHost.holdWorld('cover')` skips the world and backdrop passes while
 * the loop, the sim's ticks, the stream's upload gate and the bridge replies run every frame. The hold is released before the night-rain
 * look is set and before the runner's warm-up and window, so the window is drawn and counted exactly as before. Without it a `desktop`
 * frame of Chromium on software GL (5 to 11 s, task 95) paced every sim tick and every bridge reply of the setup, and the Chromium
 * `desktop` and `desktop-ultra` cells ran out of their 600 s before the race started.
 */
export interface TierCaps {
  rivals: number;
  policeCars: number;
}

/** `tierCaps` of `config/racing.json`, the rows 6.2 of 06-racing.md. */
export function tierCaps(tier: QualityTierId): TierCaps {
  const cfg = JSON.parse(readFileSync('config/racing.json', 'utf8')) as { tierCaps: Record<string, TierCaps> };
  const row = cfg.tierCaps[tier];
  if (!row) throw new Error(`config/racing.json has no tierCaps row for ${tier}`);
  return row;
}

type RaceState = { ok: boolean; state?: { phase: string; car: unknown | null; rivals: { driverId: string }[] } };
/** What the page's engine observation says about the sim worker (`__dvBridge.engine.observe()`, a QA build). */
type SimObservation = {
  tick: number;
  restarts: number;
  stats: { tickMsP99: number; ticksLastFrame: number };
  pursuit: { level: number; units: number } | null;
  player: { pos: [number, number, number] } | null;
};
/**
 * The sim side of the sampler (BD-FIX-PARKED-FALL-01, fourth round): whether sim.worker was restarted while the window ran (the
 * engine's stall watchdog or a worker error; a restarted worker has no race and no pursuit), what the bridge calls answered, and where
 * the player was. Diagnostics only: the counts the racing check judges are the sampler's `rivals`, `police` and `heat` as before.
 */
type SimDiag = {
  t0: number;
  restarts0: number;
  restarts: number;
  /** One line per restart seen: when (s after the sampler started) and the tick before and after. */
  restartAt: string[];
  tick0: number;
  tick: number;
  tickMsP99Max: number;
  ticksLastFrameMax: number;
  /** racing.state answers: a race, no race, no answer (null); when (s) the first answer without a race came. */
  race: { ok: number; none: number; nul: number; goneAt: string };
  /** pursuit.state answers: level 1 or more, level 0, no answer (null); when (s) the first level-0 answer came; the last answer. */
  pursuit: { on: number; off: number; nul: number; offAt: string; last: string };
  /** Highest pursuit level in the snapshot's side block (no worker call). */
  sideHeatMax: number;
  player: string;
};
type W = {
  __dvBridge: {
    racing: { start(id: string, o: object): Promise<{ ok?: boolean } | null>; state(): Promise<RaceState | null>; cmd(n: string): Promise<unknown> };
    engine: { observe(): SimObservation; pursuit: { state(): Promise<{ level: number; units: number; phase: string } | null> } };
    world: {
      boot(): { revealed: boolean };
      internals(): { view: unknown };
      teleport(to: { x: number; z: number; yaw?: number }): Promise<{ ok: boolean; reason?: string } | null>;
    };
  };
  __dvRace?: { rivals: number; police: number; heat: number; phases: string[]; timer: number; sim: SimDiag };
  /** The release of the setup's world hold (BD-REPAIR-M11a1-02). */
  __dvRaceHold?: () => void;
};

/**
 * The page's console lines about sim.worker restarts (`boot-engine.ts`: `sim worker <reason>: <detail>` from the stall watchdog or a
 * worker error, `sim worker restart failed`, `profile switch failed`), with the seconds since the race page started, per page.
 */
const simConsole = new WeakMap<Page, string[]>();
const SIM_CONSOLE = /^(sim worker |profile switch failed)/;

/** Holds the world's draw for the setup (BD-REPAIR-M11a1-02): `RendererHost.holdWorld('cover')` through the world view's host. */
async function holdWorld(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as W;
    const host = (w.__dvBridge.world.internals().view as { host: { holdWorld(kind: 'cover'): () => void } | null }).host;
    if (!host) throw new Error('race scenario: the world view has no renderer host to hold');
    w.__dvRaceHold?.();
    w.__dvRaceHold = host.holdWorld('cover');
  });
}

/** Releases the setup's world hold; the next frame draws the world again. */
async function releaseWorld(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__dvRaceHold?.();
    delete w.__dvRaceHold;
  });
}

/** The grid of the QA races (races.ts `PERF_AT`) and a point 30 m behind it, where the player is put. */
export const GRID = { x: 3100, z: 440 } as const;

/**
 * Starts `raceId` on the street: waits for the world, moves the player to the grid, loads the race with `rivals` rivals, waits for
 * the car and the field, presses ready and starts the sampler. `waitPolice` also waits for police units (the pursuit).
 */
export async function startRacePage(page: Page, raceId: string, o: { rivals: number; waitPolice: boolean }): Promise<void> {
  const t0 = Date.now();
  const step = (what: string): void => console.log(`race page ${raceId}: ${what} at ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const lines: string[] = [];
  simConsole.set(page, lines);
  page.on('console', (m) => {
    const text = m.text();
    if (SIM_CONSOLE.test(text)) lines.push(`${text} (at ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  });
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.racing !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world?.boot().revealed === true, undefined, { timeout: 240_000 });
  step('world revealed');
  await holdWorld(page);
  try {
    await setUpHeld(page, raceId, o, step);
  } finally {
    await releaseWorld(page);
  }
  step('world drawn again');
  await page.evaluate(() => {
    const w = window as unknown as W;
    const o0 = w.__dvBridge.engine.observe();
    const sim: SimDiag = {
      t0: Date.now(), restarts0: o0.restarts, restarts: o0.restarts, restartAt: [], tick0: o0.tick, tick: o0.tick, tickMsP99Max: 0, ticksLastFrameMax: 0,
      race: { ok: 0, none: 0, nul: 0, goneAt: 'never' }, pursuit: { on: 0, off: 0, nul: 0, offAt: 'never', last: 'none' }, sideHeatMax: 0, player: 'none',
    };
    w.__dvRace = { rivals: 0, police: 0, heat: 0, phases: [], timer: 0, sim };
    // what the engine observation says about sim.worker, once per sample (no worker call): a restart, the ticks, the player
    const observeSim = (d: SimDiag): void => {
      const o = w.__dvBridge.engine.observe();
      if (o.restarts !== d.restarts) {
        d.restartAt.push(`${d.restarts} -> ${o.restarts} at ${((Date.now() - d.t0) / 1000).toFixed(1)} s (tick ${d.tick} -> ${o.tick})`);
        d.restarts = o.restarts;
      }
      d.tick = o.tick;
      d.tickMsP99Max = Math.max(d.tickMsP99Max, o.stats.tickMsP99);
      d.ticksLastFrameMax = Math.max(d.ticksLastFrameMax, o.stats.ticksLastFrame);
      d.sideHeatMax = Math.max(d.sideHeatMax, o.pursuit?.level ?? 0);
      const at = o.player?.pos;
      if (at) d.player = `(${at[0].toFixed(0)}, ${at[1].toFixed(0)}, ${at[2].toFixed(0)})`;
    };
    w.__dvRace.timer = window.setInterval(async () => {
      const r = w.__dvRace;
      if (!r) return;
      observeSim(r.sim);
      const s = await w.__dvBridge.racing.state();
      if (s?.ok && s.state) {
        r.rivals = Math.max(r.rivals, s.state.rivals.length);
        if (r.phases[r.phases.length - 1] !== s.state.phase) r.phases.push(s.state.phase);
      }
      const since = (): string => `${((Date.now() - r.sim.t0) / 1000).toFixed(1)} s`;
      r.sim.race[s === null ? 'nul' : s.ok && s.state ? 'ok' : 'none']++;
      if (s !== null && !(s.ok && s.state) && r.sim.race.goneAt === 'never') r.sim.race.goneAt = since();
      const p = await w.__dvBridge.engine.pursuit.state();
      if (p) {
        r.police = Math.max(r.police, p.units);
        r.heat = Math.max(r.heat, p.level);
        r.sim.pursuit[p.level >= 1 ? 'on' : 'off']++;
        if (p.level < 1 && r.sim.pursuit.offAt === 'never') r.sim.pursuit.offAt = since();
        r.sim.pursuit.last = `level ${p.level} units ${p.units} ${p.phase}`;
      } else r.sim.pursuit.nul++;
      observeSim(r.sim);
    }, 250);
  });
}

/** The setup proper, run while the world's draw is held: the player to the grid, the race, the field, ready, and the police. */
async function setUpHeld(page: Page, raceId: string, o: { rivals: number; waitPolice: boolean }, step: (what: string) => void): Promise<void> {
  // The colliders under the grid stream in around the player, so the player goes first (the race loads at the grid whatever the tier's physics radius is).
  // `teleport` is a call into the sim worker too and answers null when it is late (a loaded software-GL page at desktop-ultra or desktop): ask again.
  let moved: { ok: boolean; reason?: string } | null = null;
  for (let attempt = 0; attempt < 12 && !moved?.ok; attempt++) {
    if (attempt > 0) await page.waitForTimeout(5000);
    moved = await page.evaluate(
      (g) =>
        Promise.race([
          (window as unknown as W).__dvBridge.world.teleport({ x: g.x, z: g.z + 30, yaw: 0 }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 45_000)),
        ]),
      GRID,
    );
  }
  if (!moved?.ok) throw new Error(`race scenario: the teleport to the grid failed: ${JSON.stringify(moved)}`);
  step('at the grid');
  await page.waitForTimeout(1500);
  // `racing.start` is a call into the sim worker that answers null when it is late (a software-GL page at desktop-ultra is slow): ask
  // again until it answers ok, or until a race is there already.
  let started: { ok?: boolean } | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    started = await page.evaluate(
      ([id, rivals]) =>
        // a call into a worker that is far behind may never answer: give up after 45 s and ask again (the state check below sees a race that started late)
        Promise.race([
          (window as unknown as W).__dvBridge.racing.start(id as string, { vehicle: 'vehicle.aurelian-sorrel', rivals }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 45_000)),
        ]),
      [raceId, o.rivals] as const,
    );
    step(`racing.start attempt ${attempt} answered ${JSON.stringify(started)}`);
    if (started?.ok) break;
    const there = await page.evaluate(() =>
      Promise.race([(window as unknown as W).__dvBridge.racing.state(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 45_000))]),
    );
    if (there?.ok) {
      started = { ok: true };
      break;
    }
    await page.waitForTimeout(5000);
  }
  if (!started?.ok) throw new Error(`race scenario: racing.start(${raceId}) was refused: ${JSON.stringify(started)}`);
  step('race started');
  // The car stands on the grid and the field is there. Each wait below polls from the test side: `page.waitForFunction` does not await an
  // async predicate (its injected poller takes the returned promise as truthy at once), so before BD-REPAIR-M11a1-02 these three waits
  // passed on their first poll and `ready` went out once.
  await pollPage(
    page,
    () =>
      page.evaluate(async (want) => {
        const s = await (window as unknown as W).__dvBridge.racing.state();
        return s?.ok === true && s.state?.car != null && s.state.rivals.length === want;
      }, o.rivals),
    { timeoutMs: 240_000, everyMs: 500, what: `the car and ${o.rivals} rivals on the grid` },
  );
  step('the field is on the grid');
  // `ready` is a message to the sim worker and is lost when the worker restarts under load; it is idempotent, so it is sent again on every
  // poll until the director has left the grid (Countdown or later). The wait is on that event; 240 s is only its ceiling.
  await pollPage(
    page,
    () =>
      page.evaluate(async () => {
        const b = (window as unknown as W).__dvBridge.racing;
        const ph = (await b.state())?.state?.phase;
        if (ph !== undefined && ph !== 'Loading' && ph !== 'Grid') return true;
        await b.cmd('ready');
        return false;
      }),
    { timeoutMs: 240_000, everyMs: 2000, what: 'the director to leave the grid' },
  );
  step('the director left the grid');
  if (o.waitPolice) {
    // GO (after the 3 s countdown) starts the pursuit at heat 4; the units spawn out of view and close in. The setup ends once one is there.
    await pollPage(page, () => page.evaluate(async () => ((await (window as unknown as W).__dvBridge.engine.pursuit.state())?.units ?? 0) >= 1), {
      timeoutMs: 240_000,
      everyMs: 500,
      what: 'a police unit',
    });
    const now = await page.evaluate(async () => {
      const b = (window as unknown as W).__dvBridge;
      const p = await b.engine.pursuit.state();
      const o = b.engine.observe();
      return {
        race: (await b.racing.state())?.state?.phase ?? null, heat: p?.level ?? null, units: p?.units ?? null, phase: p?.phase ?? null,
        tick: o.tick, simRestarts: o.restarts,
      };
    });
    step(`police there: ${JSON.stringify(now)}`);
  }
}

/** Runs `check` (a `page.evaluate` that awaits its page function) every `everyMs` until it is true; throws after `timeoutMs`. */
async function pollPage(page: Page, check: () => Promise<boolean>, o: { timeoutMs: number; everyMs: number; what: string }): Promise<void> {
  const until = Date.now() + o.timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > until) throw new Error(`race scenario: no ${o.what} within ${o.timeoutMs / 1000} s`);
    await page.waitForTimeout(o.everyMs);
  }
}

/** Stops the sampler and puts the race figures into the report. */
export async function collectRace(page: Page, report: PerfReport): Promise<void> {
  const r = await page.evaluate(() => {
    const w = window as unknown as W;
    if (w.__dvRace) window.clearInterval(w.__dvRace.timer);
    return w.__dvRace ?? null;
  });
  if (!r) throw new Error('race scenario: the sampler never ran');
  console.log(`race page sampler: rivals ${r.rivals}, police ${r.police}, heat ${r.heat}, phases ${r.phases.join(' > ')}`);
  const sim = simLine(r.sim, simConsole.get(page) ?? []);
  console.log(`race page sim: ${sim}`);
  // beside the report (uploaded with it as perf-reports-*): race.perf.spec.ts quotes it when the racing check fails
  const file = `test-results/perf.${report.scenario.id}.${test.info().project.name}.${report.tier}.race.json`;
  mkdirSync('test-results', { recursive: true });
  writeFileSync(file, `${JSON.stringify({ sim, diag: r.sim, console: simConsole.get(page) ?? [] }, null, 2)}\n`);
  report.counts.raceRivals = r.rivals;
  report.counts.racePoliceMax = r.police;
  report.counts.raceHeatMax = r.heat;
}

/** One line on sim.worker over the sampler's window: restarts (with the page's console lines on them), ticks, answers, the player. */
export function simLine(d: SimDiag, lines: readonly string[]): string {
  const restarts = d.restarts === d.restarts0 ? `restarts ${d.restarts} (none in the window)` : `restarts ${d.restarts0} -> ${d.restarts} [${d.restartAt.join('; ')}]`;
  return [
    restarts,
    `ticks ${d.tick0} -> ${d.tick} (tickMs p99 max ${d.tickMsP99Max.toFixed(1)}, ticks a frame max ${d.ticksLastFrameMax})`,
    `racing.state race ${d.race.ok}, no race ${d.race.none} (first at ${d.race.goneAt}), no answer ${d.race.nul}`,
    `pursuit.state level>=1 ${d.pursuit.on}, level 0 ${d.pursuit.off} (first at ${d.pursuit.offAt}), no answer ${d.pursuit.nul}, last ${d.pursuit.last}`,
    `snapshot heat max ${d.sideHeatMax}`,
    `player at ${d.player}`,
    `console: ${lines.length > 0 ? lines.join(' | ') : 'none'}`,
  ].join('; ');
}
