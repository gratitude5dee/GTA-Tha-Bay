/**
 * missions:preview (M05a2; 03-story-missions.md C10): runs a mission once, headless, at full speed under the autoplayer, and
 * writes the recorded timeline.
 *
 *   tsx tools/ci/missions/preview.ts --mission <id> --seed <n> [--instant]
 *
 * Writes `test-results/preview/<id>.<seed>.dvtl` and prints one line per chapter (a `mis.stage` event: index, stage id, time) and the
 * URL of the QA scrub page. The beats are played (the director runs its scripts) unless `--instant` is given. The page
 * `apps/web/qa/mission-preview.html` (QA builds) opens the file, scrubs the tracks with a binary search, marks the chapters and shows
 * the `mis.say` subtitles.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createCanonicalRunner } from '../../../packages/engine/src/qa/runner.ts';
import { decodeDvtl } from '../../../packages/engine/src/sim/script/dvtl.ts';
import { readFixturePacks } from '../../../packages/engine/src/qa/node.ts';
import { encodeBundle, registerStoryQa, missionSpec, type MissionsHandle } from '../../../packages/modes/story/src/qa.ts';
import { args, repoRoot } from '../run.ts';
import { compileInMemory } from './bundle.ts';

export interface PreviewResult {
  file: string;
  outcome: string;
  chapters: { index: number; id: string; tick: number }[];
  endTick: number;
}

export async function preview(o: { root: string; mission: string; seed: number; instant?: boolean; outDir?: string; log?: (l: string) => void }): Promise<PreviewResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  registerStoryQa();
  const build = await compileInMemory(o.root, o.mission);
  const bundle = build.bundles.get(o.mission);
  if (!bundle) {
    const why = [...build.errors.map((e) => `${e.code} ${e.pointer}`), ...build.problems].join('; ') || 'no such mission';
    throw new Error(`missions:preview: ${o.mission} did not compile: ${why}`);
  }
  let handle: MissionsHandle | null = null;
  const runner = createCanonicalRunner({
    packs: { ...readFixturePacks(o.root), mission: encodeBundle(bundle) },
    processEnv: {},
    onLoaded: (h) => (handle = h as MissionsHandle),
  });
  const [, hi] = bundle.ir.autoplay.expectedSec;
  const trace = await runner.run(missionSpec({ id: o.mission, seed: o.seed, expectedSecMax: hi, flags: o.instant ? { beats: 'instant', talk: 'scripted', hooks: 'bot' } : { talk: 'scripted', hooks: 'bot' } }));
  const h = handle as MissionsHandle | null;
  if (!h) throw new Error('missions:preview: the scenario never loaded');
  const rt = h.controller.rt;
  const meta = { mission: o.mission, seed: o.seed, outcome: trace.end.outcome, endHash: trace.end.hash, elapsedSec: rt ? rt.clock / 60 : 0, endTick: trace.end.tick };
  const bytes = Buffer.from(h.timeline.exportDvtl(meta));
  const dir = o.outDir ?? path.join(o.root, 'test-results', 'preview');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${o.mission}.${o.seed}.dvtl`);
  writeFileSync(file, bytes);
  const d = decodeDvtl(bytes);
  const chapters = d.events
    .filter((e) => e.t === 'mis.stage')
    .map((e) => ({ index: Number((e.data as { index?: number }).index ?? 0), id: String((e.data as { id?: string }).id ?? ''), tick: e.tick }));
  log(`${o.mission} seed ${o.seed}: ${trace.end.outcome} at tick ${trace.end.tick} (${(trace.end.tick / 60).toFixed(1)} s), ${chapters.length} chapters, ${d.tracks.length} tracks, ${d.events.length} events`);
  for (const c of chapters) log(`chapter ${String(c.index).padStart(2)} ${c.id.padEnd(10)} tick ${String(c.tick).padStart(6)}  ${(c.tick / 60).toFixed(1).padStart(6)} s`);
  log(`wrote ${path.relative(o.root, file)}`);
  log('scrub it: pnpm dev, then open /qa/mission-preview.html and choose that file (or ?timeline=<url of the file>)');
  return { file, outcome: trace.end.outcome, chapters, endTick: trace.end.tick };
}

export async function main(argv: readonly string[] = args()): Promise<number> {
  const { values } = parseArgs({ args: [...argv], options: { mission: { type: 'string' }, seed: { type: 'string' }, instant: { type: 'boolean' } }, allowPositionals: true });
  if (!values.mission) {
    console.error('usage: pnpm missions:preview -- --mission <id> [--seed <n>] [--instant]');
    return 2;
  }
  const seed = values.seed === undefined ? 1 : Number(values.seed);
  if (!Number.isInteger(seed) || seed < 0) {
    console.error('missions:preview: --seed takes a non-negative integer');
    return 2;
  }
  const r = await preview({ root: repoRoot, mission: values.mission, seed, ...(values.instant ? { instant: true } : {}) });
  return r.outcome === 'pass' ? 0 : 1;
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
