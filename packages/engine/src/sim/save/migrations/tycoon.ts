import type { MigrateStep } from '../migrate.ts';

/**
 * Migration table of the `mode:tycoon` slice (C05 rule 5; 08-tycoon.md section 4.6, point 4). `steps[n]` migrates schema n to n + 1.
 * Schema 1 is the first, so the table is empty; a v2 adds `2: (old) => ...` here together with `__golden__/tycoon/v2.json`.
 * The golden file `__golden__/tycoon/v1.json` is the slice a 300-week fixture run saves; `packages/modes/tycoon/test/tycoon.save.spec.ts`
 * checks the build against it.
 */
export const TYCOON_MIGRATIONS: Record<number, MigrateStep> = {};
