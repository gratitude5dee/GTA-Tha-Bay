/**
 * Guard of one per-run temporary root (BD-FIX-TMP-01 part 3; started by `enterTmpRoot` in tools/ci/tmp-root.ts).
 *
 * Usage: node --experimental-strip-types tools/ci/tmp-root-guard.ts <root> <parent>, stdin a pipe whose write end only the creator of
 * the root holds. It runs detached, in a session of its own, so Ctrl-C (SIGINT to the terminal's process group) and a SIGKILL of that
 * group do not reach it. It waits for stdin to close: the creator either released it after removing the root, or died without cleaning
 * up (SIGKILLed by tsx's signal relay when its acknowledgement came too late, `kill -9`, an OOM kill). Either way it then waits for the
 * processes still working in the root to stop (`drainRoot`: SIGTERM after the grace period, SIGKILL 2 s later), removes the root
 * through `removeTmpRoot` and its guards (a no-op when it is already gone), and exits. It writes nothing; stdout and stderr are ignored.
 */
import { drainRoot, removeTmpRoot } from './tmp-root.ts';

const [root, parent] = process.argv.slice(2);
if (!root || !parent) process.exit(2);

let ended = false;
const finish = (): void => {
  if (ended) return;
  ended = true;
  void drainRoot(root, { name: 'tmp-root guard' })
    .catch(() => {})
    .then(() => {
      try {
        removeTmpRoot(root, parent);
      } catch {
        // Not a per-run root after all, or not removable: the next run's sweep reports it.
      }
      process.exit(0);
    });
};
process.stdin.on('data', () => {});
process.stdin.on('end', finish);
process.stdin.on('close', finish);
process.stdin.on('error', finish);
process.stdin.resume();
