import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * BD-FIX-TMP-01 (@tmp-root): a Playwright worker inherits the per-run temporary root that playwright.config.ts made, so a spec's
 * mkdtemp lands inside it and the runner's exit removes it. No page is opened.
 */
test('a spec temp folder lands inside the per-run root @tmp-root', () => {
  const root = process.env.DV_TEST_TMP_ROOT;
  expect(root).toBeTruthy();
  expect(path.basename(root as string)).toMatch(/^dv-[a-z0-9]+-\d+-[A-Za-z0-9]{6}$/);
  expect(tmpdir()).toBe(root);
  const dir = mkdtempSync(path.join(tmpdir(), 'dv-e2e-probe-'));
  try {
    expect(path.dirname(dir)).toBe(root);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
