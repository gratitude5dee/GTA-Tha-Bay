/**
 * Fixture trees for the M00f gates (DL-645). One function per case builds its tree in a temporary directory:
 * register stub, REUSE.toml, third_party/ tree, package stubs and, where needed, a dist/ stub. "Portions from"
 * headers, Mapbox hosts and token prefixes are built from fragments so the repository scans never match this file.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NamesFile } from '../../../packages/shared/src/assets/gates/names.ts';
import { toolsRoot } from '../lib/common.ts';
import type { AllowedPathItem, Register, RegisterEntry } from '../lib/third-party.ts';
import { readJson } from '../lib/common.ts';

export const CASES = [
  'clean', 'no-entry', 'no-sha', 'no-license', 'licence-file-missing', 'dual-licence-missing-data-grant', 'outside-paths',
  'gpl-code', 'data-as-code', 'reuse-toml-mismatch', 'subset-keys', 'geocoded-field', 'notice-no-url', 'notice-no-modified',
  'credits-missing', 'credits-vendored', 'header-unresolved', 'header-no-copyright', 'pack-no-licences', 'notice-bad-format',
  'gpl-exception', 'services-gpl-dep', 'ported-no-header', 'ported-with-header', 'mapbox-host', 'mapbox-token',
  'provenance-mapbox-url', 'module-ids-third-party', 'module-ids-worker', 'ported-in-tools-ci-no-header', 'field-synonym',
  'subset-high-cardinality', 'subset-name-value',
] as const;
export type CaseName = (typeof CASES)[number];

export interface FixtureCase {
  name: CaseName;
  root: string;
  /** Injected `pnpm pack --dry-run` file lists, by package directory. */
  packFiles: (pkgDir: string) => string[];
  /** Injected production dependencies per package name. */
  packageDeps: Record<string, Array<{ name: string; version: string; license: string }>>;
  /** Real-side registry stub (the name-like value of subset.csv). */
  real: NamesFile | null;
  /** Path of the module-ids file for module-ids-* cases. */
  moduleIdsFile?: string;
}

export const ENTRY = 'sf-bay-area-ai-atlas';
export const CODE_PATH = 'app/render.js';
export const DATA_PATH = 'data/companies.subset.json';
export const COPYRIGHT = 'Copyright (c) 2026 Fixture Author';
export const NAME_LIKE = 'Zorblax Quillfeather';
export const PORTIONS_HEADER = `${['Portions', 'from'].join(' ')} \`third_party/${ENTRY}/${CODE_PATH}\``;
const MIT_URL = 'https://opensource.org/licenses/MIT';
const CC_URL = 'https://creativecommons.org/licenses/by/4.0/';

export const MAPBOX_HOST = `api.${['map', 'box'].join('')}.com`;
export const MAPBOX_TOKEN = `${['p', 'k'].join('')}.${['ey', 'J'].join('')}1IjoiZml4dHVyZSJ9`;

/** Original, generic code used as the vendored file and as the copy. */
export const RENDER_JS = `export function stepFrame(state, dt) {
  const next = { items: [], tick: state.tick + 1 };
  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i];
    const px = item.x + item.vx * dt;
    const py = item.y + item.vy * dt;
    const bounceX = px < 0 || px > state.width;
    const bounceY = py < 0 || py > state.height;
    next.items.push({
      x: bounceX ? item.x : px,
      y: bounceY ? item.y : py,
      vx: bounceX ? -item.vx * 0.9 : item.vx * 0.99,
      vy: bounceY ? -item.vy * 0.9 : item.vy * 0.99,
    });
  }
  next.width = state.width;
  next.height = state.height;
  return next;
}
`;

const MIT_TEXT = `MIT License

${COPYRIGHT}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software, to deal in the
software without restriction, subject to the following conditions: the above copyright notice and this permission
notice shall be included in all copies or substantial portions of the software.
`;

interface Model {
  register: Register;
  entry: RegisterEntry;
  files: Record<string, string>;
  notice: string[];
  reuseToml: string[];
  extraConfig: (cfg: { exceptions: unknown[] }) => void;
  packages: Record<string, { name: string; private?: boolean }>;
  dist: Record<string, string>;
  packFiles: Record<string, string[]>;
  packageDeps: FixtureCase['packageDeps'];
  real: NamesFile | null;
}

const rowsOf = (n: number, key = 'category'): string => JSON.stringify(Array.from({ length: n }, (_, i) => ({ [key]: `v${i}`, sector: 'infrastructure' })));

function baseModel(): Model {
  const real = readJson<Register>(path.join(toolsRoot, 'docs/legal/third-party-reuse.json'));
  const code: AllowedPathItem = { path: CODE_PATH, spdx: 'MIT', kind: 'code' };
  const data: AllowedPathItem = {
    path: DATA_PATH,
    spdx: 'CC-BY-4.0',
    kind: 'data',
    modified: true,
    fields: [{ name: 'category', note: 'authored upstream' }, { name: 'sector', note: 'authored upstream' }],
  };
  const entry: RegisterEntry = {
    name: ENTRY,
    repo: 'fixture/atlas',
    url: 'https://example.invalid/atlas',
    verdict: 'REUSE-WITH-ATTRIBUTION',
    pinnedSha: 'a'.repeat(40),
    allowedPaths: [code, data],
    licenceFiles: [{ path: 'LICENSE', spdx: 'MIT' }, { path: 'data/CREDIT.excerpt.md', spdx: 'CC-BY-4.0' }],
  };
  const base = `third_party/${ENTRY}`;
  return {
    register: { thirdPartyLicences: real.thirdPartyLicences!, excludedFieldPatterns: real.excludedFieldPatterns!, entries: [entry] },
    entry,
    files: {
      [`${base}/LICENSE`]: MIT_TEXT,
      [`${base}/${CODE_PATH}`]: RENDER_JS,
      [`${base}/${DATA_PATH}`]: `${rowsOf(3)}\n`,
      [`${base}/data/CREDIT.excerpt.md`]: 'Company dataset: CC BY 4.0, credit Fixture Author.\n',
    },
    notice: [
      `${ENTRY}/${CODE_PATH} | MIT | Fixture Author | ${MIT_URL}`,
      `${ENTRY}/${DATA_PATH} | CC-BY-4.0 | Fixture Author | ${CC_URL} | modified`,
    ],
    reuseToml: [
      `[[annotations]]\npath = ["**"]\nprecedence = "aggregate"\nSPDX-FileCopyrightText = "2026 Fixture"\nSPDX-License-Identifier = "LicenseRef-DeeVerse-Owned"\n`,
      `[[annotations]]\npath = ["${base}/${CODE_PATH}"]\nprecedence = "aggregate"\nSPDX-FileCopyrightText = "Fixture Author"\nSPDX-License-Identifier = "MIT"\n`,
      `[[annotations]]\npath = ["${base}/${DATA_PATH}"]\nprecedence = "aggregate"\nSPDX-FileCopyrightText = "Fixture Author"\nSPDX-License-Identifier = "CC-BY-4.0"\n`,
    ],
    extraConfig: () => {},
    packages: {},
    dist: {},
    packFiles: {},
    packageDeps: {},
    real: null,
  };
}

const portedSource = (withHeader: boolean, withCopyright = true): string =>
  `${withHeader ? `// ${PORTIONS_HEADER}\n${withCopyright ? `// ${COPYRIGHT}\n` : ''}// SPDX-License-Identifier: MIT\n` : ''}${RENDER_JS}`;

function applyCase(name: CaseName, m: Model): void {
  const base = `third_party/${ENTRY}`;
  const item = (p: string): AllowedPathItem => m.entry.allowedPaths!.find((i) => i.path === p)!;
  switch (name) {
    case 'clean':
      break;
    case 'no-entry':
      m.files['third_party/other-lib/index.js'] = 'export const a = 1;\n';
      break;
    case 'no-sha':
      m.entry.pinnedSha = null;
      break;
    case 'no-license':
      m.entry.licenceFiles = [{ path: 'data/CREDIT.excerpt.md', spdx: 'CC-BY-4.0' }, { path: 'NOTICE.txt', spdx: 'MIT' }];
      m.files[`${base}/NOTICE.txt`] = 'notice\n';
      delete m.files[`${base}/LICENSE`];
      break;
    case 'licence-file-missing':
      delete m.files[`${base}/LICENSE`];
      break;
    case 'dual-licence-missing-data-grant':
      m.entry.licenceFiles = [{ path: 'LICENSE', spdx: 'MIT' }];
      delete m.files[`${base}/data/CREDIT.excerpt.md`];
      break;
    case 'outside-paths':
      m.files[`${base}/extra/other.js`] = 'export const b = 2;\n';
      break;
    case 'gpl-code':
      item(CODE_PATH).spdx = 'GPL-3.0-only';
      m.notice[0] = `${ENTRY}/${CODE_PATH} | GPL-3.0-only | Fixture Author | https://www.gnu.org/licenses/gpl-3.0.html`;
      m.reuseToml[1] = m.reuseToml[1]!.replace('"MIT"', '"GPL-3.0-only"');
      break;
    case 'data-as-code':
      item(DATA_PATH).spdx = 'MIT';
      m.notice[1] = `${ENTRY}/${DATA_PATH} | MIT | Fixture Author | ${MIT_URL} | modified`;
      m.reuseToml[2] = m.reuseToml[2]!.replace('"CC-BY-4.0"', '"MIT"');
      break;
    case 'reuse-toml-mismatch':
      m.reuseToml[1] = m.reuseToml[1]!.replace('"MIT"', '"Apache-2.0"');
      break;
    case 'subset-keys':
      m.files[`${base}/${DATA_PATH}`] = `${JSON.stringify([{ category: 'tools', sector: 'infrastructure', rank: 1 }])}\n`;
      break;
    case 'geocoded-field':
      item(DATA_PATH).fields = [{ name: 'category', note: 'n' }, { name: 'address', note: 'n' }];
      m.files[`${base}/${DATA_PATH}`] = `${JSON.stringify([{ category: 'tools', address: 'x' }])}\n`;
      break;
    case 'field-synonym':
      item(DATA_PATH).fields = [{ name: 'category', note: 'n' }, { name: 'company', note: 'n' }, { name: 'website', note: 'n' }, { name: 'blurb', note: 'n' }, { name: 'lat', note: 'n' }];
      m.files[`${base}/${DATA_PATH}`] = `${JSON.stringify([{ category: 'tools', company: 'x', website: 'y', blurb: 'z', lat: '1' }])}\n`;
      break;
    case 'subset-high-cardinality':
      m.files[`${base}/${DATA_PATH}`] = `${rowsOf(33)}\n`;
      break;
    case 'subset-name-value':
      m.files[`${base}/${DATA_PATH}`] = `${JSON.stringify([{ category: NAME_LIKE, sector: 'infrastructure' }])}\n`;
      m.real = { schema: 'names/1', entries: [{ id: 'fx-1', real: NAME_LIKE }] };
      break;
    case 'notice-no-url':
      m.notice[1] = `${ENTRY}/${DATA_PATH} | CC-BY-4.0 | Fixture Author | modified`;
      break;
    case 'notice-no-modified':
      m.notice[1] = `${ENTRY}/${DATA_PATH} | CC-BY-4.0 | Fixture Author | ${CC_URL}`;
      break;
    case 'notice-bad-format':
      m.notice.push('this line does not parse');
      break;
    case 'credits-missing':
      m.files['packages/app/src/render-port.ts'] = portedSource(true);
      m.dist['credits.json'] = `${JSON.stringify({ schema: 'credits/1', attributions: [] })}\n`;
      m.dist['third-party-licenses.txt'] = `${MIT_TEXT}\n`;
      break;
    case 'credits-vendored':
      m.files['packages/app/src/render-port.ts'] = portedSource(true);
      m.dist['third-party-licenses.txt'] = `placeholder\n`; // replaced by the real tool in the test
      break;
    case 'header-unresolved':
      m.files['packages/app/src/render-port.ts'] = portedSource(true).replace(CODE_PATH, 'app/missing.js');
      break;
    case 'header-no-copyright':
      m.files['packages/app/src/render-port.ts'] = portedSource(true, false);
      break;
    case 'pack-no-licences':
      m.files['tools/cli/src/render-port.ts'] = portedSource(true);
      m.packages['tools/cli'] = { name: '@fx/cli' };
      m.packFiles['tools/cli'] = ['package.json', 'src/render-port.ts'];
      break;
    case 'gpl-exception':
      m.extraConfig = (cfg) => cfg.exceptions.push({ package: 'fx-copyleft', license: 'GPL-3.0-only', scope: 'prod', reason: 'fixture', adr: 'ADR-FIXTURE-1' });
      break;
    case 'services-gpl-dep':
      m.packages['services/fx-svc'] = { name: '@fx/svc', private: true };
      m.packageDeps['@fx/svc'] = [{ name: 'fx-copyleft', version: '1.0.0', license: 'GPL-3.0-only' }];
      break;
    case 'ported-no-header':
      m.files['packages/app/src/copy.ts'] = portedSource(false);
      break;
    case 'ported-in-tools-ci-no-header':
      m.files['tools/ci/copy.ts'] = portedSource(false);
      break;
    case 'ported-with-header':
      m.files['packages/app/src/render-port.ts'] = portedSource(true);
      break;
    case 'mapbox-host':
      m.files['config/fixture-tiles.json'] = `${JSON.stringify({ url: `https://${MAPBOX_HOST}/styles/v1/x` })}\n`;
      break;
    case 'mapbox-token':
      m.files['config/fixture-token.json'] = `${JSON.stringify({ token: MAPBOX_TOKEN })}\n`;
      break;
    case 'provenance-mapbox-url':
      // The record is written by the test (it needs a sha256 path); the case only fixes the host.
      break;
    case 'module-ids-third-party':
    case 'module-ids-worker':
      break;
  }
}

function put(root: string, rel: string, data: string): void {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, data);
}

const created: string[] = [];

/** Builds the tree of one case in a fresh temporary directory (no .git, so tools walk the directory). */
export function buildCase(name: CaseName): FixtureCase {
  const m = baseModel();
  applyCase(name, m);
  const root = mkdtempSync(path.join(os.tmpdir(), `dv-reuse-${name}-`));
  created.push(root);
  cpSync(path.join(toolsRoot, 'config'), path.join(root, 'config'), { recursive: true });
  put(root, 'LICENSES/LicenseRef-DeeVerse-Owned.txt', 'fixture licence text\n');
  put(root, 'docs/legal/third-party-reuse.json', `${JSON.stringify(m.register, null, 2)}\n`);
  put(root, 'REUSE.toml', `version = 1\n\n${m.reuseToml.join('\n')}`);
  put(root, 'third_party/NOTICE', `${m.notice.join('\n')}\n`);
  for (const [rel, text] of Object.entries(m.files)) put(root, rel, text);
  for (const [dir, pkg] of Object.entries(m.packages)) put(root, `${dir}/package.json`, `${JSON.stringify({ name: pkg.name, version: '0.0.0', ...(pkg.private ? { private: true } : {}) })}\n`);
  for (const [rel, text] of Object.entries(m.dist)) put(root, `apps/web/dist/${rel}`, text);
  if (name === 'gpl-exception') {
    const cfgFile = path.join(root, 'config/license-allowlist.json');
    const cfg = readJson<{ exceptions: unknown[] }>(cfgFile);
    m.extraConfig(cfg);
    writeFileSync(cfgFile, `${JSON.stringify(cfg, null, 2)}\n`);
  }
  const result: FixtureCase = {
    name,
    root,
    packFiles: (dir) => m.packFiles[dir] ?? [],
    packageDeps: m.packageDeps,
    real: m.real,
  };
  if (name === 'module-ids-third-party') {
    result.moduleIdsFile = path.join(root, 'module-ids.json');
    writeFileSync(result.moduleIdsFile, `${JSON.stringify({ schema: 'module-ids/1', ids: ['apps/web/src/main.ts', `third_party/${ENTRY}/${CODE_PATH}`] })}\n`);
  }
  return result;
}

/** A subset.csv column holding a name-like enumeration value, used by the subset tool test. */
export const SUBSET_CSV = path.join(toolsRoot, 'tools/ci/fixtures/third-party/subset.csv');

export function cleanupCases(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}
