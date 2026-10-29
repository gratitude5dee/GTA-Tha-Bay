import { expect, test } from '@playwright/test';
import { waitForEngine } from './engine-helpers.ts';

/**
 * M08a2 AC-4, @fighter-training: Training mode on Chromium. A manual match (the QA bridge steps the sim by hand, so every frame is
 * exact) shows that the frame meter reads 5L as startup 4, active 2, recovery 8, with +4 on hit and +1 on block; that the box overlay
 * draws while it is on and nothing when it is off; and that a recorded dummy replays its recording identically.
 *
 * To see it by hand: open `/?fighter=training` on a QA build (the default scene is the Powell turntable arena with the Training
 * overlay), walk up to the dummy with the arrow keys, tap the light button, and read the meter at the top of the screen.
 */
type Bridge = {
  fighter: {
    start(p: object): Promise<unknown>;
    step(n?: number, i0?: number, i1?: number): Promise<State | null>;
    cmd(name: string, args?: object): Promise<State | null>;
    state(): Promise<State | null>;
    FB: Record<string, number>;
  };
  fighterStage: { state(): { overlaySegments: number; fighters: { move: number; frame: number }[] } | null };
};
interface Fighter { x: number; state: number; move: number; moveFrame: number }
interface Meter { move: string; S: number; A: number; R: number; result: string; adv: number | null; measured: number | null }
interface State { ok?: boolean; match: { phase: number; tick: number; fighters: Fighter[]; training: { meter: Meter | null; dummy: string; recLen: number; recording: boolean } | null } | null }


test.use({ viewport: { width: 960, height: 540 } });

test.describe('fighter training @fighter-training', () => {
  test('frame meter, box overlay and the recorded dummy @fighter-training', async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?fighter=1&world=walk-drop');
    await waitForEngine(page);
    await page.waitForFunction(() => Boolean((window as unknown as { __dvBridge?: { fighter?: unknown } }).__dvBridge?.fighter), undefined, { timeout: 90_000 });

    // A manual Training match: walk up to the dummy.
    await page.evaluate(async () => {
      const b = (window as unknown as { __dvBridge: Bridge }).__dvBridge.fighter;
      await b.start({ kind: 'training', manual: true });
      for (let i = 0; i < 400 && !(await b.state())?.ok; i++) await new Promise((r) => setTimeout(r, 25));
      let s = await b.step(300, 0, 0);
      for (let i = 0; i < 40 && s?.match?.phase !== 3; i++) s = await b.step(60, 0, 0);
      for (let i = 0; i < 200; i++) {
        const f = s?.match?.fighters;
        if (f && Math.abs((f[1] as Fighter).x - (f[0] as Fighter).x) < 520) break;
        s = await b.step(1, b.FB['Right'], 0);
      }
      await b.step(2, 0, 0);
    });

    const hitMeter = await page.evaluate(async () => {
      const b = (window as unknown as { __dvBridge: Bridge }).__dvBridge.fighter;
      await b.step(1, b.FB['LP'], 0);
      const s = await b.step(60, 0, 0);
      return s?.match?.training?.meter ?? null;
    });
    console.log('hit meter', JSON.stringify(hitMeter));
    expect(hitMeter).not.toBeNull();
    expect(hitMeter).toMatchObject({ move: '5L', S: 4, A: 2, R: 8, result: 'hit', adv: 4 });
    expect(hitMeter?.measured).toBe(4);

    // The overlay draws boxes while it is on, and nothing once it is off.
    const boxesOn = await page.evaluate(async () => {
      const b = (window as unknown as { __dvBridge: Bridge }).__dvBridge;
      await b.fighter.step(1, b.fighter.FB['LP'], 0);
      await b.fighter.step(5, 0, 0);
      return b.fighterStage.state()?.overlaySegments ?? 0;
    });
    expect(boxesOn).toBeGreaterThan(0);
    const boxesOff = await page.evaluate(async () => {
      const b = (window as unknown as { __dvBridge: Bridge }).__dvBridge;
      await b.fighter.cmd('train.overlay', { key: 'boxes', on: false });
      await b.fighter.step(2, 0, 0);
      return b.fighterStage.state()?.overlaySegments ?? 0;
    });
    expect(boxesOff).toBe(0);
    await page.evaluate(async () => {
      const b = (window as unknown as { __dvBridge: Bridge }).__dvBridge.fighter;
      await b.cmd('train.overlay', { key: 'boxes', on: true });
    });

    // The dummy blocks all: the same 5L is +1 on block.
    const blockMeter = await page.evaluate(async () => {
      const b = (window as unknown as { __dvBridge: Bridge }).__dvBridge.fighter;
      await b.step(80, 0, 0);
      await b.cmd('train.dummy', { mode: 'blockAll' });
      await b.cmd('train.reset');
      let s = await b.step(2, 0, 0);
      for (let i = 0; i < 200; i++) {
        const f = s?.match?.fighters;
        if (f && Math.abs((f[1] as Fighter).x - (f[0] as Fighter).x) < 520) break;
        s = await b.step(1, b.FB['Right'], 0);
      }
      await b.step(2, 0, 0);
      await b.step(1, b.FB['LP'], 0);
      s = await b.step(60, 0, 0);
      return s?.match?.training?.meter ?? null;
    });
    console.log('block meter', JSON.stringify(blockMeter));
    expect(blockMeter).toMatchObject({ move: '5L', S: 4, A: 2, R: 8, result: 'block', adv: 1 });
    expect(blockMeter?.measured).toBe(1);

    // Record a short sequence, then play it back twice through the dummy: the two traces are the same.
    const traces = await page.evaluate(async () => {
      const b = (window as unknown as { __dvBridge: Bridge }).__dvBridge.fighter;
      await b.cmd('train.dummy', { mode: 'stand' });
      await b.cmd('train.reset');
      await b.step(2, 0, 0);
      await b.cmd('train.rec', { on: true });
      await b.step(10, 0, 0);
      await b.step(1, b.FB['LP'], 0);
      await b.step(20, 0, 0);
      await b.step(1, b.FB['HP'], 0);
      await b.step(40, 0, 0);
      await b.cmd('train.rec', { on: false });
      const out: string[][] = [];
      for (let run = 0; run < 2; run++) {
        await b.cmd('train.reset');
        await b.cmd('train.dummy', { mode: 'playback' });
        const trace: string[] = [];
        for (let t = 0; t < 72; t++) {
          const s = await b.step(1, 0, 0);
          const d = s?.match?.fighters[1] as Fighter;
          trace.push(`${d.state}:${d.move}:${d.moveFrame}`);
        }
        out.push(trace);
      }
      const s = await b.state();
      return { out, recLen: s?.match?.training?.recLen ?? 0 };
    });
    expect(traces.recLen).toBe(72);
    expect(traces.out[0]).toEqual(traces.out[1]);
    // the dummy really performed moves (not a trace of an idle dummy)
    expect(new Set((traces.out[0] as string[]).map((x) => x.split(':')[1])).size).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });
});
