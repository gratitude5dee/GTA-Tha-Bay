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
import { writePlan } from '../../../map/src/landmarks/kit/build.ts';
import { applyRegistry, checkPeople, planAllPeople, refOfDef, type PeopleScope } from '../people-gen.ts';
import { incomingBases } from './character.ts';

const GATE = 'assets:import';

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
    case 'characters':
    case 'portraits': {
      const scope: PeopleScope = positionals[0] === 'portraits' ? 'portraits' : 'characters';
      const only = values.only ? values.only.split(',') : undefined;
      if (values.check) {
        const res = await checkPeople(root, only, scope);
        for (const d of res.diffs) console.log(`${GATE}: ${d.path}: ${d.why}; run pnpm assets:import -- ${positionals[0]}`);
        console.log(`assets:import ${positionals[0]} --check: ${res.plans} assets, ${res.diffs.length} difference(s)`);
        return res.diffs.length === 0 ? 0 : 1;
      }
      if (scope === 'characters') {
        const bases = incomingBases(root);
        if (bases.length === 0) console.log('SKIP licensed bases: no file in content-incoming/<pack>/; the people kit is built from the authored recipes (BD-M10d4-01)');
        else console.log(`licensed bases waiting in content-incoming/: ${bases.join(', ')} (they pass inspectBase before use)`);
      }
      const plans = await planAllPeople(root, only, scope);
      for (const p of plans) {
        writePlan(root, p);
        if (plans.length <= 40) console.log(`${refOfDef(p.def)}: ${Object.entries(p.stats).map(([v, s]) => `${v} ${(s as { tris: number }).tris} tris`).join(', ')}`);
      }
      if (scope === 'characters' && !only && applyRegistry(root)) console.log('config/art-placeholders.json: the M10d4 rows now name the people kit');
      console.log(`assets:import ${positionals[0]}: ${plans.length} asset(s) written; next: pnpm assets:lock && pnpm assets:catalog`);
      return 0;
    }
    default:
      console.error('usage: assets:import -- textures [--check] [--pin-sources] [--only <set>] | vet <dir|file> | characters [--check] [--only <id>] | portraits [--check]');
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
