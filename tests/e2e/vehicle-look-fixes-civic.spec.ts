import { registerFlickerPair } from './look-fixes-helpers.ts';

/**
 * M02g2 AC-6, `@look-fixes`: the `civic-hall-graze` shot pair at `desktop`. One case, in its own file (BD-REPAIR-M02g2-03): see
 * `street-look-fixes-junction.spec.ts` and `look-fixes-helpers.ts`.
 *
 * The `vehicle-` prefix is a shard placement, not a subject (BD-REPAIR-M02h1-02): this was `look-fixes-civic.spec.ts`, which sorted into
 * chromium-webgl2 shard 3 beside `look-tune.spec.ts` and the `desktop` markings pair, and that shard ran out its 60 minutes (run
 * 41150362555). A shard is cut from the sorted file names by test count, so this name puts the case into shard 7; BD-REPAIR-M02h1-01
 * shortens it (the first shot settles with the world's draw held).
 */
registerFlickerPair('civic-hall-graze');
