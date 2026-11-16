/**
 * The shared page fixture of the e2e suites (M11a1, DL-756): the browser storage every Playwright page starts with.
 *
 * - `dv-qa-play=sandbox` is the QA play bypass (M04b1, DL-650): every spec loads straight into play.
 * - `dv-qa-governor=off` (M11a1) keeps the runtime quality governor off on every page the fixture opens, perf-scenario pages included,
 *   unless the test sets its own `governor` flag in the URL (`?governor=on`, the `@governor` specs). Look goldens, render-object ledgers
 *   and perf counts never follow CI frame times: SwiftShader frames are slow, and a governor that reacted to them would move the
 *   knobs under the shot. The flag parser reads the key only in a QA build; the URL wins over it.
 *
 * `playwright.config.ts` and `playwright.perf.config.ts` take their `storageState` from here, so a spec that opens a page through the
 * default `page` fixture gets both keys without importing anything. A spec that replaces the state (the gate specs, which run at the
 * title) gets neither, and its governor is on.
 */
export const QA_STORAGE_KEYS = {
  play: 'dv-qa-play',
  governor: 'dv-qa-governor',
} as const;

/** The `localStorage` rows of the fixture, for one origin. */
export function qaLocalStorage(play: 'sandbox' | 'story' | 'off' = 'sandbox', governor: 'off' | 'on' | null = 'off'): { name: string; value: string }[] {
  return [
    { name: QA_STORAGE_KEYS.play, value: play },
    ...(governor === null ? [] : [{ name: QA_STORAGE_KEYS.governor, value: governor }]),
  ];
}

/** The Playwright `storageState` of the fixture for a server on `port`. */
export function qaStorageState(port: number): { cookies: []; origins: { origin: string; localStorage: { name: string; value: string }[] }[] } {
  return { cookies: [], origins: [{ origin: `http://localhost:${port}`, localStorage: qaLocalStorage() }] };
}
