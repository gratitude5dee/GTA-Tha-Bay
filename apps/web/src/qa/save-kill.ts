/**
 * QA page (built only when VITE_DV_QA=1): the kill test of C05 rule 1.
 *  - `?phase=loop` (default): sim.worker opens the SaveService on IndexedDB `dv-saves` and writes the `sandbox` slot of
 *    the profile "kill-test" in a loop. The Playwright test `@save-kill` closes the page while the loop runs.
 *  - `?phase=verify`: sim.worker loads the profile and reports the generation and checksum it found; the main thread
 *    reads the status line with the read-only `readLastSave` and compares. Results are on `__dvBridge.engine.qa`.
 */
import { spawnSimWorker } from '@dv/engine/client/boot/spawn-worker';
import { installQaBridge } from '@dv/engine/client/debug/bridge';
import { readLastSave } from '@dv/engine/client/save-status';
import type { ProfileId } from '@dv/shared';

interface VerifyReport {
  profileId: string;
  persistent: boolean;
  n: number | null;
  gen: number | null;
  checksum: string | null;
  bytes: number | null;
  fellBack: boolean;
  lastSaveError: string | null;
}

const phase = new URLSearchParams(location.search).get('phase') === 'verify' ? 'verify' : 'loop';
const out = document.getElementById('out');
const results: Record<string, unknown> = {};
installQaBridge(() => results);

function print(text: string): void {
  if (out) out.textContent = text;
}

const worker = spawnSimWorker();
worker.addEventListener('message', (ev) => {
  const m = ev.data as { t?: string; p?: { name: string; data: unknown } } | null;
  if (!m || m.t !== 'qa' || !m.p) return;
  results[m.p.name] = m.p.data;
  if (m.p.name === 'save-ready') {
    document.documentElement.dataset.dvSaveKill = 'ready';
    print(`phase loop, profile ready: ${JSON.stringify(m.p.data)}`);
  } else if (m.p.name === 'save-loop') {
    const d = m.p.data as { n: number; gen: number; checksum: string };
    document.documentElement.dataset.dvSaveKill = 'running';
    document.documentElement.dataset.dvSaveGen = String(d.gen);
    print(`phase loop, write ${d.n}: gen ${d.gen}, checksum ${d.checksum}`);
  } else if (m.p.name === 'save-error') {
    document.documentElement.dataset.dvSaveKill = 'error';
    print(`error: ${(m.p.data as { message: string }).message}`);
  } else if (m.p.name === 'save-verify') {
    const d = m.p.data as VerifyReport;
    void readLastSave(d.profileId as ProfileId).then((info) => {
      results['save-main'] = info;
      const match = info !== null && info.gen === d.gen && info.checksum === d.checksum && info.status.ok;
      results['save-match'] = match;
      print(
        [
          `phase verify, worker: loop counter ${String(d.n)}, gen ${String(d.gen)}, checksum ${String(d.checksum)}, fell back ${String(d.fellBack)}, error ${String(d.lastSaveError)}`,
          `main thread status line: ${info ? `gen ${info.gen}, checksum ${info.checksum}, ok ${String(info.status.ok)}` : 'none'}`,
          `match: ${String(match)}`,
        ].join('\n'),
      );
      document.documentElement.dataset.dvSaveKill = 'done';
    });
  }
});
worker.addEventListener('error', (ev) => {
  const message = ev && typeof ev === 'object' && 'message' in ev ? String((ev as { message: unknown }).message) : 'worker error';
  results['error'] = message;
  document.documentElement.dataset.dvSaveKill = 'error';
  print(`error: ${message}`);
});

worker.postMessage({
  v: 1,
  t: 'init',
  seq: 0,
  p: {
    cfg: { seed: 0xc0ffee, profile: 'canonical', physicsBuild: 'deterministic-compat', tier: 'mobile-low', worldBake: 'physics-drop', hashEvery: 0 },
    boot: { strings: [], prefabs: [], config: { mode: 'save-kill', phase } },
    transport: 'postMessage',
    sab: null,
    qa: true,
  },
});
