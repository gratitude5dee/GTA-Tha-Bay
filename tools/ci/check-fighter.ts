/**
 * check:fighter (M08b1, FX11): the whole fighter content CI.
 *
 *   tsx tools/ci/check-fighter.ts [--bouts N] [--no-balance] [--root <dir>]
 *
 * Steps, in order: (1) schemas of the roster and the stages; (2) `fighter:lint` on the tuning table and every kit (frame data, loops,
 * fame-domain rule, habit ids, gimmick pairing); (3) roster completeness: for every slot the model, the clips, the portrait and the
 * stand-in resolve in the asset lock for all six quality tiers through VARIANT_FALLBACK, and the clip file holds a clip for every move
 * of the kit or a library fallback in `content/fighter/clip-fallbacks.json` (M10a2), and a baked (not gray-box) file passes the frame-count and
 * A5 checks of `inspectMoves`; (4) the tier and fame-domain gates of `likeness:gate`; (5) the generated files match their tables (kits, souls, gray-box
 * assets); (6) the golden replays re-simulate to every checkpoint; (7) the balance smoke, every pair of the eight kits at `--bouts`
 * bouts per side (default 100, the 28-pair x 100-bout run of FX11) inside 35 to 65 %. Exit 1 when a step fails.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import { VARIANT_FALLBACK } from '../../packages/shared/src/platform/c13.ts';
import { resolveVariant, type AssetManifest } from '../../packages/shared/src/assets/c07.ts';
import type { QualityTierId } from '../../packages/shared/src/platform/c13.ts';
import type { FighterDef, RosterEntry } from '../../packages/shared/src/fight/types.ts';
import { args, repoRoot } from './run.ts';
import { isMain } from './lib/common.ts';
import { runRosterGate } from './likeness-gate/roster.ts';
import { inspectMoves, isGraybox, movesOf, type Retarget5 } from '../assets/src/moves-check.ts';

const TIERS = Object.keys(VARIANT_FALLBACK) as QualityTierId[];

export interface Step { name: string; ok: boolean; lines: string[] }

const readJson = <T>(root: string, rel: string): T => JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as T;

/** Step 1: roster and stage JSON against their schemas. */
export function schemaStep(root: string): Step {
  const lines: string[] = [];
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const roster = ajv.compile(readJson<object>(root, 'packages/shared/src/fight/schema/roster.v1.schema.json'));
  if (!roster(readJson(root, 'content/fighter/roster.json'))) lines.push(...(roster.errors ?? []).map((e) => `content/fighter/roster.json ${e.instancePath} ${e.message ?? ''}`));
  const stage = ajv.compile(readJson<object>(root, 'packages/shared/src/fight/schema/stage.v1.schema.json'));
  const dir = path.join(root, 'content/fighter/stages');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    if (!stage(readJson(root, `content/fighter/stages/${f}`))) lines.push(...(stage.errors ?? []).map((e) => `content/fighter/stages/${f} ${e.instancePath} ${e.message ?? ''}`));
  }
  return { name: 'schemas (roster, stages)', ok: lines.length === 0, lines };
}

interface LockEntry { variants: Record<string, string> }

/** The variant of `entry` a tier reads, through C07 `resolveVariant` (`default`, else the first of the tier's fallback chain); undefined when none. */
export function variantFor(entry: LockEntry, tier: QualityTierId): string | undefined {
  const variants = Object.fromEntries(Object.entries(entry.variants).map(([v, sha]) => [v, { key: sha, sha256: sha }]));
  try {
    const hit = resolveVariant({ kind: 'character', id: 'x', variants } as unknown as AssetManifest, tier) as unknown as { key: string };
    return Object.entries(entry.variants).find(([, sha]) => sha === hit.key)?.[0];
  } catch {
    return undefined;
  }
}

/** The animation names of a .glb (the JSON chunk). */
export function glbClips(bytes: Buffer): string[] {
  const jsonLen = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8')) as { animations?: { name?: string }[] };
  return (json.animations ?? []).map((a) => a.name ?? '');
}

interface Fallbacks { schema: string; shapes: string[]; kits: Record<string, Record<string, string>> }

/** Step 3: every asset a slot names (and its stand-in's) resolves for all six tiers; every move of the kit has a clip or a library fallback. */
export function completenessStep(root: string): Step {
  const lines: string[] = [];
  const lock = readJson<{ entries: Record<string, LockEntry> }>(root, 'assets/assets.lock.json').entries;
  const roster = readJson<RosterEntry[]>(root, 'content/fighter/roster.json');
  const fallbacksFile = path.join(root, 'content/fighter/clip-fallbacks.json');
  const fb: Fallbacks = existsSync(fallbacksFile) ? readJson<Fallbacks>(root, 'content/fighter/clip-fallbacks.json') : { schema: 'missing', shapes: [], kits: {} };
  if (fb.schema === 'missing') lines.push('content/fighter/clip-fallbacks.json does not exist: run fighter:gen-clip-fallbacks');
  const check = (slot: string, who: string, ref: string): void => {
    const e = lock[ref];
    if (e === undefined) { lines.push(`${slot}: ${who} ${ref} is not in assets/assets.lock.json`); return; }
    for (const t of TIERS) if (variantFor(e, t) === undefined) lines.push(`${slot}: ${who} ${ref} has no variant for ${t}`);
  };
  const inspected = new Set<string>();
  for (const r of roster) {
    for (const [who, assets] of [['fighter', r.assets], ['stand-in', r.standIn.assets]] as const) {
      for (const k of ['model', 'animBase', 'animMoves', 'portrait'] as const) check(r.slot, who, assets[k]);
    }
    const kitFile = path.join(root, 'content/fighter/kits', `${r.kit}.json`);
    if (!existsSync(kitFile)) { lines.push(`${r.slot}: kit ${r.kit}.json does not exist`); continue; }
    const kit = JSON.parse(readFileSync(kitFile, 'utf8')) as FighterDef;
    const fallback = fb.kits[r.kit] ?? {};
    for (const ref of new Set([r.assets.animMoves, r.standIn.assets.animMoves])) {
      const id = ref.slice(ref.indexOf('/') + 1);
      const glb = path.join(root, 'assets/src/anim', id, 'default.glb');
      if (!existsSync(glb)) { lines.push(`${r.slot}: ${ref} has no clip file`); continue; }
      const bytes = readFileSync(glb);
      const clips = new Set(glbClips(bytes));
      for (const m of movesOf(kit)) {
        if (clips.has(m.id)) continue;
        const lib = fallback[m.id];
        if (lib === undefined) lines.push(`${r.slot}: the clip file of ${ref} has no clip for ${m.id} and clip-fallbacks.json has no library clip for it`);
        else if (!fb.shapes.includes(lib.slice(0, lib.lastIndexOf('.')))) lines.push(`${r.slot}: clip-fallbacks.json maps ${m.id} to ${lib}, which is not a library shape`);
      }
      // a baked file (not the gray-box timing clips) must match the kit frame for frame and carry a passing A5 record
      if (!isGraybox(ref) && !inspected.has(`${r.kit}:${ref}`)) {
        inspected.add(`${r.kit}:${ref}`);
        const rep = path.join(root, 'assets/src/anim', id, 'retarget.json');
        const report = existsSync(rep) ? (JSON.parse(readFileSync(rep, 'utf8')) as Retarget5) : null;
        for (const f of inspectMoves(bytes, kit, report)) if (f.rule !== 'clip-missing' || fallback[f.clip] === undefined) lines.push(`${r.slot}: ${ref} ${f.rule} ${f.clip}: ${f.detail}`);
      }
    }
  }
  return { name: 'roster completeness (model, clips or library fallbacks, portrait, stand-in for all six tiers)', ok: lines.length === 0, lines };
}

export function gateStep(root: string): Step {
  const r = runRosterGate(root);
  return { name: 'tier and fame-domain gates', ok: r.findings.length === 0, lines: r.findings.map((f) => `${f.rule}: ${f.detail}`) };
}

function pnpmStep(root: string, name: string, argv: string[]): Step {
  const r = spawnSync('pnpm', argv, { cwd: root, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' }, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout}${r.stderr}`.split('\n').filter((l) => l.trim() !== '');
  return { name, ok: r.status === 0, lines: r.status === 0 ? out.slice(-3) : out.slice(-25) };
}

export function runAll(root: string, o: { bouts: number; balance: boolean }): Step[] {
  const fighter = ['--filter', '@dv/mode-fighter'];
  const steps: Step[] = [schemaStep(root)];
  steps.push(pnpmStep(root, 'fighter:lint (tuning, kits, fame-domain rule)', [...fighter, 'fighter:lint', '--', '--quiet']));
  steps.push(completenessStep(root), gateStep(root));
  for (const g of ['gen-kits', 'gen-souls', 'gen-graybox', 'gen-clip-fallbacks']) steps.push(pnpmStep(root, `${g} --check (generated files match their tables)`, [...fighter, `fighter:${g}`, '--', '--check']));
  const goldens = readdirSync(path.join(root, 'packages/modes/fighter/golden')).filter((f) => f.endsWith('.dvfight')).sort().map((f) => `golden/${f}`);
  steps.push(pnpmStep(root, `golden replays (${goldens.length})`, [...fighter, 'fighter:replay', '--', ...goldens]));
  if (o.balance) steps.push(pnpmStep(root, `balance smoke (28 pairs x ${o.bouts} bouts per side, 35-65 %)`, [...fighter, 'fighter:balance', '--', '--bouts', String(o.bouts), '--build', 'smoke', '--no-write']));
  return steps;
}

function main(): void {
  const { values } = parseArgs({ args: args(), options: { bouts: { type: 'string' }, 'no-balance': { type: 'boolean' }, root: { type: 'string' } } });
  const root = path.resolve(values.root ?? repoRoot);
  const steps = runAll(root, { bouts: Number(values.bouts ?? '100'), balance: values['no-balance'] !== true });
  let bad = 0;
  for (const s of steps) {
    console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name}`);
    if (!s.ok) { bad++; for (const l of s.lines) console.log(`       ${l}`); }
  }
  console.log(bad === 0 ? `check:fighter: ok (${steps.length} steps)` : `check:fighter: FAIL (${bad} of ${steps.length} steps)`);
  process.exit(bad === 0 ? 0 : 1);
}

if (isMain(import.meta.url)) main();
