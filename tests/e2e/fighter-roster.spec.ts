import { expect, test, type Page } from '@playwright/test';
import { waitForEngine } from './engine-helpers.ts';

/**
 * M08b1, @fighter-roster: the eight kits of the v1 roster are in the game. The Versus select screen lists the player and the eight
 * fighters with their likeness card and the authored pre-fight line; a manual Visionary-against-Shooter match shows the Visionary's
 * drone (a projectile entity the presenter draws) and the Shooter's gumball arc (at least one projectile drawn).
 *
 * To see it by hand, on a QA build with the gray-box world (`DV_WORLD=synth pnpm build`, or `pnpm dev`):
 *   /?fighter=demo                                   two CPUs, one pairing of the roster per run (drones against arcs, sine shots
 *                                                    against string cancels, armor against patch, poll against pulse)
 *   /?fighter=1&unlockAll=1  then  await __dvBridge.fighter.start({})   the hub: Versus, then pick any two fighters
 *   await __dvBridge.fighter.start({ kind: 'versus', fighters: ['dev_visionary', 'dev_shooter'], cpu: 3 })   a match at once
 */
type Bridge = {
  fighter: {
    start(p: object): Promise<unknown>;
    step(n?: number, i0?: number, i1?: number): Promise<State | null>;
    cmd(name: string, args?: object): Promise<State | null>;
    state(): Promise<State | null>;
    FB: Record<string, number>;
  };
  engine: { modes: { unlock(id: string): Promise<unknown> } };
  fighterStage: { state(): { projectiles: number; fighters: unknown[] } | null };
};
interface State { ok?: boolean; screen?: string; sel?: { p1: string; p2: string }; match: { phase: number; tick: number; fighters: { x: number; hp: number }[] } | null }

test.use({ viewport: { width: 960, height: 540 } });

async function boot(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(query);
  await waitForEngine(page);
  await page.waitForFunction(() => Boolean((window as unknown as { __dvBridge?: { fighter?: unknown; engine?: { modes?: unknown } } }).__dvBridge?.fighter && (window as unknown as { __dvBridge: { engine?: { modes?: unknown } } }).__dvBridge.engine?.modes), undefined, { timeout: 90_000 });
  return errors;
}

test.describe('fighter roster @fighter-roster', () => {
  test('the Versus select lists the eight fighters with their cards and a pre-fight line @fighter-roster', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = await boot(page, '/?fighter=1&unlockAll=1&world=walk-drop');
    await page.evaluate(async () => {
      const w = window as unknown as { __dvBridge: Bridge };
      await w.__dvBridge.engine.modes.unlock('unlock.fighter.roster');   // the seven roster fighters (config/unlocks.json)
      await w.__dvBridge.fighter.start({});
    });
    const hub = page.getByTestId('hub-versus'), select = page.getByTestId('fighter-select');
    await expect(hub.or(select).first()).toBeVisible({ timeout: 90_000 });
    if (!(await select.isVisible())) await hub.click();
    await expect(select).toBeVisible({ timeout: 30_000 });
    const ids = ['player', 'standin_rap_new_wave', 'dev_hyphy_elder', 'dev_lyricist', 'dev_visionary', 'dev_hacker', 'dev_shooter', 'dev_power_back', 'dev_influencer'];
    for (const id of ids) await expect(page.getByTestId(`pick-1-${id}`)).toHaveCount(1);
    await page.getByTestId('pick-0-dev_visionary').click();
    await page.getByTestId('pick-1-dev_power_back').click();
    await expect(page.getByTestId('card-0')).toHaveText('Fictional character.');
    await expect(page.getByTestId('card-1')).toHaveText('Fictional character.');
    const line = await page.getByTestId('talk-pre').textContent();
    expect((line ?? '').length).toBeGreaterThan(5);
    const st = await page.evaluate(async () => (await (window as unknown as { __dvBridge: Bridge }).__dvBridge.fighter.state()) as State);
    expect(st.sel).toMatchObject({ p1: 'dev_visionary', p2: 'dev_power_back' });
    expect(errors).toEqual([]);
  });

  test('a Visionary against Shooter match draws a projectile entity @fighter-roster', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = await boot(page, '/?fighter=1&world=walk-drop');
    const seen = await page.evaluate(async () => {
      const w = window as unknown as { __dvBridge: Bridge };
      const b = w.__dvBridge.fighter;
      await w.__dvBridge.engine.modes.unlock('unlock.fighter.roster');
      await b.start({ kind: 'versus', manual: true, fighters: ['dev_visionary', 'dev_shooter'], cpu: 1 });
      for (let i = 0; i < 400 && !(await b.state())?.ok; i++) await new Promise((r) => setTimeout(r, 25));
      let s = await b.step(300, 0, 0);
      for (let i = 0; i < 40 && s?.match?.phase !== 3; i++) s = await b.step(60, 0, 0);
      // slot 0 (Visionary, faces right) throws Dispatch Agent: 236 + light punch; slot 1 (Shooter, faces left) an Arc Shot: 236 + light punch mirrored.
      const D = b.FB['Down'] as number, R = b.FB['Right'] as number, L = b.FB['Left'] as number, LP = b.FB['LP'] as number;
      await b.step(1, D, D);
      await b.step(1, D | R, D | L);
      await b.step(1, R | LP, L | LP);
      let maxDrawn = 0;
      for (let i = 0; i < 80; i++) {
        await b.step(1, 0, 0);
        maxDrawn = Math.max(maxDrawn, w.__dvBridge.fighterStage.state()?.projectiles ?? 0);
      }
      return maxDrawn;
    });
    expect(seen).toBeGreaterThanOrEqual(1);   // the presenter draws the projectile entities (the Visionary's drone, the Shooter's gumball)
    expect(errors).toEqual([]);
  });
});
