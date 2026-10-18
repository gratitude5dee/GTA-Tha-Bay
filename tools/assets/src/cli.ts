/**
 * assets CLI: catalog | lock | verify | publish | seed.
 *
 *   tsx tools/assets/src/cli.ts catalog
 *   tsx tools/assets/src/cli.ts lock --approved-by <handle>
 *   tsx tools/assets/src/cli.ts verify
 *   tsx tools/assets/src/cli.ts publish --env staging|prod [--target r2|dir:<path>] [--dry-run] [--pointer-out <dir>]
 *   tsx tools/assets/src/cli.ts seed [--check]
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { formatFinding } from '../../../packages/shared/src/assets/gates/types.ts';
import { args } from '../../ci/run.ts';
import { toolsRoot } from '../../ci/lib/common.ts';
import { buildCatalog, writeCatalogDir } from './catalog.ts';
import { readLock, recordMap, updateLock, writeLock } from './lock.ts';
import { publishAssets } from './publish.ts';
import { seedTextures } from './seed.ts';
import { loadSpecs } from './spec.ts';
import { verifyAssets } from './verify.ts';

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: args(),
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      'approved-by': { type: 'string' },
      env: { type: 'string' },
      target: { type: 'string', default: 'r2' },
      'dry-run': { type: 'boolean', default: false },
      'pointer-out': { type: 'string' },
      check: { type: 'boolean', default: false },
    },
  });
  const root = path.resolve(values.root ?? toolsRoot);
  const cmd = positionals[0];
  switch (cmd) {
    case 'catalog': {
      const { build, problems } = buildCatalog(root);
      if (problems.length) {
        problems.forEach((p) => console.log(p));
        return 1;
      }
      const dir = writeCatalogDir(root, build);
      console.log(`assets:catalog: build ${build.catalog.buildId}, ${Object.keys(build.catalog.entries).length} entries, ${build.blobs.length} blobs, manifest ${build.manifestKey} (${path.relative(root, dir)})`);
      return 0;
    }
    case 'lock': {
      const by = values['approved-by'];
      if (!by || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(by)) {
        console.error('usage: assets:lock -- --approved-by <handle>');
        return 2;
      }
      const { specs, findings } = loadSpecs(root);
      if (findings.length) {
        findings.forEach((f) => console.log(formatFinding(f)));
        return 1;
      }
      const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const { lock, changed } = updateLock(specs, readLock(root), recordMap(root), by, at);
      writeLock(root, lock);
      console.log(`assets:lock: ${changed.length} changed${changed.length ? ` (${changed.join(', ')})` : ''}, ${Object.keys(lock.entries).length} entries`);
      return 0;
    }
    case 'verify': {
      const r = verifyAssets(root);
      r.findings.forEach((f) => console.log(formatFinding(f)));
      if (r.findings.length) {
        console.log(`assets:verify: FAIL (${r.findings.length} findings)`);
        return 1;
      }
      console.log(`assets:verify: ok (${r.scanned} specs, build ${r.build?.catalog.buildId ?? '-'})`);
      return 0;
    }
    case 'publish': {
      if (values.env !== 'staging' && values.env !== 'prod') {
        console.error('usage: assets:publish -- --env staging|prod [--target r2|dir:<path>] [--dry-run] [--pointer-out <dir>]');
        return 2;
      }
      const res = await publishAssets({ root, env: values.env, target: values.target, dryRun: values['dry-run'], pointerOut: values['pointer-out'] });
      return res.code;
    }
    case 'seed': {
      const diff = seedTextures(root, values.check);
      if (values.check) {
        diff.forEach((d) => console.log(`assets:seed: ${d} differs from a fresh render`));
        console.log(diff.length ? 'assets:seed --check: FAIL' : 'assets:seed --check: ok');
        return diff.length ? 1 : 0;
      }
      console.log('assets:seed: wrote 3 textures');
      return 0;
    }
    default:
      console.error('usage: assets <catalog|lock|verify|publish|seed> [options]');
      return 2;
  }
}

process.exit(await main());
