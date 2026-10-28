/**
 * assets:import CLI (M10d0, DL-OWN-06).
 *
 *   tsx tools/assets/src/import/cli.ts textures [--check] [--only <set>[,<set>]]
 *   tsx tools/assets/src/import/cli.ts textures --pin-sources
 *   tsx tools/assets/src/import/cli.ts vet <dir|file>
 *
 * `textures` downloads the pinned CC0 source maps into .cache/import/, converts them to KTX2 and writes the assets, specs and
 * provenance records (docs: texture-set.ts). `--check` verifies the committed outputs and needs neither a network nor an encoder.
 * `vet` runs the vetting rules over intake records and exits 1 when one is rejected.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { formatFinding } from '../../../../packages/shared/src/assets/gates/types.ts';
import { args } from '../../../ci/run.ts';
import { isMain, toolsRoot } from '../../../ci/lib/common.ts';
import { checkTextures, importTextures, pinSources } from './texture-set.ts';
import { formatVet, vetDir } from './vet.ts';

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: args(),
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      check: { type: 'boolean', default: false },
      'pin-sources': { type: 'boolean', default: false },
      only: { type: 'string' },
    },
  });
  const root = path.resolve(values.root ?? toolsRoot);
  switch (positionals[0]) {
    case 'textures': {
      if (values.check) {
        const res = checkTextures(root);
        for (const f of res.findings) console.log(formatFinding(f));
        console.log(`assets:import textures --check: ${res.assets} assets, ${res.findings.length} finding(s)`);
        return res.findings.length === 0 ? 0 : 1;
      }
      if (values['pin-sources']) {
        await pinSources(root, (m) => console.log(m));
        return 0;
      }
      await importTextures({ root, ...(values.only ? { only: values.only.split(',') } : {}), log: (m) => console.log(m) });
      return checkTextures(root).findings.length === 0 ? 0 : 1;
    }
    case 'vet': {
      const target = positionals[1];
      if (!target) {
        console.error('usage: assets:import -- vet <dir|file>');
        return 2;
      }
      const results = vetDir(root, path.resolve(target));
      for (const r of results) for (const line of formatVet(r)) console.log(line);
      const rejected = results.filter((r) => r.decision === 'reject').length;
      console.log(`assets:import vet: ${results.length} item(s), ${rejected} rejected`);
      return rejected === 0 && results.length > 0 ? 0 : 1;
    }
    default:
      console.error('usage: assets:import -- textures [--check] [--pin-sources] [--only <set>] | vet <dir|file>');
      return 2;
  }
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`assets:import: ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
