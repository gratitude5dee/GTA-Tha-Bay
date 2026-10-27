/**
 * Shared file-system helpers of the tools/soul CLIs: roots, rules block, soul discovery, config readers.
 * Everything with IO lives here and in the command modules; packages/shared/src/npc stays pure.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RulesBlock } from '../../../packages/shared/src/npc/compile.ts';

export const soulRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const PUBLIC_NPC_DIR = 'content/npcs';
export const PRIVATE_NPC_DIR = 'content-private/npcs';
export const BASELINE_PATH = 'content/npcs/souls.index.json';

export function readJson<T>(root: string, rel: string): T {
  return JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as T;
}

export function readJsonIfExists<T>(root: string, rel: string): T | null {
  const p = path.join(root, rel);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null;
}

/** `content-private/` is a private mount: absent in forks and in CI without the mount. */
export const privateMounted = (root: string): boolean => existsSync(path.join(root, 'content-private'));

/** Posix-style relative path. */
export const rel = (root: string, abs: string): string => path.relative(root, abs).split(path.sep).join('/');

/** soul.md files under content/npcs/*\/ and, when mounted, content-private/npcs/*\/. */
export function discoverSouls(root: string): string[] {
  const out: string[] = [];
  for (const base of [PUBLIC_NPC_DIR, PRIVATE_NPC_DIR]) {
    const dir = path.join(root, base);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const f = path.join(dir, name, 'soul.md');
      if (existsSync(f) && statSync(f).isFile()) out.push(`${base}/${name}/soul.md`);
    }
  }
  // The development souls of the fighter slots (M08b1) sit one level deeper, under content/npcs/fighters-dev/<slot>/.
  const dev = path.join(root, PUBLIC_NPC_DIR, 'fighters-dev');
  if (existsSync(dev)) {
    for (const name of readdirSync(dev).sort()) {
      const f = path.join(dev, name, 'soul.md');
      if (existsSync(f) && statSync(f).isFile()) out.push(`${PUBLIC_NPC_DIR}/fighters-dev/${name}/soul.md`);
    }
  }
  return out;
}

/** soul.md files below a path given on the command line: the file itself, or every soul.md found under a directory. */
export function soulsUnder(abs: string): string[] {
  const st = statSync(abs);
  if (st.isFile()) return [abs];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (name === 'soul.md') out.push(p);
    }
  };
  walk(abs);
  return out;
}

/** Block A: the highest `rules@<n>.md` of the private mount, else the highest public `rules@<n>.example.md`. */
export function loadRules(root: string): RulesBlock {
  const candidates: { version: number; file: string }[] = [];
  for (const [dir, re] of [
    ['content-private/prompts/npc', /^rules@(\d+)\.md$/],
    ['content/prompts/npc', /^rules@(\d+)\.example\.md$/],
  ] as const) {
    const abs = path.join(root, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      const m = re.exec(name);
      if (m) candidates.push({ version: Number(m[1]), file: `${dir}/${name}` });
    }
    if (candidates.length) break; // the private mount wins whole
  }
  const best = candidates.sort((a, b) => b.version - a.version)[0];
  if (!best) throw new Error('no block A rules file: expected content/prompts/npc/rules@<n>.example.md');
  const text = readFileSync(path.join(root, best.file), 'utf8');
  const m = /<rules>\n([\s\S]*?)\n<\/rules>/.exec(text);
  return { version: best.version, text: (m ? (m[1] as string) : text).trim() };
}

export interface PoiTable { pois: Set<string>; districts: Set<string> | null; source: string }

/** C08 POI table when packages/world exports it, else the stub (lint L2). */
export function loadPoiTable(root: string): PoiTable {
  const world = path.join(root, 'packages/world/src/pois.json');
  if (existsSync(world)) {
    const t = JSON.parse(readFileSync(world, 'utf8')) as { pois?: string[]; districts?: string[] };
    return { pois: new Set(t.pois ?? []), districts: t.districts ? new Set(t.districts) : null, source: 'packages/world' };
  }
  const stub = readJson<{ pois: string[]; districts?: string[] }>(root, `${PUBLIC_NPC_DIR}/poi.stub.json`);
  return { pois: new Set(stub.pois), districts: stub.districts ? new Set(stub.districts) : null, source: `${PUBLIC_NPC_DIR}/poi.stub.json` };
}

export function loadGoals(root: string): Set<string> {
  return new Set(readJson<{ goals: { id: string }[] }>(root, 'config/npc-goals.json').goals.map((g) => g.id));
}

/** Epoch ms for generated files: SOURCE_DATE_EPOCH (seconds) when set, else now. Tools only, never sim code. */
export function buildTimeMs(env: NodeJS.ProcessEnv = process.env): number {
  const sde = env.SOURCE_DATE_EPOCH;
  if (sde && /^\d+$/.test(sde)) return Number(sde) * 1000;
  return Date.now();
}

/** ISO-8601 UTC without milliseconds, for repo-audited records. */
export const isoSeconds = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
