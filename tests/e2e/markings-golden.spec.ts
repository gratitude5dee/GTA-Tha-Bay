import { expect, test } from '@playwright/test';
import { MARKINGS_GOLDEN_DIR, MARKINGS_GOLDEN_UPDATE, markingsGoldens, registerMarkingsGoldenShots } from './markings-golden-helpers.ts';
import { MARKINGS_GOLDEN_SHOTS, PAINT_TIERS, bakeIdOf, read } from './markings-helpers.ts';

/**
 * M02h1 AC-5 (@markings-golden, `chromium-webgl2` only): the shots `markings-near` and `markings-graze` at `desktop`, `mobile-low` and
 * `xr-quest` (the Quest tier forced on the flat canvas, no immersive session) against the committed goldens, each repeated byte-identical.
 * The goldens sit in `tests/e2e/golden/look/` with the other look goldens and are listed in its manifest. This file holds the manifest case
 * and the `mobile-low` and `xr-quest` shots; the two `desktop` shots are `markings-shots-desktop.spec.ts` (BD-REPAIR-M02h1-02: a shard
 * placement, see `markings-golden-helpers.ts`). The flicker of the `markings-graze` pair is `art-markings-flicker-desktop.spec.ts` and
 * `markings-flicker-low.spec.ts`.
 *
 * `DV_UPDATE_GOLDEN=1` (outside CI, under the golden-update label) writes the goldens and the manifest.
 */
markingsGoldens(() => {
  test('the manifest lists the six markings goldens and names the current synth bake @markings-golden', () => {
    if (MARKINGS_GOLDEN_UPDATE) return;
    const manifest = read<{ bakeId: string; shots: string[] }>(`${MARKINGS_GOLDEN_DIR}/manifest.json`);
    expect(manifest.bakeId, `look golden from bake ${manifest.bakeId}, current bake ${bakeIdOf()}`).toBe(bakeIdOf());
    for (const tier of PAINT_TIERS) for (const shot of MARKINGS_GOLDEN_SHOTS) expect(manifest.shots).toContain(`${tier}.${shot}.png`);
  });

  for (const tier of PAINT_TIERS) if (tier !== 'desktop') registerMarkingsGoldenShots(tier);
});
