import { registerMarkingsPair } from './markings-flicker-helpers.ts';

/**
 * M02h1 AC-5, `@markings-golden`: the `markings-graze` pair at `desktop`. One case, in its own file (see `markings-flicker-helpers.ts`).
 *
 * The `art-` prefix is a shard placement, not a subject (BD-REPAIR-M02h1-02): this was `markings-flicker-desktop.spec.ts`, which sorted
 * into chromium-webgl2 shard 3 beside `look-fixes-civic` and `look-tune.spec.ts`, and that shard ran out its 60 minutes (run 41150362555).
 * A shard is cut from the sorted file names by test count, so this name puts the case into shard 1, which holds the short `art-*` cases.
 */
registerMarkingsPair('desktop');
