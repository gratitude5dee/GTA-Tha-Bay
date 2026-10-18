/**
 * QA page (built only when VITE_DV_QA=1): runs the shared golden vectors and the 10,000-tick `physics-drop` scenario
 * (canonical profile) inside sim.worker, prints the result and publishes it on `window.__dvBridge.engine.qa`.
 * The Playwright test `@determinism` compares the checkpoints with packages/engine/test/golden/determinism.physics-drop.json.
 */
import { spawnSimWorker } from '@dv/engine/client/boot/spawn-worker';
import { installQaBridge } from '@dv/engine/client/debug/bridge';

interface DeterminismData {
  vectors: { total: number; mismatches: number; first: string | null };
  checkpoints: Record<string, string>;
  final: string;
  physicsBuild: string;
  runMs: number;
  initMs: number;
}

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
  if (m.p.name === 'progress') {
    const p = m.p.data as { stage: string; done: number; total: number };
    print(`${p.stage} ${p.done}/${p.total}`);
  } else if (m.p.name === 'determinism') {
    const d = m.p.data as DeterminismData;
    print(
      [
        `vectors ${d.vectors.mismatches} mismatches of ${d.vectors.total}${d.vectors.first ? ` (first: ${d.vectors.first})` : ''}`,
        `physics build ${d.physicsBuild}`,
        `checkpoints ${Object.keys(d.checkpoints).length}`,
        `final hash ${d.final}`,
        `init ${d.initMs.toFixed(0)} ms, run ${d.runMs.toFixed(0)} ms`,
      ].join('\n'),
    );
    document.documentElement.dataset.dvDeterminism = 'done';
  }
});
worker.addEventListener('error', (ev) => {
  const message = ev && typeof ev === 'object' && 'message' in ev ? String((ev as { message: unknown }).message) : 'worker error';
  results['error'] = message;
  print(`error: ${message}`);
});

worker.postMessage({
  v: 1,
  t: 'init',
  seq: 0,
  p: {
    cfg: { seed: 0xc0ffee, profile: 'canonical', physicsBuild: 'deterministic-compat', tier: 'mobile-low', worldBake: 'physics-drop', hashEvery: 0 },
    boot: { strings: [], prefabs: [], config: { mode: 'determinism' } },
    transport: 'postMessage',
    sab: null,
    qa: true,
  },
});
