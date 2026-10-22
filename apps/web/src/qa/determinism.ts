/**
 * QA page (built only when VITE_DV_QA=1): runs the shared golden vectors, then the 10,000-tick `physics-drop` and
 * `walk-drop` scenarios (canonical profile) inside sim.worker, prints the result and publishes it on
 * `window.__dvBridge.engine.qa`. The Playwright test `@determinism` compares the checkpoints with
 * packages/engine/test/golden/determinism.physics-drop.json and determinism.walk-drop.json.
 */
import type { WorkerLike } from '@dv/engine/sim';
import { installQaBridge } from '@dv/engine/client/debug/bridge';
import type { RunSpec, StateHashTrace } from '@dv/engine/qa';
// The gray-box fixture bytes come from the committed file itself (a Vite `?url` import), never from the asset catalog, so a
// `DV_WORLD=synth` build, whose catalog swaps the p0 pack for a synth tile, still produces the Node trace (M04d, DL-699).
import fixtureP0Url from '../../../../tests/fixtures/world/civic-graybox/p0-64-64.pack?url';
import fixtureHashes from '../../../../tests/fixtures/world/civic-graybox/hashes.json';
// The racing suite's ground: the route corridor of the sprint, committed next to race.json (M07a1, BD-M07a1-04).
import corridorUrl from '../../../../content/races/sf.sprint.ferry-ocean-beach/corridor.bin?url';
// The missions suite's mission: the compiled bundle of the sample, bundled with the page (M05a2).
import { qaMissionBundle } from './missions.ts';

interface DeterminismData {
  vectors: { total: number; mismatches: number; first: string | null };
  checkpoints: Record<string, string>;
  final: string;
  walkDrop: { checkpoints: Record<string, string>; final: string; runMs: number };
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

// The composed worker the game runs (the engine sim plus the world module, DL-651). Its determinism branch builds its own sims before
// and without SimRuntime, so no module touches the checkpoints, with or without a world.

function startDeterminismSuite(): void {
  const worker = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
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
          `walk-drop checkpoints ${Object.keys(d.walkDrop.checkpoints).length}, final hash ${d.walkDrop.final}, run ${d.walkDrop.runMs.toFixed(0)} ms`,
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
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * One canonical run (M04d): the spec goes to a fresh sim.worker, which builds its own sims with the runner and answers with the
 * `StateHashTrace`. `?run=<base64url RunSpec>` runs one at load; `__dvBridge.engine.qa.run(spec)` runs any number afterwards.
 */
async function runSpec(spec: RunSpec): Promise<StateHashTrace> {
  const bytes = new Uint8Array(await (await fetch(fixtureP0Url)).arrayBuffer());
  const corridor = spec.suite === 'racing' ? new Uint8Array(await (await fetch(corridorUrl)).arrayBuffer()) : null;
  const bundle = spec.suite === 'missions' ? qaMissionBundle(spec.scenario) : null;
  if (spec.suite === 'missions' && !bundle) throw new Error(`the page has no bundle for mission ${spec.scenario}`);
  const mission = bundle ? new TextEncoder().encode(JSON.stringify(bundle)) : null;
  const w = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
  return new Promise<StateHashTrace>((resolve, reject) => {
    w.addEventListener('message', (ev) => {
      const m = ev.data as { t?: string; p?: { name: string; data: unknown } } | null;
      if (!m || m.t !== 'qa' || !m.p) return;
      if (m.p.name === 'trace') {
        w.terminate();
        resolve(m.p.data as StateHashTrace);
      } else if (m.p.name === 'trace-error') {
        w.terminate();
        reject(new Error(String(m.p.data)));
      }
    });
    w.addEventListener('error', (ev) => reject(new Error(ev && typeof ev === 'object' && 'message' in ev ? String((ev as { message: unknown }).message) : 'worker error')));
    w.postMessage({
      v: 1,
      t: 'init',
      seq: 0,
      p: {
        cfg: { seed: spec.seed, profile: 'canonical', physicsBuild: 'deterministic-compat', tier: 'mobile-low', worldBake: 'walk-drive', hashEvery: 0 },
        boot: { strings: [], prefabs: [], config: { mode: 'qa-run', run: spec, packs: { p0: bytes.buffer, ...(corridor ? { corridor: corridor.buffer } : {}), ...(mission ? { mission: mission.buffer } : {}) }, hashes: fixtureHashes } },
        transport: 'postMessage',
        sab: null,
        qa: true,
      },
    });
  });
}

results['run'] = runSpec;

const runParam = new URLSearchParams(location.search).get('run');
if (runParam) {
  print('running the spec');
  void (async () => {
    try {
      const spec = JSON.parse(fromBase64Url(runParam)) as RunSpec;
      results['trace'] = await runSpec(spec);
      const t = results['trace'] as StateHashTrace;
      print(`${spec.suite}/${spec.scenario}: ${t.checkpoints.length} checkpoints, end ${t.end.tick} ${t.end.hash} (${t.end.outcome})`);
    } catch (e) {
      results['error'] = e instanceof Error ? e.message : String(e);
      print(`error: ${String(results['error'])}`);
    }
    document.documentElement.dataset.dvQaRun = 'done';
  })();
} else {
  startDeterminismSuite();
}
