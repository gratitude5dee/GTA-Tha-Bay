/**
 * Writes the third-party licence text that ships with the build (ADR-REUSE-01, DL-507).
 *
 *   tsx tools/ci/third-party-licenses.ts [--root <dir>] [--out <file>] [--package <dir>]
 *
 * Default: apps/web/dist/third-party-licenses.txt for every vendored entry. With --package <dir> the output is
 * <dir>/THIRD_PARTY_LICENSES.txt and holds only the entries that a ported file inside <dir> names in its header.
 * Nothing vendored (or nothing ported in the package) means no file.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { args } from './run.ts';
import { isMain, listTree, toolsRoot } from './lib/common.ts';
import {
  isCodeFile,
  loadRegister,
  noticeFor,
  parseNotice,
  parsePortionsHeaders,
  readText,
  vendoredEntries,
  type RegisterEntry,
} from './lib/third-party.ts';

const RULE = '='.repeat(72);

function entryBlock(root: string, entry: RegisterEntry, notice: ReturnType<typeof parseNotice>['lines']): string {
  const name = entry.name as string;
  const out: string[] = [RULE, `${name}`, `Source: ${entry.url ?? entry.repo ?? ''}`, `Pinned SHA: ${entry.pinnedSha ?? ''}`, ''];
  for (const item of entry.allowedPaths ?? []) {
    out.push(`Item: ${item.path} (${item.kind}, ${item.spdx})`);
    const line = noticeFor(notice, name, item);
    out.push(`NOTICE: ${line?.raw ?? '(no third_party/NOTICE line)'}`);
  }
  for (const l of entry.licenceFiles ?? []) {
    const text = readText(root, `third_party/${name}/${l.path}`);
    out.push('', `--- ${name}/${l.path} (${l.spdx}) ---`, text ?? '(file missing)');
  }
  return out.join('\n');
}

/** Returns the file written, or null when there is nothing to write. */
export function writeThirdPartyLicences(root: string, outFile: string, opts: { packageDir?: string | undefined } = {}): string | null {
  const reg = loadRegister(root);
  let entries = vendoredEntries(reg);
  if (opts.packageDir !== undefined) {
    const pkg = path.relative(root, path.resolve(root, opts.packageDir)).split(path.sep).join('/');
    const named = new Set<string>();
    for (const f of listTree(root).filter((x) => isCodeFile(x) && x.startsWith(`${pkg}/`))) {
      const text = readText(root, f);
      if (text) for (const h of parsePortionsHeaders(text)) named.add(h.name);
    }
    entries = entries.filter((e) => named.has(e.name as string));
  }
  if (entries.length === 0) {
    if (existsSync(outFile)) rmSync(outFile);
    return null;
  }
  const notice = parseNotice(readText(root, 'third_party/NOTICE') ?? '').lines;
  const body = ['Third-party software and data', '', ...entries.map((e) => entryBlock(root, e, notice))].join('\n');
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${body}\n`);
  return outFile;
}

function main(): void {
  const { values } = parseArgs({ args: args(), options: { root: { type: 'string' }, out: { type: 'string' }, package: { type: 'string' } } });
  const root = path.resolve(values.root ?? toolsRoot);
  const out = values.out
    ? path.resolve(values.out)
    : values.package
      ? path.join(path.resolve(root, values.package), 'THIRD_PARTY_LICENSES.txt')
      : path.join(root, 'apps/web/dist/third-party-licenses.txt');
  const written = writeThirdPartyLicences(root, out, { packageDir: values.package });
  console.log(written ? `third-party-licenses: wrote ${path.relative(root, written)}` : 'third-party-licenses: nothing vendored, no file written');
}

if (isMain(import.meta.url)) main();
