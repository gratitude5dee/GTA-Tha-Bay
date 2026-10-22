/**
 * check:missions (M05a2; 03-story-missions.md C9, 13-qa.md 3.1). Compiles the missions in memory (`missions:build` without writing),
 * then runs each mission x its 3 seeds x 2 runs on the canonical runner with the `story.autoplayer` bot and
 * `flags {beats: 'instant', talk: 'scripted', hooks: 'bot'}` and `maxTicks = expectedSec[1] x 60 x 1.5`. It fails when
 *   compile_error  the compiler reports anything,
 *   world_missing  the world the mission was authored against is not available,
 *   not_passed     a run ends in anything but a pass (the message names the outcome and the objective it was stuck on),
 *   out_of_band    `elapsedSec` (the mission clock) is outside `expectedSec`,
 *   hash_mismatch  the two runs of a seed end with different state hashes,
 *   golden_mismatch the det run of a seed that has a Node golden (`GOLDEN_SEEDS`) differs from `tests/golden/missions/<id>.<seed>.json`.
 * A story mission of the `sf` world (`m.a<act>.<nn>`, M05c1) runs in the `missions-sf` suite on the finished sf bake in `dist/world`
 * (`pnpm map:build -- --area sf`); without the bake it is skipped with a SKIP line, and `DV_REQUIRE_BAKE=1` makes that a `world_missing` failure.
 * It writes `test-results/missions/<id>.<seed>.{json,dvtl}` (the first run of the seed) and prints a summary table.
 *
 *   tsx tools/ci/missions/check.ts [--mission <id>] [--act <n>]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { UnlockDef } from '../../../packages/shared/src/index.ts';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createCanonicalRunner, type RunSpec, type StateHashTrace } from '../../../packages/engine/src/qa/runner.ts';
import { checkGolden } from '../../../packages/engine/src/qa/golden.ts';
import { readFixturePacks } from '../../../packages/engine/src/qa/node.ts';
import { GOLDEN_SEEDS, encodeBundle, registerStoryQa, missionDetSpec, missionSpec, type MissionBundle, type MissionsHandle } from '../../../packages/modes/story/src/qa.ts';
import { args, repoRoot } from '../run.ts';
import { compileInMemory, type InMemoryBuild } from './bundle.ts';
import { SF_AUTHORING_BAKE } from './build.ts';
import { SF_MISSIONS_SUITE, loadSfBake, registerSfMissionsLoader, type MissionStarts } from './sf-scenario.ts';

export type FailReason = 'compile_error' | 'world_missing' | 'not_passed' | 'out_of_band' | 'hash_mismatch' | 'golden_mismatch';

export interface Failure {
  mission: string;
  seed: number | null;
  reason: FailReason;
  detail: string;
}

export interface RunRow {
  mission: string;
  seed: number;
  run: 1 | 2;
  outcome: string;
  elapsedSec: number;
  endTick: number;
  endHash: string;
}

export interface CheckOptions {
  root: string;
  mission?: string | undefined;
  act?: number | undefined;
  /** Where the per-run files go; `null` writes none (the tests). Default `<root>/test-results/missions`. */
  outDir?: string | null | undefined;
  /** Replaces the in-memory compile (the tests hand in a fixture build). */
  compile?: ((root: string, mission?: string) => Promise<InMemoryBuild>) | undefined;
  /** Only these seeds of each mission (the mutant harness runs seed 1); default all of the mission's own. */
  seeds?: readonly number[] | undefined;
  /** The environment `checkGolden` reads (`DV_UPDATE_GOLDEN`); default `process.env`. */
  env?: Readonly<Record<string, string | undefined>> | undefined;
  /** Replaces the fixture packs (the tests). */
  packs?: Record<string, Uint8Array> | undefined;
  log?: ((line: string) => void) | undefined;
}

export interface CheckResult {
  ok: boolean;
  failures: Failure[];
  rows: RunRow[];
  /** Missions that were not run (the sf bake is absent). */
  skipped: string[];
}

const RUNS = 2;

function describeStuck(h: MissionsHandle | null): string {
  const rt = h?.controller.rt;
  if (!rt) return 'the mission never started';
  const active = [...rt.objectives.values()].filter((o) => o.state === 'active').map((o) => o.def.id);
  const cp = rt.stageIndex >= 0 ? `stage ${rt.stageIndex} (${rt.stage?.id ?? '?'})` : 'no stage';
  return `${cp}, active objective ${active.join(', ') || 'none'}, phase ${rt.phase}${rt.phase === 'failed' ? ` (${rt.debugState()['failReason'] as string})` : ''}`;
}

export async function runCheck(o: CheckOptions): Promise<CheckResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  const failures: Failure[] = [];
  const rows: RunRow[] = [];
  const skipped: string[] = [];
  registerStoryQa();
  const sfBake = loadSfBake(o.root);
  if (sfBake) {
    registerSfMissionsLoader({
      bake: sfBake,
      starts: JSON.parse(readFileSync(path.join(o.root, 'config/autoplay/mission-starts.json'), 'utf8')) as MissionStarts,
      unlockDefs: (JSON.parse(readFileSync(path.join(o.root, 'config/unlocks.json'), 'utf8')) as { unlocks: UnlockDef[] }).unlocks,
    });
  }
  const build = await (o.compile ?? compileInMemory)(o.root, o.mission);
  for (const e of build.errors) failures.push({ mission: e.mission, seed: null, reason: 'compile_error', detail: `${e.code} ${e.pointer}: ${e.message}` });
  for (const p of build.problems) failures.push({ mission: '-', seed: null, reason: 'compile_error', detail: p });

  const outDir = o.outDir === undefined ? path.join(o.root, 'test-results', 'missions') : o.outDir;
  if (outDir) mkdirSync(outDir, { recursive: true });
  const packs = o.packs ?? { ...readFixturePacks(o.root) };

  const ids = [...build.bundles.keys()].filter((id) => !o.mission || id === o.mission).sort();
  for (const id of ids) {
    const bundle = build.bundles.get(id) as MissionBundle;
    if (o.act !== undefined && bundle.ir.act !== o.act) continue;
    const onSf = bundle.ir.worldBake === SF_AUTHORING_BAKE;
    if (onSf && !sfBake) {
      if (o.env?.['DV_REQUIRE_BAKE'] === '1' || process.env['DV_REQUIRE_BAKE'] === '1') failures.push({ mission: id, seed: null, reason: 'world_missing', detail: 'no sf bake in dist/world (run pnpm map:build -- --area sf)' });
      else {
        log(`SKIP check:missions ${id}: no sf bake in dist/world (run pnpm map:build -- --area sf)`);
        skipped.push(id);
      }
      continue;
    }
    const suiteOf = (spec: RunSpec): RunSpec => (onSf ? { ...spec, suite: SF_MISSIONS_SUITE } : spec);
    const [lo, hi] = bundle.ir.autoplay.expectedSec;
    for (const seed of bundle.ir.autoplay.seeds) {
      if (o.seeds && !o.seeds.includes(seed)) continue;
      const hashes: string[] = [];
      let bad = false;
      for (let run = 1; run <= RUNS && !bad; run++) {
        let handle: MissionsHandle | null = null;
        const runner = createCanonicalRunner({
          packs: { ...packs, mission: encodeBundle(bundle) },
          processEnv: {},
          onLoaded: (h) => (handle = h as MissionsHandle),
        });
        let trace: StateHashTrace;
        try {
          trace = await runner.run(suiteOf(missionSpec({ id, seed, expectedSecMax: hi })));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          failures.push({ mission: id, seed, reason: msg.startsWith('world bake') ? 'world_missing' : 'not_passed', detail: msg });
          bad = true;
          break;
        }
        const h = handle as MissionsHandle | null;
        const rt = h?.controller.rt;
        const elapsedSec = rt ? rt.clock / 60 : 0;
        const row: RunRow = { mission: id, seed, run: run as 1 | 2, outcome: trace.end.outcome, elapsedSec, endTick: trace.end.tick, endHash: trace.end.hash };
        rows.push(row);
        hashes.push(trace.end.hash);
        if (run === 1 && outDir && h) {
          const meta = { mission: id, seed, outcome: trace.end.outcome, endHash: trace.end.hash, elapsedSec, endTick: trace.end.tick };
          writeFileSync(path.join(outDir, `${id}.${seed}.dvtl`), Buffer.from(h.timeline.exportDvtl(meta)));
          writeFileSync(path.join(outDir, `${id}.${seed}.json`), `${JSON.stringify({ ...meta, spec: trace.spec, checkpoints: trace.checkpoints.length }, null, 2)}\n`);
        }
        if (trace.end.outcome !== 'pass') {
          failures.push({ mission: id, seed, reason: 'not_passed', detail: `outcome ${trace.end.outcome} at tick ${trace.end.tick}; ${describeStuck(h)}` });
          bad = true;
        } else if (elapsedSec < lo || elapsedSec > hi) {
          failures.push({ mission: id, seed, reason: 'out_of_band', detail: `${elapsedSec.toFixed(1)} s is outside [${lo}, ${hi}]` });
          bad = true;
        }
      }
      if (!bad && new Set(hashes).size > 1) failures.push({ mission: id, seed, reason: 'hash_mismatch', detail: `the two runs ended with ${hashes.join(' and ')}` });
      if (!bad && (GOLDEN_SEEDS[id] ?? []).includes(seed)) {
        // the det run (beats played) against the Node golden the browsers are held to
        const runner = createCanonicalRunner({ packs: { ...packs, mission: encodeBundle(bundle) }, processEnv: {} });
        const trace = await runner.run(suiteOf(missionDetSpec({ id, seed, expectedSecMax: hi })));
        const g = checkGolden(trace, `${id}.${seed}`, { root: path.join(o.root, 'tests', 'golden'), env: o.env ?? process.env });
        log(`golden ${id}.${seed}: ${g.state}`);
        if (!g.ok) failures.push({ mission: id, seed, reason: 'golden_mismatch', detail: `${g.state}${g.firstDiff ? `: ${g.firstDiff}` : ''}` });
      }
    }
  }

  log('mission                 seed run outcome   sec     ticks  end hash');
  for (const r of rows) {
    log(`${r.mission.padEnd(23)} ${String(r.seed).padStart(4)} ${String(r.run).padStart(3)} ${r.outcome.padEnd(8)} ${r.elapsedSec.toFixed(1).padStart(6)} ${String(r.endTick).padStart(8)}  ${r.endHash}`);
  }
  for (const f of failures) log(`FAIL ${f.mission}${f.seed === null ? '' : ` seed ${f.seed}`} ${f.reason}: ${f.detail}`);
  if (failures.length === 0) log(`check:missions ok: ${ids.length - skipped.length} mission(s), ${rows.length} run(s)${skipped.length > 0 ? `, ${skipped.length} skipped` : ''}`);
  return { ok: failures.length === 0, failures, rows, skipped };
}

export async function main(argv: readonly string[] = args()): Promise<number> {
  const { values } = parseArgs({ args: [...argv], options: { mission: { type: 'string' }, act: { type: 'string' } }, allowPositionals: true });
  const act = values.act === undefined ? undefined : Number(values.act);
  if (act !== undefined && !Number.isInteger(act)) {
    console.error('check:missions: --act takes an integer');
    return 2;
  }
  const r = await runCheck({ root: repoRoot, mission: values.mission, act });
  return r.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
      process.exit(1);
    },
  );
}
