import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { PerfReport, QualityTierId } from '../../../packages/shared/src/index.ts';

/**
 * What the racing perf scenarios `race-sprint` and `race-pursuit-heat4` share (M11a1). Both run a QA stand-in of the real event on the
 * street at x = 3100 of the streamed city (`PERF_AT` in packages/modes/racing/src/races.ts), because CI has the synth city and the real
 * races are compiled for the baked streets of `sf` (BD-M11a1-05). The page puts the player at the grid first, so the colliders are
 * streamed in before the race loads, starts the race, presses ready so that GO falls about when the window opens, and samples the
 * race and the pursuit while the runner measures. `collect` puts the figures into `report.counts` for `verifyRace` (tools/ci/perf-check.ts).
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
type W = {
  __dvBridge: {
    racing: { start(id: string, o: object): Promise<{ ok?: boolean } | null>; state(): Promise<RaceState | null>; cmd(n: string): Promise<unknown> };
    engine: { pursuit: { state(): Promise<{ level: number; units: number; phase: string } | null> } };
    world: {
      boot(): { revealed: boolean };
      teleport(to: { x: number; z: number; yaw?: number }): Promise<{ ok: boolean; reason?: string } | null>;
    };
  };
  __dvRace?: { rivals: number; police: number; heat: number; phases: string[]; timer: number };
};

/** The grid of the QA races (races.ts `PERF_AT`) and a point 30 m behind it, where the player is put. */
export const GRID = { x: 3100, z: 440 } as const;

/**
 * Starts `raceId` on the street: waits for the world, moves the player to the grid, loads the race with `rivals` rivals, waits for
 * the car and the field, presses ready and starts the sampler. `waitPolice` also waits for police units (the pursuit).
 */
export async function startRacePage(page: Page, raceId: string, o: { rivals: number; waitPolice: boolean }): Promise<void> {
  await page.waitForFunction(() => (window as unknown as Partial<W>).__dvBridge?.racing !== undefined, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.world?.boot().revealed === true, undefined, { timeout: 240_000 });
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
  // the car stands on the grid and the field is there
  await page.waitForFunction(
    async (want) => {
      const s = await (window as unknown as W).__dvBridge.racing.state();
      return s?.ok === true && s.state?.car != null && s.state.rivals.length === want;
    },
    o.rivals,
    { timeout: 240_000, polling: 500 },
  );
  await page.evaluate(() => (window as unknown as W).__dvBridge.racing.cmd('ready'));
  if (o.waitPolice) {
    // GO starts the pursuit; the units spawn out of view and close in. The window opens once some are there (or after 60 s).
    await page
      .waitForFunction(async () => ((await (window as unknown as W).__dvBridge.engine.pursuit.state())?.units ?? 0) >= 1, undefined, { timeout: 60_000, polling: 500 })
      .catch(() => undefined);
  }
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__dvRace = { rivals: 0, police: 0, heat: 0, phases: [], timer: 0 };
    w.__dvRace.timer = window.setInterval(async () => {
      const r = w.__dvRace;
      if (!r) return;
      const s = await w.__dvBridge.racing.state();
      if (s?.ok && s.state) {
        r.rivals = Math.max(r.rivals, s.state.rivals.length);
        if (r.phases[r.phases.length - 1] !== s.state.phase) r.phases.push(s.state.phase);
      }
      const p = await w.__dvBridge.engine.pursuit.state();
      if (p) {
        r.police = Math.max(r.police, p.units);
        r.heat = Math.max(r.heat, p.level);
      }
    }, 250);
  });
}

/** Stops the sampler and puts the race figures into the report. */
export async function collectRace(page: Page, report: PerfReport): Promise<void> {
  const r = await page.evaluate(() => {
    const w = window as unknown as W;
    if (w.__dvRace) window.clearInterval(w.__dvRace.timer);
    return w.__dvRace ?? null;
  });
  if (!r) throw new Error('race scenario: the sampler never ran');
  report.counts.raceRivals = r.rivals;
  report.counts.racePoliceMax = r.police;
  report.counts.raceHeatMax = r.heat;
}
