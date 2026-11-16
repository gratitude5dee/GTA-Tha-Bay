import { registerMarkingsPair } from './markings-flicker-helpers.ts';

/**
 * M02h1 AC-5, `@markings-golden`: the `markings-graze` pair at `desktop`. One case, in its own file (see `markings-flicker-helpers.ts`).
 *
 * The `street-` prefix is a shard placement (BD-REPAIR-M02h3-03): this was `markings-flicker-desktop.spec.ts` (shard 3, run 41150362555 ran
 * out its 60 minutes), then `art-markings-flicker-desktop.spec.ts` (BD-REPAIR-M02h1-02), which put this 24-minute case into chromium-webgl2
 * shard 1 beside the desktop `art-*`, texture and curb cases: about 46 minutes on base, cancelled at 60 twice on M02h3's slower runners. A
 * shard is cut from the sorted file names by test count, so this name puts the case into shard 6.
 */
registerMarkingsPair('desktop');
