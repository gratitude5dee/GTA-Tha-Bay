import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { encodePng, decodePng } from '../support/image-diff.ts';
import { HIDE, bootWorld, clearActors, frames, setSky, type W } from './markings-helpers.ts';

const OUT = '/tmp/claude-0/scratch/shots';
for (const tier of ['mobile-low', 'xr-quest', 'desktop']) {
  test(`look ${tier} zz`, async ({ page }) => {
    test.setTimeout(3_000_000);
    mkdirSync(OUT, { recursive: true });
    await bootWorld(page, tier, '', { width: 640, height: 360 });
    await page.addStyleTag({ content: HIDE });
    await clearActors(page);
    await setSky(page, 13, 'clear');
    for (const shot of ['markings-near', 'markings-graze']) {
      await page.evaluate((id) => (window as unknown as W).__dvBridge.world.shot(id), shot);
      await frames(page, 2);
      writeFileSync(`${OUT}/${tier}.${shot}.png`, encodePng(decodePng(await page.locator('#dv-engine-canvas').screenshot())));
    }
  });
}
