import { readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { waitForEngine } from '../engine-helpers.ts';
import { hideQaPanels, NO_BYPASS } from './helpers.ts';

/**
 * The HUD on a phone (BD-FIX-MOBILE-HUD-01; `@hud-layout`, the DV_WORLD=synth half of CI). The owner's report from staging (844 x 390,
 * iPhone user agent, mobile-low): Phone and Pause sat on the clock pill, the Special button on the subtitle box, the minimap under the
 * stick ring, the look tip spoke of the mouse, and in the intro cutscene Skip covered the Phone button.
 *
 * The story start runs on a touch viewport. A recorder in the page reads, every 100 ms, the box of every visible HUD element, touch
 * button, the stick ring and the cutscene controls (by test id) and notes any two that overlap or any that leaves the safe area. It runs
 * through the intro cutscene and through play, each at the iPhone landscape fixture (844 x 390), a small Android landscape (740 x 360) and
 * in portrait (390 x 844), where the rotate card must cover all of it. On Chromium the fixture's design insets are emulated as the safe
 * area (`Emulation.setSafeAreaInsetsOverride`); where that is not available the safe area is the viewport.
 */
type Insets = { top: number; right: number; bottom: number; left: number };
type Box = { id: string; x: number; y: number; w: number; h: number };
type Violation = { phase: string; vw: number; vh: number; kind: 'overlap' | 'outside' | 'uncovered' | 'touch-in-cutscene' | 'clipped'; a: Box; b?: Box };
type Rec = { phase: string; samples: number; seen: Record<string, string[]>; violations: Violation[]; stop: boolean; tip: { id: string; text: string }[] };
type W = { __dvLayout: Rec; __dvBridge?: { mission?: { state(): { phase?: string; mission?: string } | null } } };

const FIXTURE = JSON.parse(readFileSync('packages/ui/test/fixtures/iphone-landscape.json', 'utf8')) as { viewport: { width: number; height: number }; insets: Insets };
const EN = JSON.parse(readFileSync('content/ui/i18n/en.json', 'utf8')) as Record<string, string>;
const IPHONE = FIXTURE.viewport;
const ANDROID = { width: 740, height: 360 };
const PORTRAIT = { width: 390, height: 844 };
/** Every HUD element, touch control and cutscene control whose box is checked; `^` marks a test-id prefix. */
const IDS = [
  'hud-objective', 'hud-area', 'hud-sandbox', 'hud-clock', 'hud-wallet', 'hud-save', 'hud-heat', 'hud-minimap', 'hud-health', 'hud-speed',
  'hud-tip', 'hud-prompt', 'hud-subtitles', 'fps-chip', 'touch-stick-hint', '^touch-btn-', '^toast-',
  'cutscene-skip', 'cutscene-ai-chip', 'cutscene-subtitle',
];
const TOUCH_BUTTONS = ['jump', 'attack', 'special', 'enter', 'block', 'camera', 'pause', 'phone'].map((b) => `touch-btn-${b}`);

/** Starts the recorder; `insets` is the safe area the page was given. */
async function record(page: Page, insets: Insets): Promise<void> {
  await page.evaluate(
    ({ ids, insets }) => {
      const rec: Rec = { phase: 'boot', samples: 0, seen: {}, violations: [], stop: false, tip: [] };
      (window as unknown as W).__dvLayout = rec;
      const visible = (el: Element): boolean => {
        for (let e: Element | null = el; e; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        }
        return true;
      };
      const boxes = (): { list: Box[]; els: Element[] } => {
        const list: Box[] = [];
        const els: Element[] = [];
        for (const id of ids) {
          const sel = id.startsWith('^') ? `[data-testid^="${id.slice(1)}"]` : `[data-testid="${id}"]`;
          for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1 || !visible(el)) continue;
            list.push({ id: el.getAttribute('data-testid') ?? id, x: r.x, y: r.y, w: r.width, h: r.height });
            els.push(el);
          }
        }
        return { list, els };
      };
      const note = (v: Violation): void => {
        if (rec.violations.length < 40 && !rec.violations.some((o) => o.phase === v.phase && o.kind === v.kind && o.a.id === v.a.id && o.b?.id === v.b?.id)) rec.violations.push(v);
      };
      const sample = (): void => {
        if (rec.stop) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const { list, els } = boxes();
        // A sample under a cutscene counts as `<phase>:cut`, so a beat that ends inside a phase splits it instead of mixing the two.
        const cut = document.documentElement.hasAttribute('data-dv-cutscene');
        const seen = (rec.seen[cut ? `${rec.phase}:cut` : rec.phase] ??= []);
        for (const b of list) if (!seen.includes(b.id)) seen.push(b.id);
        const tip = document.querySelector('[data-testid="hud-tip"]');
        if (tip) {
          const t = { id: tip.getAttribute('data-hint') ?? '', text: tip.textContent ?? '' };
          if (!rec.tip.some((o) => o.id === t.id && o.text === t.text)) rec.tip.push(t);
        }
        const card = document.querySelector('[data-testid="rotate-overlay"]');
        if (card && visible(card)) {
          // Portrait in play: the card covers the whole viewport and nothing shows above it.
          const r = card.getBoundingClientRect();
          if (r.x > 0.5 || r.y > 0.5 || r.right < vw - 0.5 || r.bottom < vh - 0.5) note({ phase: rec.phase, vw, vh, kind: 'uncovered', a: { id: 'rotate-overlay', x: r.x, y: r.y, w: r.width, h: r.height } });
          list.forEach((b, i) => {
            const cx = Math.min(vw - 1, Math.max(0, b.x + b.w / 2));
            const cy = Math.min(vh - 1, Math.max(0, b.y + b.h / 2));
            const top = document.elementFromPoint(cx, cy);
            if (!top || !card.contains(top) || (els[i] as Element).contains(top)) note({ phase: rec.phase, vw, vh, kind: 'uncovered', a: b });
          });
          rec.samples++;
          return;
        }
        const safe = { l: insets.left, t: insets.top, r: vw - insets.right, b: vh - insets.bottom };
        list.forEach((b, i) => {
          // the touch layer gives way to a cutscene's own controls; and no box's content spills out of it (a pill too narrow for its text)
          if (cut && b.id.startsWith('touch-')) note({ phase: rec.phase, vw, vh, kind: 'touch-in-cutscene', a: b });
          const el = els[i] as Element;
          if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible') note({ phase: rec.phase, vw, vh, kind: 'clipped', a: b });
        });
        for (const b of list) {
          if (b.x < safe.l - 0.5 || b.y < safe.t - 0.5 || b.x + b.w > safe.r + 0.5 || b.y + b.h > safe.b + 0.5) note({ phase: rec.phase, vw, vh, kind: 'outside', a: b });
        }
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = list[i] as Box;
            const c = list[j] as Box;
            const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
            const oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
            if (ox > 0.5 && oy > 0.5) note({ phase: rec.phase, vw, vh, kind: 'overlap', a, b: c });
          }
        }
        rec.samples++;
      };
      // Each sample is read in an animation frame, after the frame's resize events and the renders they cause: what gets painted.
      const timer = setInterval(() => {
        if (rec.stop) clearInterval(timer);
        else requestAnimationFrame(sample);
      }, 100);
    },
    { ids: IDS, insets },
  );
}

const rec = (page: Page): Promise<Rec> => page.evaluate(() => (window as unknown as W).__dvLayout);

/** Names the phase the next samples belong to and waits until at least `n` samples were taken in it. */
async function phase(page: Page, name: string, n = 10): Promise<void> {
  const before = await page.evaluate((p) => {
    const r = (window as unknown as W).__dvLayout;
    r.phase = p;
    return r.samples;
  }, name);
  await expect.poll(async () => (await rec(page)).samples - before, { timeout: 30_000 }).toBeGreaterThanOrEqual(n);
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
}

/** The safe area the page runs with: the fixture's design insets where Chromium can emulate them, else none. */
async function safeArea(page: Page, testInfo: TestInfo): Promise<Insets> {
  if (testInfo.project.use.browserName !== 'chromium') return { top: 0, right: 0, bottom: 0, left: 0 };
  try {
    const cdp = await page.context().newCDPSession(page);
    const i = FIXTURE.insets;
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: i.top, right: i.right, bottom: i.bottom, left: i.left } });
    return i;
  } catch (e) {
    testInfo.annotations.push({ type: 'safe-area', description: `no inset emulation here (${String(e).slice(0, 120)}); the safe area is the viewport` });
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
}

/** Holds the sim (`__dvBridge.engine.setPaused`): the intro beat and a subtitle line run on sim time, so they stay up while the viewports change. */
const hold = (page: Page, on: boolean): Promise<void> =>
  page.evaluate((p) => (window as unknown as { __dvBridge: { engine: { setPaused(p: boolean): void } } }).__dvBridge.engine.setPaused(p), on);

/**
 * From the iPhone fixture through the small Android landscape and portrait and back, `n` samples in each. Leaving portrait clears the
 * rotate card, which lets the sim run again, so the hold is put back.
 */
async function sweep(page: Page, testInfo: TestInfo, base: string, n: number): Promise<void> {
  for (const [vp, label] of [[ANDROID, '740x360'], [PORTRAIT, '390x844']] as const) {
    await page.setViewportSize(vp);
    await phase(page, `${base}-${label}`, n);
    await shot(page, testInfo, `${base}-${label}`);
  }
  await page.setViewportSize(IPHONE);
  await expect(page.getByTestId('rotate-overlay')).toHaveCount(0);
  await hold(page, true);
  await phase(page, `${base}-844x390-again`, n);
}

test.describe('the HUD on a touch viewport @hud-layout', () => {
  test.use({ storageState: NO_BYPASS, viewport: IPHONE, hasTouch: true, isMobile: true, locale: 'en-US' });
  test.describe.configure({ timeout: 420_000 });

  test('no HUD element, touch control or cutscene control overlaps another or leaves the safe area, in the intro and in play; tips use touch wording @hud-layout', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await hideQaPanels(page);
    await page.addInitScript(() => {
      // the QA build's NPC agency box (apps/web/src/qa/npc-agency.ts) sits bottom left over the game; a production build has none
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = '.dv-npcagency { display: none !important }';
        document.head.append(st);
      });
    });
    const insets = await safeArea(page, testInfo);
    await page.goto('/?play=story&story=1&touch=1&tier=mobile-low');
    await waitForEngine(page);
    await record(page, insets);

    // The intro cutscene of m.a1.01 (an 8 s in-engine beat with one cue at 0.6 s): the touch layer gives way to the cutscene's controls.
    const skip = page.getByTestId('cutscene-skip');
    await expect(skip).toBeVisible({ timeout: 240_000 });
    await hold(page, true);
    await phase(page, 'cutscene-844x390');
    await shot(page, testInfo, 'cutscene-844x390');
    await sweep(page, testInfo, 'cutscene', 5);
    await hold(page, false);

    // Into play: the stage's first line (Odessa at the gate), held on screen while the viewports change, then the stick and the look tip.
    if (await skip.isVisible()) await skip.tap();
    await expect(skip).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId('hud-subtitles')).toBeVisible({ timeout: 90_000 });
    await hold(page, true);
    await phase(page, 'play-844x390');
    await shot(page, testInfo, 'play-844x390');
    await sweep(page, testInfo, 'play', 10);
    await hold(page, false);

    // The look tip, once the stick has moved the player: touch wording, never the mouse (the report's "Look around with the mouse").
    await page.evaluate(async () => {
      const el = document.querySelector('.dv-touch') as HTMLElement;
      const send = (type: string, x: number, y: number): void => {
        const ev = new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true });
        el.dispatchEvent(ev);
        if (ev.pointerType !== 'touch') {
          // WebKit drops pointerType from a synthetic PointerEvent: the binder's Touch Event fallback (tests/e2e/ui/touch.spec.ts).
          const tt = type === 'pointerdown' ? 'touchstart' : type === 'pointermove' ? 'touchmove' : 'touchend';
          const t = new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
          el.dispatchEvent(new TouchEvent(tt, { touches: type === 'pointerup' ? [] : [t], targetTouches: [], changedTouches: [t], bubbles: true, cancelable: true }));
        }
      };
      send('pointerdown', 220, 280);
      for (let i = 1; i <= 10; i++) {
        send('pointermove', 220, 280 - i * 5);
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 600));
      send('pointerup', 220, 230);
    });
    await expect.poll(async () => (await rec(page)).tip.map((t) => t.id), { timeout: 30_000 }).toContain('look');
    await phase(page, 'play-look-844x390', 5);
    await shot(page, testInfo, 'play-look-844x390');

    const r = await rec(page);
    await page.evaluate(() => {
      (window as unknown as W).__dvLayout.stop = true;
    });
    console.log(`${testInfo.project.name}: ${r.samples} samples; safe area ${JSON.stringify(insets)}; tips ${JSON.stringify(r.tip)}; seen ${JSON.stringify(r.seen)}`);
    // what each phase must have shown: the cutscene's Skip and no touch control under a cutscene; the whole HUD and touch layer in play
    for (const p of ['cutscene-844x390', 'cutscene-740x360']) expect(r.seen[`${p}:cut`] ?? [], `${p}: Skip`).toContain('cutscene-skip');
    const need = ['hud-objective', 'hud-clock', 'hud-wallet', 'hud-heat', 'hud-minimap', 'hud-subtitles', 'hud-tip', 'touch-stick-hint', ...TOUCH_BUTTONS];
    for (const p of ['play-844x390', 'play-740x360', 'play-844x390-again']) expect(need.filter((id) => !(r.seen[p] ?? []).includes(id)), `${p}: not seen`).toEqual([]);
    // portrait: the rotate card is up over the HUD, the touch layer and the cutscene (the recorder checks the cover)
    for (const p of ['cutscene-390x844', 'play-390x844']) expect([...(r.seen[p] ?? []), ...(r.seen[`${p}:cut`] ?? [])], `${p}: the page under the card`).not.toEqual([]);
    for (const t of r.tip) expect(t.text, `tip ${t.id} uses the touch wording`).toBe(EN[`hint.${t.id}.touch`]);
    expect(r.violations, JSON.stringify(r.violations, null, 1)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
