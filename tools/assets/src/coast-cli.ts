/**
 * pnpm assets:coast -- <split|link|check> (M10a2, DL-737)
 *
 *   split [--by <profile>]   split the published `character/pc-coast` into the six creator parts (tools/assets/src/coast.ts)
 *   link                     set `model` and `portrait` on the Coast catalog rows whose assets are in the lock
 *   check                    read only: the same rules, exit 1 on a problem
 *
 * Offline: it reads and writes repository files only. `split` needs the published `pc-coast` (the operator's batch); without it the command
 * says so and exits 1, and `link` lists every row as pending and changes nothing.
 */
import { parseArgs } from 'node:util';
import { args, repoRoot } from '../../ci/run.ts';
import { isMain } from '../../ci/lib/common.ts';
import { linkCoast, checkCoast, splitCoast } from './coast.ts';

export async function coastCommand(argv: readonly string[], root: string, log: (l: string) => void, now: () => Date = () => new Date()): Promise<number> {
  const [sub, ...rest] = argv;
  const { values } = parseArgs({ args: [...rest], options: { by: { type: 'string', default: 'art-lead' } } });
  if (sub === 'split') {
    const r = await splitCoast(root, { by: values.by as string, at: now().toISOString().replace(/\.\d{3}Z$/, 'Z') });
    for (const f of r.findings) log(`assets:coast split: ${f}`);
    if (r.ok) log(`assets:coast split: wrote ${r.files.length} files; run pnpm assets:lock -- --approved-by <handle>, review the lock diff, then pnpm assets:coast -- link`);
    return r.ok ? 0 : 1;
  }
  if (sub === 'link') {
    const r = linkCoast(root, { write: true });
    for (const p of r.problems) log(`assets:coast link: ${p}`);
    log(`assets:coast link: set ${r.set.length} (${r.set.join(', ') || '-'}), unchanged ${r.unchanged.length}, pending ${r.pending.length}${r.pending.length > 0 ? ` (${r.pending.join(', ')}: the part assets are not in the lock yet; the rows keep the mannequin path)` : ''}`);
    return r.problems.length > 0 ? 1 : 0;
  }
  if (sub === 'check') {
    const p = checkCoast(root);
    for (const l of p) log(`assets:coast check: ${l}`);
    log(p.length === 0 ? 'assets:coast check: ok' : `assets:coast check: FAIL (${p.length})`);
    return p.length === 0 ? 0 : 1;
  }
  log('usage: pnpm assets:coast -- <split|link|check> [--by <profile>]');
  return 2;
}

if (isMain(import.meta.url)) {
  coastCommand(args(), repoRoot, (l) => console.log(l)).then((c) => process.exit(c), (e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
