import { expect, test, type Page } from '@playwright/test';
import type { NpcBridge } from '../../packages/npc/src/debug/overlay.ts';
import { SMALL_VIEWPORT, waitForEngine } from './engine-helpers.ts';

/**
 * M06a3 @npc-dialogue: the NPC debug panel in the default QA scene, in a real browser (Chromium and WebKit).
 *
 *  - the panel "Talk to npc_test (QA)" is on screen; with no play token the Greet button gives the NPC's ink line, no error;
 *  - with a play token (set through the QA bridge) and the Worker mocked at the network, the stream is read by the real client: the line
 *    appears, the AI badge shows, and the panel says whether the answer was recorded or live;
 *  - one of the four offline ApiError codes (budget_offline) and a kill (kill_switched, which also re-reads the roster flags) continue in ink.
 * The Worker side is proved by `pnpm check:workers -- npc`; the Worker is mocked here (page.route) so the test does not depend on secrets.
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
    expect(talkCalls).toBe(0);

    // A play token: the stream is read and shown, with the badge and the honest source label.
    await page.evaluate(() => (window as unknown as W).__dvBridge.npc.setAuthHeader('PlayToken e2e'));
    await page.getByTestId('npc-smalltalk').click();
    await expect(page.getByTestId('npc-line')).toHaveText(LINE);
    await expect(page.getByTestId('npc-ai-badge')).toBeVisible();
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
    await expect(page.getByTestId('npc-ai-badge')).toBeVisible();
    await expect(page.getByTestId('npc-meta')).toContainText('recorded in this browser');
    const turn = await page.evaluate(() => (window as unknown as W).__dvBridge.npc.last());
    expect(turn).toMatchObject({ source: 'llm', mode: 'local-fixture', aiCharacter: true });
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
