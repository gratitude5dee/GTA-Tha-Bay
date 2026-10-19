import { expect, test, type Page, type Route } from '@playwright/test';
import { DISPLAY_NAME } from '../../config/brand.ts';

/**
 * The /account/ island (M00e, AC-8). The Worker is real (redirect, headers, route 66); the sign-in routes are answered in the browser
 * with Playwright, so no test reaches the Supabase project.
 */
const GAME_BUNDLE = /rapier|three\.|sim\.worker|asset\.worker|renderer-host|tier-config|\/assets\/main-/;

const SESSION = { user: { id: 'u1', username: 'pilot' }, session: { accessToken: 'at-test-1', expiresIn: 3600 } };
const err = (code: string, status: number, details?: Record<string, unknown>) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({ error: { code, message: 'x', requestId: 'r', ...(details ? { details } : {}) } }),
});

interface Stubs {
  signedIn: boolean;
  signupBodies: unknown[];
  loginBodies: unknown[];
  deleted: boolean;
}

async function stubAuth(page: Page, opts: { create: boolean; signedIn?: boolean }): Promise<Stubs> {
  const s: Stubs = { signedIn: opts.signedIn ?? false, signupBodies: [], loginBodies: [], deleted: false };
  await page.route('**/api/v1/boot', async (route: Route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { flags: Record<string, boolean> };
    body.flags['auth.password'] = opts.create;
    await route.fulfill({ response: res, body: JSON.stringify(body) });
  });
  await page.route('**/api/v1/auth/refresh', (route) =>
    s.signedIn ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }) : route.fulfill(err('unauthorized', 401)),
  );
  await page.route('**/api/v1/auth/signup', (route) => {
    s.signupBodies.push(route.request().postDataJSON());
    s.signedIn = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) });
  });
  await page.route('**/api/v1/auth/login', (route) => {
    s.loginBodies.push(route.request().postDataJSON());
    s.signedIn = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) });
  });
  await page.route('**/api/v1/auth/logout', (route) => {
    s.signedIn = false;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.route('**/api/v1/auth/me', (route) => {
    if (route.request().method() === 'DELETE') {
      s.deleted = true;
      s.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: SESSION.user }) });
  });
  return s;
}

async function fillDate(page: Page, month: string, day: string, year: string): Promise<void> {
  await page.getByTestId('age-month').fill(month);
  await page.getByTestId('age-day').fill(day);
  await page.getByTestId('age-year').fill(year);
  await page.getByTestId('age-continue').click();
}

test.describe('account island @account', () => {
  test.setTimeout(90_000);

  test('/account redirects to /account/, is not isolated, has no canvas or game bundle; back to title is isolated @account', async ({ page, request }) => {
    const res = await request.get('/account', { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers()['location']).toMatch(/\/account\/$/);
    expect(res.headers()['cross-origin-embedder-policy']).toBeUndefined();

    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));
    for (const path of ['/account', '/account/']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/account\/$/);
      await expect(page.getByTestId('account')).toBeVisible();
      expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(false);
      expect(await page.locator('canvas').count()).toBe(0);
    }
    expect(requested.filter((u) => GAME_BUNDLE.test(u))).toEqual([]);

    await page.getByTestId('account-back').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('title-name')).toHaveText(DISPLAY_NAME);
    expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
  });

  test('the title link is a full navigation to /account/ @account', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('title-account').click();
    await expect(page).toHaveURL(/\/account\/$/);
    expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(false);
  });

  test('an under-18 date blocks the device: no form, also after a reload @account', async ({ page }) => {
    await stubAuth(page, { create: true });
    await page.goto('/account/');
    await page.getByTestId('account-signup').click();
    await page.getByTestId('account-username').fill('newbie');
    await page.getByTestId('account-password').fill('a-long-password');
    await page.getByTestId('account-continue').click();
    await fillDate(page, '6', '1', '2015');
    await expect(page.getByTestId('account-blocked')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('dv-ui-ageBlocked'))).toBe('1');
    await page.reload();
    await expect(page.getByTestId('account-blocked')).toBeVisible();
    await expect(page.getByTestId('account-username')).toHaveCount(0);
  });

  test('an adult creates an account after reading the terms; no token is stored in the browser @account', async ({ page }) => {
    const stubs = await stubAuth(page, { create: true });
    await page.addInitScript(() => localStorage.setItem('dv-session', '{"session":{"accessToken":"legacy","refreshToken":"legacy"}}'));
    await page.goto('/account/');
    await page.getByTestId('account-signup').click();
    await expect(page.getByTestId('account-password')).toHaveAttribute('minlength', '8');
    await expect(page.getByTestId('account-password')).toHaveAttribute('autocomplete', 'new-password');
    await page.getByTestId('account-username').fill('newbie');
    await page.getByTestId('account-password').fill('a-long-password');
    await page.getByTestId('account-continue').click();

    // Three empty fields and no text that states a threshold.
    for (const f of ['month', 'day', 'year']) await expect(page.getByTestId(`age-${f}`)).toHaveValue('');
    await expect(page.getByTestId('account-age')).not.toContainText(/18|adult|older/i);
    await fillDate(page, '2', '30', '1990');
    await expect(page.getByTestId('age-invalid')).toHaveText('Enter a valid date');
    await fillDate(page, '2', '28', '1990');

    await expect(page.getByTestId('doc-terms')).toBeVisible();
    await expect(page.getByTestId('doc-privacy')).toBeVisible();
    await expect(page.getByTestId('account-terms')).toContainText(DISPLAY_NAME);
    await page.getByTestId('account-agree').click();
    await expect(page.getByTestId('account-signed-in')).toHaveText('Signed in as pilot');
    expect(stubs.signupBodies).toEqual([{ username: 'newbie', password: 'a-long-password', ageBracket: '18p', termsVersion: 'interim-1' }]);

    const stored = await page.evaluate(() => ({
      local: JSON.stringify({ ...localStorage }),
      session: JSON.stringify({ ...sessionStorage }),
      cookie: document.cookie,
    }));
    expect(stored.local).not.toMatch(/at-test-1|legacy|dv-session/);
    expect(stored.session).not.toContain('at-test-1');
    expect(stored.cookie).not.toContain('dv-rt');
  });

  test('sign-in asks for the age and terms again on terms_required, and sign-out returns to the form @account', async ({ page }) => {
    const stubs = await stubAuth(page, { create: false });
    let first = true;
    await page.route('**/api/v1/auth/login', (route) => {
      stubs.loginBodies.push(route.request().postDataJSON());
      if (first) {
        first = false;
        return route.fulfill(err('forbidden', 403, { reason: 'terms_required', termsVersion: 'interim-1' }));
      }
      stubs.signedIn = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) });
    });
    await page.goto('/account/');
    // The create button is hidden while flags['auth.password'] is false; sign-in still works.
    await expect(page.getByTestId('account-signup')).toHaveCount(0);
    await page.getByTestId('account-username').fill('pilot');
    await page.getByTestId('account-password').fill('old-pass');
    await page.getByTestId('account-login').click();
    await fillDate(page, '3', '3', '1985');
    await page.getByTestId('account-agree').click();
    await expect(page.getByTestId('account-signed-in')).toBeVisible();
    expect(stubs.loginBodies).toEqual([
      { username: 'pilot', password: 'old-pass' },
      { username: 'pilot', password: 'old-pass', ageBracket: '18p', termsVersion: 'interim-1' },
    ]);
    await page.getByTestId('account-signout').click();
    await expect(page.getByTestId('account-login')).toBeVisible();
  });

  test('delete needs the typed username and then returns to the sign-in form @account', async ({ page }) => {
    const stubs = await stubAuth(page, { create: false, signedIn: true });
    await page.goto('/account/');
    await expect(page.getByTestId('account-signed-in')).toHaveText('Signed in as pilot');
    await page.getByTestId('account-delete').click();
    const go = page.getByTestId('account-delete-go');
    await expect(go).toBeDisabled();
    await page.getByTestId('account-delete-confirm').fill('pil');
    await expect(go).toBeDisabled();
    await page.getByTestId('account-delete-confirm').fill('pilot');
    await expect(go).toBeEnabled();
    await go.click();
    await expect(page.getByTestId('account-notice')).toBeVisible();
    expect(stubs.deleted).toBe(true);
    await expect(page.getByTestId('account-login')).toBeVisible();
  });

  test('delete shows the privacy contact when the Worker answers feature_disabled @account', async ({ page }) => {
    await stubAuth(page, { create: false, signedIn: true });
    await page.route('**/api/v1/auth/me', (route) =>
      route.request().method() === 'DELETE' ? route.fulfill(err('feature_disabled', 404)) : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: SESSION.user }) }),
    );
    await page.goto('/account/');
    await page.getByTestId('account-delete').click();
    await page.getByTestId('account-delete-confirm').fill('pilot');
    await page.getByTestId('account-delete-go').click();
    await expect(page.getByTestId('account-note')).toContainText('Self-service deletion is not available yet');
    await expect(page.getByTestId('account-note')).toContainText('contact');
  });
});
