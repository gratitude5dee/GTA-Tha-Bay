import { tmpdir } from 'node:os';
import { TMP_ROOT_ENV, checkTmpRoot } from '../../tools/ci/tmp-root.ts';

/**
 * Playwright globalSetup (BD-FIX-TMP-01): playwright.config.ts made the per-run temporary root at config load (the web server starts
 * before globalSetup) and removes it when the runner exits. This only checks that it is in effect before any worker starts: set, an
 * existing real folder named `dv-<label>-<pid>-XXXXXX` (so an outside value such as /tmp or / never passes), and what os.tmpdir()
 * returns. A config change that drops it fails loudly instead of filling /tmp again.
 */
export default function globalSetup(): void {
  const root = process.env[TMP_ROOT_ENV];
  if (!root) throw new Error(`tmp-root: ${TMP_ROOT_ENV} is not set (playwright.config.ts makes it)`);
  const why = checkTmpRoot(root);
  if (why !== null) throw new Error(`tmp-root: ${TMP_ROOT_ENV}=${root} is not a per-run root: ${why}`);
  if (tmpdir() !== root) throw new Error(`tmp-root: os.tmpdir() is ${tmpdir()}, not the per-run root ${root}`);
}
