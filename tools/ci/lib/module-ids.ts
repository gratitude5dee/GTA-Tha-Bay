/** Reads apps/web/.dv-build/module-ids.json (written by the build) and rejects any id under third_party/ (DL-618). */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const MODULE_IDS_FILE = 'apps/web/.dv-build/module-ids.json';

/** Returns failure messages; empty when the file exists, parses, and no id resolves under <root>/third_party/. */
export function checkModuleIds(root: string, file = path.join(root, MODULE_IDS_FILE)): string[] {
  if (!existsSync(file)) return [`${path.relative(root, file)} is missing; run pnpm build first (the build writes it)`];
  let ids: unknown;
  try {
    ids = (JSON.parse(readFileSync(file, 'utf8')) as { ids?: unknown }).ids;
  } catch (e) {
    return [`${path.relative(root, file)} is not valid JSON: ${(e as Error).message}`];
  }
  if (!Array.isArray(ids)) return [`${path.relative(root, file)} has no "ids" array`];
  const tp = path.join(root, 'third_party') + path.sep;
  const bad: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    const clean = id.replace(/^\0/, '').split('?')[0] as string;
    const abs = path.resolve(root, clean);
    if (abs.startsWith(tp)) bad.push(`bundled module ${path.relative(root, abs)} is under third_party/`);
  }
  return bad;
}
