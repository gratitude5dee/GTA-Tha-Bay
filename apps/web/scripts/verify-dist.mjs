#!/usr/bin/env node
/**
 * verify:dist (M01a2 AC-11). Checks a production build of apps/web/dist:
 *   - no qa/ directory or page;
 *   - no bot-input module (by file name and by its error strings);
 *   - no `__dvBridge` string in any file;
 *   - no memory-bomb page or code and no PerfHud (M01c AC-11);
 *   - no entity inspector, physics wireframe, line recorder or QA vehicle commands (M03a1 AC-11);
 *   - no `governor.inject` or `injectMB` (M11a1 AC-10);
 *   - no media-local/ mirror and no `__dvBridge.assets` (M01e AC-10);
 *   - the service worker precache has the simd-compat Rapier chunk and no deterministic-compat entry, while the
 *     deterministic-compat chunk exists in dist so canonical sessions can load it on demand.
 *
 *   node apps/web/scripts/verify-dist.mjs [--dist <dir>]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/** Returns the list of failures; empty means the dist passes. */
export function verifyDist(dist) {
  const failures = [];
  const fail = (msg) => failures.push(msg);
  if (!existsSync(dist)) return [`dist not found: ${dist}; run pnpm build`];
  const files = listFiles(dist);
  const rel = (f) => path.relative(dist, f).split(path.sep).join('/');
  const text = (f) => readFileSync(f, 'utf8');
  const textFiles = files.filter((f) => /\.(js|html|css|json|webmanifest|map|txt)$/.test(f));

  // 1. No QA pages.
  if (existsSync(path.join(dist, 'qa'))) fail('dist/qa exists: QA pages must not ship');
  for (const f of files) if (/(^|\/)qa\//.test(rel(f))) fail(`QA file in dist: ${rel(f)}`);
  for (const f of files) if (/determinism(-suite)?[-.]/.test(path.basename(f)) && f.endsWith('.js')) fail(`determinism QA code in dist: ${rel(f)}`);

  // 2. No bot-input module.
  for (const f of files) if (/bot-input/.test(path.basename(f))) fail(`bot-input module in dist: ${rel(f)}`);
  for (const f of textFiles) {
    const s = text(f);
    if (s.includes('bot script must be an array of segments') || s.includes('ScriptedBotInput')) fail(`bot-input code found in ${rel(f)}`);
  }

  // 2b. No memory bomb and no PerfHud (M01c): both are QA tools.
  for (const f of files) if (/memory-bomb/.test(rel(f))) fail(`memory-bomb file in dist: ${rel(f)}`);
  for (const f of textFiles) {
    const s = text(f);
    if (/memory-bomb|dv\.membomb/.test(s)) fail(`memory-bomb code found in ${rel(f)}`);
    if (s.includes('PerfHud') || s.includes('dv-perf-hud')) fail(`PerfHud code found in ${rel(f)}`);
  }

  // 2c. No QA tools of M01b2: the F3 panel, the free cam and the XR smoke button.
  for (const f of textFiles) {
    const s = text(f);
    if (s.includes('dv-sim-panel') || s.includes('dvSimPanel') || s.includes('Enter VR (smoke)') || s.includes('dvXrSmoke')) fail(`QA debug tools found in ${rel(f)}`);
  }

  // 2d. No save-kill QA page or worker half (M04a1).
  for (const f of files) if (/save-kill/.test(rel(f))) fail(`save-kill file in dist: ${rel(f)}`);
  for (const f of textFiles) {
    const s = text(f);
    if (s.includes('save-kill') || s.includes('save-verify') || s.includes('KILL_PROFILE')) fail(`save-kill QA code found in ${rel(f)}`);
  }

  // 2e. No entity inspector, physics wireframe, line recorder or QA vehicle commands (M03a1 AC-11).
  for (const f of textFiles) {
    const s = text(f);
    if (/inspect\.reply\.|physics\.reply\.|spawn\.reply\.|vehicle\.reply\.|veh:qa|LineRecorder|physics-draw|dv-inspector|pursuit\.reply\.|dv-pursuit|pursuit-panel|runPursuitQa|modes\.reply\.|modes-panel|dv-modes|runModesQa/.test(s)) fail(`QA vehicle tools found in ${rel(f)}`);
  }

  // 2f. No world-hash QA page or its code (M03b1 AC-12): the page and the strings only it contains.
  for (const f of files) if (/world-hash/.test(rel(f))) fail(`world-hash file in dist: ${rel(f)}`);
  for (const f of textFiles) {
    const s = text(f);
    if (s.includes('world-hash') || s.includes('dvWorldHash') || s.includes('traffic-synth') || s.includes('traffic-peds-synth')) fail(`world-hash QA code found in ${rel(f)}`);
  }

  // 2g. No governor or memory-budget QA injection (M11a1 AC-10): the bridge members are QA-only.
  for (const f of textFiles) {
    const s = text(f);
    if (s.includes('governor.inject') || s.includes('injectMB')) fail(`governor/memory QA injection found in ${rel(f)}`);
  }

  // 3. No __dvBridge anywhere.
  for (const f of textFiles) if (text(f).includes('__dvBridge')) fail(`"__dvBridge" found in ${rel(f)}`);

  // 3b. No media-local mirror: it is a QA-only same-origin copy of the asset store (M01e).
  if (existsSync(path.join(dist, 'media-local'))) fail('dist/media-local exists: the QA media mirror must not ship');
  for (const f of files) if (/(^|\/)media-local\//.test(rel(f))) fail(`media-local file in dist: ${rel(f)}`);
  for (const f of textFiles) {
    const s = text(f);
    if (s.includes('/media-local') || s.includes('media-local/')) fail(`"media-local" found in ${rel(f)}`);
    if (/__dvBridge[^;]{0,40}assets|bridge\.assets/.test(s)) fail(`"__dvBridge.assets" found in ${rel(f)}`);
  }

  // 4. Precache: simd-compat in, deterministic-compat out; the deterministic chunk is still in dist.
  const swPath = path.join(dist, 'sw.js');
  if (!existsSync(swPath)) fail('sw.js is missing');
  else {
    const sw = text(swPath);
    const urls = [...sw.matchAll(/["']?url["']?\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    if (urls.length === 0) fail('sw.js has no precache entries');
    const simd = urls.filter((u) => /rapier-simd-/.test(u));
    if (simd.length !== 1) fail(`expected exactly one rapier-simd chunk in the precache manifest, found ${simd.length}`);
    for (const u of urls) {
      if (/deterministic/.test(u)) fail(`deterministic-compat chunk is precached: ${u}`);
    }
  }
  const deterministic = files.filter((f) => /rapier-deterministic-/.test(path.basename(f)));
  if (deterministic.length !== 1) fail(`expected one rapier-deterministic chunk in dist/assets, found ${deterministic.length}`);
  // Each build must be in its own chunk: the simd chunk must not carry the deterministic package and the reverse.
  for (const f of files.filter((x) => /rapier-simd-/.test(path.basename(x)))) {
    if (/rapier3d-deterministic/.test(text(f))) fail(`${rel(f)} mentions the deterministic build`);
  }
  return failures;
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--dist');
  const dist = path.resolve(i >= 0 ? (argv[i + 1] ?? '') : path.join(here, '..', 'dist'));
  console.log(`verify:dist ${dist}`);
  const failures = verifyDist(dist);
  if (failures.length > 0) {
    for (const f of failures) console.error(`  FAIL  ${f}`);
    console.error(`verify:dist failed (${failures.length})`);
    process.exit(1);
  }
  console.log('  ok    no qa/ page, no bot-input module, no memory-bomb, no save-kill, no world-hash, no PerfHud, no __dvBridge string, no media-local');
  console.log('  ok    precache has the simd-compat chunk and no deterministic-compat entry');
  console.log('verify:dist passed');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
