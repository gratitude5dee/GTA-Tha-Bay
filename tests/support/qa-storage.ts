/**
 * The shared page fixture of the e2e suites (M11a1, DL-756): the browser storage every Playwright page starts with.
 *
 * - `dv-qa-play=sandbox` is the QA play bypass (M04b1, DL-650): every spec loads straight into play.
 * - `dv-qa-governor=off` (M11a1) keeps the runtime quality governor off on every page the fixture opens, perf-scenario pages included,
 *   unless the test sets its own `governor` flag in the URL (`?governor=on`, the `@governor` specs). Look goldens, render-object ledgers
 *   and perf counts never follow CI frame times: SwiftShader frames are slow, and a governor that reacted to them would move the
 *   knobs under the shot. The flag parser reads the key only in a QA build; the URL wins over it.
 *
 * - `dv-qa-post=2` (M02h8, BD-M02h8-02) holds the post stack of every page the fixture opens at level 2, the tier's own `post` list:
 *   `look.json` `postLevelCap` is 3 since M02h8, which puts TRAA on `desktop`, and a TRAA picture never stands still (two consecutive
 *   captures of a held shot differ on 1 to 2 % of the pixels), so the look goldens, the flicker pairs and the ledgers are taken at
 *   level 2, as before M02h8. A spec opts into the build's own cap with `?post=3` (`@look-traa`). The key is read only in a QA build; the
 *   URL wins over it, and it can only lower the cap.
 *
 * `playwright.config.ts` and `playwright.perf.config.ts` take their `storageState` from here, so a spec that opens a page through the
 * default `page` fixture gets the keys without importing anything. A spec that replaces the state (the gate specs, which run at the
 * title) gets none, and its governor is on.
 */
export const QA_STORAGE_KEYS = {
  play: 'dv-qa-play',
  governor: 'dv-qa-governor',
  post: 'dv-qa-post',
} as const;

/** The post level the fixture holds every page at (M02h8): the tier's `post` list, no TRAA on `desktop`. */
export const QA_POST_LEVEL = '2';

/** The `localStorage` rows of the fixture, for one origin. */
export function qaLocalStorage(play: 'sandbox' | 'story' | 'off' = 'sandbox', governor: 'off' | 'on' | null = 'off'): { name: string; value: string }[] {
  return [
    { name: QA_STORAGE_KEYS.play, value: play },
    ...(governor === null ? [] : [{ name: QA_STORAGE_KEYS.governor, value: governor }]),
    { name: QA_STORAGE_KEYS.post, value: QA_POST_LEVEL },
  ];
}

/** The Playwright `storageState` of the fixture for a server on `port`. */
export function qaStorageState(port: number): { cookies: []; origins: { origin: string; localStorage: { name: string; value: string }[] }[] } {
  return { cookies: [], origins: [{ origin: `http://localhost:${port}`, localStorage: qaLocalStorage() }] };
}
