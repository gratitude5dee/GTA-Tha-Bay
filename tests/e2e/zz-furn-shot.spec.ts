import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { bootWorld, frames, setSky, world } from './markings-helpers.ts';

for (const tier of (process.env['ZZ_TIERS'] ?? 'desktop').split(',')) {
  test(`zz furniture shot ${tier} @zz-furn`, async ({ page }) => {
    test.setTimeout(1_200_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await bootWorld(page, tier, '', { width: 960, height: 540 });
    await setSky(page, 13, 'clear');
    for (const shot of (process.env['ZZ_SHOTS'] ?? 'junction-noon').split(',')) {
      await world(page, (w) => w.shot(shot as never));
      await frames(page, 6);
      mkdirSync('test-results/zz', { recursive: true });
      writeFileSync(`test-results/zz/${tier}.${shot}.png`, await page.locator('#dv-engine-canvas').screenshot());
      console.log(shot, JSON.stringify(await world(page, (w) => { const f = w.look()?.furniture; return f ? { ...f, parked: { ...f.parked, drawn: undefined } } : null; })));
    }
    console.log('errors', JSON.stringify(errors.slice(0, 10)));
  });
}
