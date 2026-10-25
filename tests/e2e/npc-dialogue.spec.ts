import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { NpcBridge } from '../../packages/npc/src/debug/overlay.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';
import { HOME, NO_BYPASS, passGates, waitForEngineReady } from './ui/helpers.ts';

/**
 * M06a3 @npc-dialogue: the NPC debug panel in the default QA scene, in a real browser (Chromium and WebKit).
 *
 *  - the panel "Talk to npc_test (QA)" is on screen; with no play token the Greet button gives the NPC's ink line, no error;
 *  - with a play token (set through the QA bridge) and the Worker mocked at the network, the stream is read by the real client: the line
 *    appears, the AI badge shows, and the panel says whether the answer was recorded or live;
 *  - one of the four offline ApiError codes (budget_offline) and a kill (kill_switched, which also re-reads the roster flags) continue in ink.
 * The Worker side is proved by `pnpm check:workers -- npc`; the Worker is mocked here (page.route) so the test does not depend on secrets.
 *
 * M06a5 adds the real panel (`DialogueBubble`): every bridge turn opens it, and it hides this QA box while it is up, so the older cases close the
 * panel (Close button) before they use the box again. The new cases below read the panel itself: @npc (AC-1), @npc-offline (AC-2) and one
 * @ui-a11y case (AC-7).
 */
type W = { __dvBridge: { npc: NpcBridge & { setAuthHeader(h: string | null): void } } };

const INK_GREETING = 'Good day. Please confirm the lot is clear.';
const LINE = 'Copy that. This answer is a recorded fixture, not a live model.';

const events = (line: string): string => {
  const e = (name: string, data: unknown): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  const words = line.split(' ');
  return (
    e('meta', { encounterId: '0198aaaa-bbbb-7ccc-8ddd-eeeeffff0000', turnIndex: 0, npcId: 'npc_test', soulVersion: 1, model: 'haiku', voice: 'text', turnsLeft: 5, disclosure: { aiCharacter: true, disclaimer: 'none' }, gov: 0 }) +
    words.map((w, i) => e('line.delta', { seq: i, text: i === 0 ? w : ` ${w}` })).join('') +
    e('line.done', { text: line, words: words.length }) +
    e('effects', { mood: 'neutral' }) +
    e('done', { costMicros: 348, turnsLeft: 5, closed: false })
  );
};

/** The panel is up for a bridge turn; close it so the QA box (hidden while the panel shows) can be used again. */
async function closePanel(page: Page): Promise<void> {
  const close = page.getByTestId('dialogue-close');
  if (await close.isVisible()) await close.click();
  await expect(page.getByTestId('dialogue-panel')).toBeHidden();
}

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize(SMALL_VIEWPORT);
  await page.goto('/?play=off&tier=mobile-low');
  await waitForEngine(page);
  await page.waitForFunction(() => (window as unknown as W).__dvBridge.npc !== undefined, undefined, { timeout: 60_000 });
  return errors;
}

test.describe('npc dialogue panel @npc-dialogue', () => {
  test.describe.configure({ timeout: 180_000 });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows the panel, answers a greeting from ink without a play token, and streams a mocked Worker answer with the AI badge', async ({ page }, info) => {
    const errors = await boot(page);
    const overlay = page.getByTestId('npc-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('Talk to npc_test');
    await expect(page.getByTestId('npc-ai-badge')).toBeHidden();

    // No play token: the client does not call the Worker and plays the NPC's ink.
    let talkCalls = 0;
    await page.route('**/api/v1/npc/npc_test/talk', async (route) => {
      talkCalls++;
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'x-dv-npc-mode': 'fixture' }, body: events(LINE) });
    });
    await page.getByTestId('npc-greet').click();
    await expect(page.getByTestId('npc-line')).toHaveText(INK_GREETING);
    await expect(page.getByTestId('npc-meta')).toContainText('ink');
    await expect(page.getByTestId('dialogue-line')).toHaveText(INK_GREETING); // the real panel shows the same line
    expect(talkCalls).toBe(0);
    await closePanel(page);

    // A play token: the stream is read and shown, with the badge and the honest source label.
    await page.evaluate(() => (window as unknown as W).__dvBridge.npc.setAuthHeader('PlayToken e2e'));
    await page.getByTestId('npc-smalltalk').click();
    await expect(page.getByTestId('npc-line')).toHaveText(LINE);
    await expect(page.getByTestId('dialogue-ai-badge')).toBeVisible();
    await expect(page.getByTestId('npc-meta')).toContainText('recorded fixture, not a live model');
    await expect(page.getByTestId('npc-meta')).toContainText('meta line.delta');
    expect(talkCalls).toBe(1);
    const turn = await page.evaluate(() => (window as unknown as W).__dvBridge.npc.last());
    expect(turn).toMatchObject({ source: 'llm', mode: 'fixture', aiCharacter: true, text: LINE });
    await info.attach('npc-panel', { body: await page.screenshot(), contentType: 'image/png' });
    expect(errors).toEqual([]);
  });

  test('continues in ink on budget_offline and on kill_switched, with no error, and re-reads the flags after the kill', async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate(() => (window as unknown as W).__dvBridge.npc.setAuthHeader('PlayToken e2e'));
    let code = 'budget_offline';
    let rosterReads = 0;
    await page.route('**/api/v1/npc/npc_test/talk', (route) =>
      route.fulfill({ status: code === 'kill_switched' ? 410 : 503, contentType: 'application/json', body: JSON.stringify({ error: { code, message: 'x', requestId: 'r' } }) }),
    );
    await page.route('**/api/v1/roster', (route) => {
      rosterReads++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ etag: 'k1', killed: { npc_test: { scope: ['all'], standIn: 'character/standin_rapper' } }, updatedAt: 1 }) });
    });

    await page.getByTestId('npc-greet').click();
    await expect(page.getByTestId('npc-line')).toHaveText(INK_GREETING);
    await expect(page.getByTestId('npc-ai-badge')).toBeHidden();
    await closePanel(page);

    code = 'kill_switched';
    const before = rosterReads;
    await page.getByTestId('npc-farewell').click();
    await expect(page.getByTestId('npc-line')).toHaveText('Checklist complete. Good day.');
    await expect.poll(() => rosterReads).toBeGreaterThan(before);
    expect(errors).toEqual([]);
  });

  test('?npc=local streams a recorded reply made in the browser, with the badge and an honest label', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?play=off&tier=mobile-low&npc=local');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.npc !== undefined, undefined, { timeout: 60_000 });
    await page.getByTestId('npc-greet').click();
    await expect(page.getByTestId('npc-line')).toHaveText(INK_GREETING);
    await expect(page.getByTestId('dialogue-ai-badge')).toBeVisible();
    await expect(page.getByTestId('npc-meta')).toContainText('recorded in this browser');
    const turn = await page.evaluate(() => (window as unknown as W).__dvBridge.npc.last());
    expect(turn).toMatchObject({ source: 'llm', mode: 'local-fixture', aiCharacter: true });
    expect(errors).toEqual([]);
  });

  test('M06a4: with Voice on, a spoken reply moves the mouth readout off the rest shape (?npc=local&npcId=ro-batista)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize(SMALL_VIEWPORT);
    await page.goto('/?play=off&tier=mobile-low&npc=local&npcId=ro-batista');
    await waitForEngine(page);
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.npc !== undefined, undefined, { timeout: 60_000 });
    const lit = page.locator('[data-testid="npc-viseme"] [data-on="true"]');
    await expect(lit).toHaveText('X');
    await page.getByTestId('npc-voice').check();
    await page.getByTestId('npc-smalltalk').click();
    // ro-batista is a fictional character the profile has not met: the likeness card comes before the first line (M06a5)
    await expect(page.getByTestId('dialogue-likeness-text')).toHaveText('Fictional character.');
    await page.getByTestId('dialogue-likeness-continue').click();
    await expect(page.getByTestId('npc-line')).not.toHaveText('');
    // The synthetic voice has syllable-like bursts: some Rhubarb shape other than the rest shape X lights up while the line plays.
    await expect.poll(async () => (await lit.allTextContents()).join(''), { timeout: 20_000 }).not.toBe('X');
    expect(errors).toEqual([]);
  });

  test('drops the partial line and plays the deflect knot when the Worker sends a fallback after some text', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (window as unknown as W).__dvBridge.npc.setAuthHeader('PlayToken e2e'));
    const e = (name: string, data: unknown): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    const body =
      e('meta', { encounterId: '0198aaaa-bbbb-7ccc-8ddd-eeeeffff0000', turnIndex: 0, npcId: 'npc_test', soulVersion: 1, model: 'haiku', voice: 'text', turnsLeft: 5, disclosure: { aiCharacter: true, disclaimer: 'none' }, gov: 0 }) +
      e('line.delta', { seq: 0, text: 'I will not' }) +
      e('fallback', { reason: 'refusal', knot: 'deflect' }) +
      e('done', { costMicros: 0, turnsLeft: 5, closed: false });
    await page.route('**/api/v1/npc/npc_test/talk', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body }));
    await page.getByTestId('npc-smalltalk').click();
    await expect(page.getByTestId('npc-line')).toHaveText('That is outside the script. Next line of the checklist.');
    await expect(page.getByTestId('npc-line')).not.toContainText('I will not');
  });
});

// ---- M06a5: the real dialogue panel

type Bridge = { __dvBridge: { npc: NpcBridge; engine: { modes: { vm(k: string): unknown } } } };
const HAPPY = 'Welcome to the lot. The checklist is open, so go ahead.';
const subtitle = (page: Page): Promise<unknown> => page.evaluate(() => (window as unknown as Bridge).__dvBridge.engine.modes.vm('hud.subtitle') ?? null);

test.describe('dialogue panel @npc', () => {
  test.describe.configure({ timeout: 180_000 });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('AC-1: opens for npc_test, streams talk-happy.sse with the AI badge and a subtitle cue, shows no report button, and closes after done {closed:true} @npc', async ({ page }, info) => {
    const errors = await boot(page);
    const sse = readFileSync(new URL('./fixtures/npc/talk-happy.sse', import.meta.url), 'utf8');
    let calls = 0;
    let sent: { turn?: { intent?: string }; npcId?: string } = {};
    await page.route('**/api/v1/npc/npc_test/talk', async (route) => {
      calls++;
      sent = route.request().postDataJSON() as typeof sent;
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'x-dv-npc-mode': 'fixture' }, body: sse });
    });
    await page.evaluate(() => (window as unknown as W).__dvBridge.npc.setAuthHeader('PlayToken e2e'));

    // the player opens a conversation: the panel, the speaker and the badge; the QA box steps aside
    await page.evaluate(() => (window as unknown as W).__dvBridge.npc.open('npc_test'));
    const panel = page.getByTestId('dialogue-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('dialogue-speaker')).toHaveText('Tester Nine');
    await expect(page.getByTestId('dialogue-ai-badge')).toBeVisible();
    await expect(page.getByTestId('npc-overlay')).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-dv-dialogue', 'open');
    await expect(page.getByTestId('dialogue-speaker')).toBeFocused();

    // "Greet": the streamed line, the badge for the whole exchange, a matching hud.subtitle cue
    await page.getByTestId('dialogue-intent-greet').click();
    await expect(page.getByTestId('dialogue-line')).toHaveText(HAPPY);
    await expect(page.getByTestId('dialogue-ai-badge')).toBeVisible();
    await expect.poll(() => subtitle(page)).toMatchObject({ speaker: 'Tester Nine', text: HAPPY });
    // the report button exists only once route 41 does (dialogueCapabilities.reports is false in this milestone)
    await expect(page.getByTestId('dialogue-report')).toHaveCount(0);
    await expect(page.getByTestId('report-button')).toHaveCount(0);
    expect(calls).toBe(1);
    expect(sent).toMatchObject({ npcId: 'npc_test', turn: { intent: 'greet' } });
    await info.attach('dialogue-panel', { body: await page.screenshot(), contentType: 'image/png' });

    // done {closed:true}: the panel closes once the line has had its reading time; the QA box comes back
    await expect(panel).toBeHidden({ timeout: 20_000 });
    await expect(page.locator('html')).not.toHaveAttribute('data-dv-dialogue', 'open');
    await expect(page.getByTestId('npc-overlay')).toBeVisible();
    await expect.poll(() => subtitle(page), { timeout: 10_000 }).toBeNull();
    expect(errors).toEqual([]);
  });

  test('typed text goes out, a self-harm phrase brings the safety card with 988, and Close closes the panel', async ({ page }) => {
    const errors = await boot(page);
    const texts: string[] = [];
    const sse = readFileSync(new URL('./fixtures/npc/talk-happy.sse', import.meta.url), 'utf8').replace('"closed":true', '"closed":false').replace(',"endConversation":true', '');
    await page.route('**/api/v1/npc/npc_test/talk', async (route) => {
      texts.push(String((route.request().postDataJSON() as { turn: { text?: string } }).turn.text));
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'x-dv-npc-mode': 'fixture' }, body: sse });
    });
    await page.evaluate(() => (window as unknown as W).__dvBridge.npc.setAuthHeader('PlayToken e2e'));
    await page.evaluate(() => (window as unknown as W).__dvBridge.npc.open('npc_test'));
    await page.getByTestId('dialogue-input').fill('How is the weather?');
    await page.getByTestId('dialogue-send').click();
    await expect(page.getByTestId('dialogue-line')).toHaveText(HAPPY);
    await expect(page.getByTestId('dialogue-safety')).toHaveCount(0);
    await page.getByTestId('dialogue-input').fill('some days I want to die');
    await page.getByTestId('dialogue-send').click();
    await expect(page.getByTestId('dialogue-safety')).toBeVisible();
    await expect(page.getByTestId('dialogue-safety-body')).toContainText('988');
    await expect(page.getByTestId('dialogue-safety-close')).toBeFocused();
    await page.getByTestId('dialogue-safety-resources-btn').click();
    await expect(page.getByTestId('dialogue-safety-resources')).toContainText('988');
    // only Close and Resources can be reached while the card is up
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.closest('[data-testid="dialogue-safety"]') !== null)).toBe(true);
    }
    await page.getByTestId('dialogue-safety-close').click();
    await expect(page.getByTestId('dialogue-panel')).toBeHidden();
    expect(texts).toEqual(['How is the weather?', 'some days I want to die']);
    expect(errors).toEqual([]);
  });

  test('Esc closes the panel', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => (window as unknown as W).__dvBridge.npc.open('npc_test'));
    await expect(page.getByTestId('dialogue-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dialogue-panel')).toBeHidden();
  });
});

test.describe('dialogue panel offline @npc-offline', () => {
  test.describe.configure({ timeout: 180_000 });
  test.use({ storageState: { cookies: [], origins: [] } });

  test('AC-2: with route 31 aborted the ink greeting shows with the badge, no error appears, and npc.turn.client says fallback @npc-offline', async ({ page }) => {
    const errors = await boot(page);
    await page.route('**/api/v1/npc/npc_test/talk', (route) => route.abort('failed'));
    await page.evaluate(() => (window as unknown as W).__dvBridge.npc.setAuthHeader('PlayToken e2e'));
    await page.evaluate(() => (window as unknown as W).__dvBridge.npc.open('npc_test'));
    await page.getByTestId('dialogue-intent-greet').click();
    await expect(page.getByTestId('dialogue-line')).toHaveText(INK_GREETING);
    await expect(page.getByTestId('dialogue-ai-badge')).toBeVisible();
    await expect(page.getByTestId('dialogue-panel')).toHaveAttribute('data-fallback', '1');
    // no error dialog, error toast or alert anywhere
    await expect(page.getByTestId('toast-error')).toHaveCount(0);
    await expect(page.getByTestId('toast-warning')).toHaveCount(0);
    await expect(page.getByTestId('dialog')).toHaveCount(0);
    await expect(page.locator('[role="alertdialog"], [role="alert"]')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as W).__dvBridge.npc.telemetry().filter((e) => e.name === 'npc.turn.client' && e.props['fallback'] === true).length))
      .toBeGreaterThan(0);
    // and the report control stays away from an ink line
    await expect(page.getByTestId('dialogue-report')).toHaveCount(0);
    expect(errors.filter((e) => !/Failed to load resource|net::ERR/.test(e))).toEqual([]);
  });
});

test.describe('dialogue panel a11y @ui-a11y', () => {
  test.describe.configure({ timeout: 300_000 });
  test.use({ storageState: NO_BYPASS, locale: 'en-US', reducedMotion: 'reduce' });

  test('AC-7: at 150 % UI scale on a 360 px viewport with reduced motion, nothing is clipped, targets are 44 px, focus runs speaker, line, choices, close, Esc closes, and axe finds nothing serious @ui-a11y', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(HOME);
    await passGates(page);
    await waitForEngineReady(page);
    await page.waitForFunction(() => (window as unknown as W).__dvBridge.npc !== undefined, undefined, { timeout: 60_000 });
    // the player's own setting: Settings > Accessibility > UI scale 150 %
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-cat-accessibility').click();
    await page.getByTestId('slider-a11y-uiscale').evaluate((el) => {
      (el as HTMLInputElement).value = '1.5';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('html')).toHaveCSS('font-size', '24px');
    // reduced motion: the browser asks for it, and the player's own switch is on (a new profile adopts the browser's setting; this one may predate it)
    const motion = page.getByTestId('toggle-a11y-motion');
    if ((await motion.getAttribute('aria-checked')) !== 'true') await motion.click();
    await expect(motion).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');

    await page.evaluate(() => (window as unknown as W).__dvBridge.npc.open('npc_test'));
    const panel = page.getByTestId('dialogue-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true', { timeout: 60_000 });

    // the panel fits the viewport: no horizontal overflow, every control inside it, none clipped
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360 + 0.5);
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const small = await panel.evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>('button, input')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.dataset['testid'] ?? el.tagName, w: r.width, h: r.height, right: r.right, left: r.left };
        })
        .filter((c) => c.w < 44 || c.h < 44 || c.right > 360.5 || c.left < -0.5),
    );
    expect(small).toEqual([]);
    // no transition on the panel runs longer than 150 ms
    const slow = await panel.evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>('*')]
        .map((el) => getComputedStyle(el).transitionDuration.split(',').map((d) => parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000)))
        .flat()
        .filter((ms) => ms > 150),
    );
    expect(slow).toEqual([]);

    // focus order from the speaker: line, then the choices in order, then the field, then Close
    await expect(page.getByTestId('dialogue-speaker')).toBeFocused();
    const order: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['testid'] ?? '');
      if (id !== '') order.push(id);
      if (id === 'dialogue-close') break;
    }
    expect(order).toEqual(['dialogue-line', 'dialogue-intent-greet', 'dialogue-intent-smalltalk', 'dialogue-intent-trade', 'dialogue-intent-compliment', 'dialogue-intent-farewell', 'dialogue-input', 'dialogue-send', 'dialogue-close']);

    const result = await new AxeBuilder({ page }).include('[data-testid="dialogue-panel"]').analyze();
    const bad = result.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(bad.map((v) => `${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
});
