/**
 * ip:signatures, ip:extensions, ip:strings over the tracked tree plus apps/web/dist.
 *
 *   tsx tools/ci/ip-scan.ts --signatures | --extensions | --strings | --all  [--root <dir>] [--dist <dir>]
 *
 * Nothing is allowlisted for signatures or extensions. The string scan skips the path allowlist of
 * packages/shared/src/assets/gates/types.ts, binary files and (in dist) base64 runs of 256+ characters and data: URLs.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  compileStringMatcher,
  looksBinary,
  scanExtension,
  scanSignatures,
  scanStrings,
  stripEncodedBlobs,
} from '../../packages/shared/src/assets/gates/ip.ts';
import { isStringScanAllowlisted, type GateFinding } from '../../packages/shared/src/assets/gates/types.ts';
import { args } from './run.ts';
import { defaultDist, isMain, listDist, listTree, loadConfigs, report, toolsRoot } from './lib/common.ts';

export type IpMode = 'signatures' | 'extensions' | 'strings';

export interface IpScanOptions {
  root: string;
  dist: string;
  modes: IpMode[];
}

export function runIpScan(opts: IpScanOptions): { findings: GateFinding[]; scanned: number } {
  const cfg = loadConfigs(opts.root).denylist;
  const matcher = compileStringMatcher(cfg);
  const findings: GateFinding[] = [];
  const targets: { rel: string; abs: string; inDist: boolean }[] = [
    ...listTree(opts.root).map((rel) => ({ rel, abs: path.join(opts.root, rel), inDist: false })),
    ...listDist(opts.dist).map((rel) => ({ rel: `dist/${rel}`, abs: path.join(opts.dist, rel), inDist: true })),
  ];
  const want = new Set(opts.modes);
  for (const t of targets) {
    const bytes = readFileSync(t.abs);
    if (want.has('signatures')) findings.push(...scanSignatures(t.rel, bytes, cfg));
    if (want.has('extensions')) findings.push(...scanExtension(t.rel, cfg, bytes.subarray(0, 512)));
    if (want.has('strings') && !(!t.inDist && isStringScanAllowlisted(t.rel)) && !looksBinary(bytes)) {
      const text = bytes.toString('utf8');
      findings.push(...scanStrings(t.rel, t.inDist ? stripEncodedBlobs(text) : text, matcher));
    }
  }
  return { findings, scanned: targets.length };
}

function main(): void {
  const { values } = parseArgs({
    args: args(),
    options: {
      signatures: { type: 'boolean', default: false },
      extensions: { type: 'boolean', default: false },
      strings: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      root: { type: 'string' },
      dist: { type: 'string' },
    },
  });
  const modes: IpMode[] = [];
  if (values.all || values.signatures) modes.push('signatures');
  if (values.all || values.extensions) modes.push('extensions');
  if (values.all || values.strings) modes.push('strings');
  if (modes.length === 0) {
    console.error('usage: tsx tools/ci/ip-scan.ts --signatures | --extensions | --strings | --all');
    process.exit(2);
  }
  const root = path.resolve(values.root ?? toolsRoot);
  const dist = path.resolve(values.dist ?? defaultDist(root));
  if (!existsSync(dist)) console.log(`ip: note: ${dist} does not exist, scanning the tracked tree only`);
  const { findings, scanned } = runIpScan({ root, dist, modes });
  process.exit(report(`ip:${modes.join('+')}`, findings, scanned));
}

if (isMain(import.meta.url)) main();
