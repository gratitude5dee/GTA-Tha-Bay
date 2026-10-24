/**
 * Loads the inputs of the cutscene index from the repository (M05b2): CutsceneRefs from `content/story/**` `cutscene-refs.ts`,
 * the templates, seeds, places, styles, plates and the DirectorScript ids. Pure file reading; the builder takes the result.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CutsceneRef } from '../../../packages/shared/src/contracts/c09-cutscene.ts';
import { parseTemplate, templateFiles, type Template } from '../../ci/prompt-lint.ts';
import type { PlateInput } from './build.ts';

const readJson = <T>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback);

function walkFiles(dir: string, name: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, name, out);
    else if (e.name === name) out.push(p);
  }
  return out;
}

/** Every `content/story/**` `cutscene-refs.ts` default export (an array of CutsceneRef), in path order. */
export async function loadCutsceneRefs(root: string): Promise<CutsceneRef[]> {
  const out: CutsceneRef[] = [];
  for (const file of walkFiles(path.join(root, 'content/story'), 'cutscene-refs.ts')) {
    const mod = (await import(pathToFileURL(file).href)) as { default?: CutsceneRef[] };
    if (!Array.isArray(mod.default)) throw new Error(`${path.relative(root, file)} has no default export array`);
    out.push(...mod.default);
  }
  return out;
}

export function loadTemplates(root: string): Map<string, Template & { raw: string }> {
  const out = new Map<string, Template & { raw: string }>();
  for (const rel of templateFiles(root)) {
    const raw = readFileSync(path.join(root, rel), 'utf8');
    const t = parseTemplate(rel, raw);
    out.set(`${t.front.id}@${t.front.version}`, { ...t, raw });
  }
  return out;
}

export interface CutsceneContent {
  seeds: Record<string, number>;
  places: Record<string, string>;
  styles: Record<string, { tokens: string; sha256: string | null }>;
  plates: Record<string, PlateInput>;
}

export function loadCutsceneContent(root: string): CutsceneContent {
  const dir = path.join(root, 'content/cutscenes');
  return {
    seeds: readJson<{ seeds?: Record<string, number> }>(path.join(dir, 'seeds.json'), {}).seeds ?? {},
    places: readJson<{ places?: Record<string, string> }>(path.join(dir, 'places.json'), {}).places ?? {},
    styles: readJson<{ styles?: CutsceneContent['styles'] }>(path.join(dir, 'styles.json'), {}).styles ?? {},
    plates: readJson<{ plates?: Record<string, PlateInput> }>(path.join(dir, 'plates.lock.json'), {}).plates ?? {},
  };
}

/** The ids of the DirectorScripts on disk: the authored ones under `content/missions/*` and the built `data/director.*` assets. */
export function loadDirectorIds(root: string): Set<string> {
  const ids = new Set<string>();
  const missions = path.join(root, 'content/missions');
  if (existsSync(missions)) {
    for (const m of readdirSync(missions, { withFileTypes: true })) {
      const dir = path.join(missions, m.name, 'director');
      if (!m.isDirectory() || !existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) ids.add((JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as { id: string }).id);
      // a `.ts` script (`defineDirector`) is named `<missionId>.<file stem>` by convention, so a script that has not been compiled yet counts (M05c1)
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) ids.add(`${m.name}.${f.slice(0, -3)}`);
    }
  }
  const data = path.join(root, 'assets/src/data');
  if (existsSync(data)) for (const d of readdirSync(data)) if (d.startsWith('director.')) ids.add(d.slice('director.'.length));
  return ids;
}
