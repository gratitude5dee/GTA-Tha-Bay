import { registerFlickerPair } from './look-fixes-helpers.ts';

/**
 * M02g2 AC-6, `@look-fixes`: the `civic-hall-graze` shot pair at `desktop`. One case, in its own file (BD-REPAIR-M02g2-03): see
 * `street-look-fixes-junction.spec.ts` and `look-fixes-helpers.ts`.
 *
 * The `vehicle-` prefix is a shard placement, not a subject (BD-FIX-CI-SHARD3-01): this was `look-fixes-civic.spec.ts`, which sorted into
 * chromium-webgl2 shard 3 beside `look-tune.spec.ts` and the `desktop` markings pair, and that shard ran out its 60 minutes (run
 * 41150362555). A shard is cut from the sorted file names by test count, so this name puts the 38-minute case into shard 7, the lightest one.
 */
registerFlickerPair('civic-hall-graze');
