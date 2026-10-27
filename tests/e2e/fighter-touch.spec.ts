import { expect, test, type Page } from '@playwright/test';
import { waitForEngine } from './engine-helpers.ts';

/**
 * M08a2 AC-5, @fighter-touch: the Simple scheme on a phone-sized touch viewport (844 x 390, WebKit). A best-of-3 against the CPU on
 * Easy is played with touch contacts only: the left thumb drags the stick toward the opponent, the right thumb taps L, H and SP.
 * The match must end (MatchEnd, with the match result of the session), a Special must land on the way (the opponent loses health
 * while slot 0 is in one of its specials), and Continue leaves the mode (the ModeResult goes back to the host).
 *
 * To see it by hand: open `/?fighter=versus&touch=1` on a QA build with a phone or a desktop browser in device mode.
 */
test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

interface Fighter { x: number; state: number; move: number; hp: number }
interface State {
  ok?: boolean;
  screen?: string;
  result: { outcome: string; rounds: [number, number] } | null;
  match: { phase: number; round: number; rounds: [number, number]; fighters: Fighter[] } | null;
  stats: { hits: [number, number]; specialHits: [number, number] };
}

async function touch(page: Page, kind: 'down' | 'move' | 'up', id: number, x: number, y: number, selector: string): Promise<void> {
  await page.evaluate(
    ({ kind, id, x, y, selector }) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) throw new Error(`no element ${selector}`);
      const pointerOk = new PointerEvent('pointerdown', { pointerType: 'touch' }).pointerType === 'touch';
      if (pointerOk) {
        const type = kind === 'down' ? 'pointerdown' : kind === 'move' ? 'pointermove' : 'pointerup';
        el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true }));
      } else {
        const type = kind === 'down' ? 'touchstart' : kind === 'move' ? 'touchmove' : 'touchend';
        const t = new Touch({ identifier: id, target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent(type, { touches: kind === 'up' ? [] : [t], targetTouches: kind === 'up' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
      }
    },
    { kind, id, x, y, selector },
  );
}

const fighter = <T>(page: Page, expr: string): Promise<T> => page.evaluate(`(async () => { const f = window.__dvBridge.fighter; return ${expr}; })()`) as Promise<T>;
const state = (page: Page): Promise<State> => fighter<State>(page, 'f.state()');

test.describe('fighter touch @fighter-touch', () => {
  test('a best-of-3 against the CPU on Easy by touch @fighter-touch', async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?fighter=1&touch=1&world=walk-drop');
    await waitForEngine(page);
    await page.waitForFunction(() => Boolean((window as unknown as { __dvBridge?: { fighter?: unknown } }).__dvBridge?.fighter), undefined, { timeout: 90_000 });

    const started = await fighter<{ ok?: boolean }>(page, "f.start({ kind: 'versus', cpu: 0, scheme: 'simple', rounds: 2 })");
    expect(started?.ok).toBe(true);
    await expect.poll(async () => (await state(page)).match != null, { timeout: 60_000 }).toBe(true);

    // The fighter layout replaced the walking one.
    await expect(page.locator('.dv-touch')).toBeVisible();
    await expect(page.locator('.dv-touch')).toHaveAttribute('data-layout', 'fighter-simple');
    for (const id of ['l', 'h', 'special']) await expect(page.locator(`[data-dv-btn="${id}"]`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('fighter-touch-start.png') });

    // Play: drag the stick toward the opponent until close, then tap the buttons in turn.
    let specialHits = 0;
    let stickDown = false;
    let n = 0;
    const deadline = Date.now() + 360_000;
    for (;;) {
      const s = await state(page);
      specialHits = Math.max(specialHits, s.stats?.specialHits[0] ?? 0);
      if (s.result || s.screen === 'results') break;
      if (Date.now() > deadline) throw new Error('the match did not end in time');
      const m = s.match;
      if (m && m.phase === 3) {
        const [me, foe] = m.fighters as [Fighter, Fighter];
        const gap = Math.abs(foe.x - me.x);
        const wantDir = foe.x > me.x ? 1 : -1;
        if (gap > 700) {
          if (!stickDown) { await touch(page, 'down', 1, 100, 250, '.dv-touch'); stickDown = true; }
          await touch(page, 'move', 1, 100 + wantDir * 70, 250, '.dv-touch');
        } else if (stickDown) {
          await touch(page, 'up', 1, 100, 250, '.dv-touch');
          stickDown = false;
        }
        if (gap <= 700) {
          const id = ['special', 'l', 'h', 'special', 'l'][n++ % 5] as string;
          await touch(page, 'down', 2, 700, 320, `[data-dv-btn="${id}"]`);
          await page.waitForTimeout(70);
          await touch(page, 'up', 2, 700, 320, `[data-dv-btn="${id}"]`);
        }
      }
      await page.waitForTimeout(180);
    }
    if (stickDown) await touch(page, 'up', 1, 100, 250, '.dv-touch');
    const end = await state(page);
    specialHits = Math.max(specialHits, end.stats?.specialHits[0] ?? 0);
    console.log('match result', JSON.stringify(end.result), 'special hits', specialHits);
    await page.screenshot({ path: testInfo.outputPath('fighter-touch-end.png') });
    expect(end.result).not.toBeNull();
    expect(['win', 'lose']).toContain(end.result?.outcome);
    expect(Math.max(...(end.result?.rounds ?? [0, 0]))).toBe(2);
    expect(specialHits, 'a Special landed on the way').toBeGreaterThan(0);

    // Continue gives the ModeResult back to the host: the fighter session is gone.
    await fighter(page, "f.cmd('exit')");
    await expect.poll(async () => ((await state(page)) as State).ok === false, { timeout: 30_000 }).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
