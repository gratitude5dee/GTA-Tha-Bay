import { registerFlickerPair } from './look-fixes-helpers.ts';

/**
 * M02g2 AC-6, `@look-fixes`: the `junction-graze` shot pair at `desktop`. One case, in its own file (BD-REPAIR-M02g2-03): a `desktop` pair
 * is the longest single case of the suite, and a shard is cut out of the sorted file names by test count, so each `desktop` pair has a file
 * whose name sorts it into a shard of its own (see `world-sky-look-fixes.spec.ts`, `look-fixes-helpers.ts`).
 */
registerFlickerPair('junction-graze');
