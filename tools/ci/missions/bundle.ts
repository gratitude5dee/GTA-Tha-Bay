/**
 * Reads a compiled mission from the repository for the `missions` suite (M05a2): the IR `assets/src/data/mission.<id>/mission.json`,
 * the DirectorScripts of the mission (`director.<scriptId>`) and the text of its lines (`lines.<act>.<lang>`), as the
 * `MissionBundle` the scenario loader takes. Node only. `missions:build` writes these files; `check:missions` compiles in memory
 * first (`compileInMemory`) so a mission with a compiler error is reported before any run.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { MissionIR } from '../../../packages/shared/src/index.ts';
import type { DirectorScript } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import { readFixturePacks } from '../../../packages/engine/src/qa/node.ts';
import type { MissionBundle } from '../../../packages/modes/story/src/scenario.ts';
import { planBuild, stableJson } from './build.ts';

const DATA = 'assets/src/data';

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

/** Ids of the compiled missions under `assets/src/data`, sorted. */
export function compiledMissionIds(root: string): string[] {
  const dir = path.join(root, DATA);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.startsWith('mission.') && existsSync(path.join(dir, n, 'mission.json')))
    .map((n) => n.slice('mission.'.length))
    .sort();
}

export function readIr(root: string, id: string): MissionIR {
  return readJson<MissionIR>(path.join(root, DATA, `mission.${id}`, 'mission.json'));
}

/** The bundle of a compiled mission. Directors are the ones the IR refers to; lines are every `lines.*` file of the mission's act. */
export function readBundle(root: string, id: string): MissionBundle {
  const ir = readIr(root, id);
  const directors: DirectorScript[] = [];
  const dir = path.join(root, DATA);
  for (const n of readdirSync(dir).sort()) {
    if (!n.startsWith('director.')) continue;
    const f = path.join(dir, n, 'director.json');
    if (!existsSync(f)) continue;
    const d = readJson<DirectorScript>(f);
    if (d.id.startsWith(`${id}.`)) directors.push(d);
  }
  const lines: Record<string, string> = {};
  const lf = path.join(dir, `lines.${ir.act}.en`, 'lines.json');
  if (existsSync(lf)) Object.assign(lines, readJson<{ text: Record<string, string> }>(lf).text);
  return { ir, directors, lines };
}

export interface InMemoryBuild {
  /** Mission ids that compiled. */
  missions: string[];
  errors: { mission: string; code: string; pointer: string; message: string }[];
  problems: string[];
  /** The bundles of the compiled missions, from the compiler's own output (not from `assets/src/data`). */
  bundles: Map<string, MissionBundle>;
}

/** `missions:build` without writing: the compiler runs on `content/missions` and the output is kept in memory. */
export async function compileInMemory(root: string, mission?: string): Promise<InMemoryBuild> {
  const plan = await planBuild({ root, ...(mission ? { mission } : {}) });
  const out: InMemoryBuild = {
    missions: plan.missions,
    errors: plan.errors.map((e) => ({ mission: e.mission, code: e.error.code, pointer: e.error.pointer, message: e.error.message })),
    problems: plan.problems,
    bundles: new Map(),
  };
  for (const id of plan.missions) {
    const irText = plan.files.get(`${DATA}/mission.${id}/mission.json`);
    if (!irText) continue;
    const ir = JSON.parse(irText) as MissionIR;
    const directors: DirectorScript[] = [];
    for (const [file, text] of plan.files) {
      const m = /^assets\/src\/data\/director\.(.+)\/director\.json$/.exec(file);
      if (m && (m[1] as string).startsWith(`${id}.`)) directors.push(JSON.parse(text) as DirectorScript);
    }
    const lf = plan.files.get(`${DATA}/lines.${ir.act}.en/lines.json`);
    const lines = lf ? (JSON.parse(lf) as { text: Record<string, string> }).text : {};
    out.bundles.set(id, { ir, directors, lines });
  }
  return out;
}

export { readFixturePacks, stableJson };
