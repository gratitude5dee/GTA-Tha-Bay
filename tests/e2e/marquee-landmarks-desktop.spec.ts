import { test } from '@playwright/test';
import { twelveResident } from './world-landmarks-helpers.ts';

/**
 * The twelve hero landmarks of M02d1 at desktop (`world-landmarks.spec.ts` holds the other tiers, `tour-landmarks-desktop.spec.ts` the
 * other desktop cases). About 22 minutes on CI's software GL after M10d1's art: the longest landmark case, so it has a file of its own
 * whose name sorts into a light shard (BD-FIX-CI-SHARD6-01). Title, describe and tags are unchanged.
 */

test.describe('landmarks @world', () => {
  test.describe.configure({ timeout: 1_800_000 });

  test('each of the twelve landmarks becomes resident at desktop, within its triangle budget @world-landmarks', async ({ page }) => {
    await twelveResident(page, 'desktop');
  });
});
