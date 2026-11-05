import { markingsGoldens, registerMarkingsGoldenShots } from './markings-golden-helpers.ts';

/**
 * M02h1 AC-5 (@markings-golden, `chromium-webgl2` only): the `desktop` shots `markings-near` and `markings-graze` against their goldens, each
 * repeated byte-identical. The same two cases `markings-golden.spec.ts` registered before BD-REPAIR-M02h1-02, in a file of their own: each
 * takes about 14 minutes on software GL, and this name sorts them after `markings-ledger.spec.ts`, into a light shard, instead of next to
 * `look-tune.spec.ts` (see `markings-golden-helpers.ts`).
 */
markingsGoldens(() => {
  registerMarkingsGoldenShots('desktop');
});
