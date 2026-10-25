/**
 * npc:edge-bundle (M06a3). Writes `services/edge/src/generated/npc-fixtures.json`: block A (the public example rules) and the compiled
* `npc_test` soul (M06a4 adds the original voiced hero `ro-batista`, so a Preview can speak with Aura), so the dialogue Worker has something to talk to where the PRIVATE bucket holds no souls (local runs, Workers
 * Previews, the Workers-runtime tests). The Worker reads this file only while `ANTHROPIC_MODE` is not `live`; a live Worker reads
 * block A and every soul from PRIVATE (`prompts/npc/rules@<n>.md`, `souls/<id>/<ver>/...`). `npc_test` is an original public
 * character (content/npcs/npc_test), so bundling it exposes nothing private.
 *
 *   tsx tools/soul/src/cli.ts edge-bundle [--check]
 *
 * `--check` fails when the committed file is not what the current sources produce (the drift guard of tools/soul/test/edge-bundle.spec.ts).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NamesFile } from '../../../packages/shared/src/assets/gates/names.ts';
import type { VoiceCatalog } from '../../../packages/shared/src/contracts/c10-npc.ts';
import { loadGoals, loadPoiTable, loadRules, readJson } from './common.ts';
import { compileToFiles } from './compile.ts';
import { knownNamesOf } from './lint.ts';

export const EDGE_BUNDLE_PATH = 'services/edge/src/generated/npc-fixtures.json';
/** compiledAt of the bundled soul: fixed, so the file only changes when the sources do. */
const FIXED_COMPILED_AT = Date.UTC(2026, 9, 22);
export const BUNDLED_SOUL_IDS = ['npc_test', 'ro-batista'] as const;

export interface EdgeBundle {
  schema: 'npc-edge-fixtures/1';
  rules: { version: number; text: string };
  souls: Record<string, { soulVersion: number; promptSha256: string; prompt: string; compiled: unknown }>;
}

export async function buildEdgeBundle(root: string): Promise<EdgeBundle> {
  const rules = loadRules(root);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'npc-edge-'));
  try {
    const souls: EdgeBundle['souls'] = {};
    for (const id of BUNDLED_SOUL_IDS) {
      const c = await compileToFiles(root, id, { out: tmp, rules, nowMs: FIXED_COMPILED_AT, noTokenWrite: true, env: {} });
      souls[id] = {
        soulVersion: c.soulVersion,
        promptSha256: c.promptSha256,
        prompt: readFileSync(path.join(c.dir, 'soul.prompt.txt'), 'utf8'),
        compiled: JSON.parse(readFileSync(path.join(c.dir, 'soul.compiled.json'), 'utf8')) as unknown,
      };
    }
    return { schema: 'npc-edge-fixtures/1', rules: { version: rules.version, text: rules.text }, souls };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** M06b1: the tables the NPC builder reads in the Worker, which cannot import `config/` or `content/` (services import only @dv/shared). */
export const BUILDER_DATA_PATH = 'services/edge/src/generated/npc-builder-data.json';

export interface BuilderData {
  schema: 'npc-builder-data/1';
  /** `config/npc.json#builder`. */
  config: unknown;
  /** PoiIds by district (the prefix after `poi.`), from the C08 table or its stub. */
  pois: Record<string, string[]>;
  /** The goal catalog. */
  goals: string[];
  /** Voices a user NPC may pick: `text` and `t1` entries of `config/voice-catalog.json` that every likeness tier may use. */
  voices: { voiceRef: string; tier: string }[];
  /** Normalised display names of the shipped souls and of config/names.json, to the id that owns each (lint L3, display side). */
  knownNames: Record<string, string>;
  /** The blocks of `content/prompts/npc/builder-soul@1.md`: the soul system prompt, the repair note, the text classifier and the probe judge. */
  prompts: { version: 1; soul: string; repair: string; classifier: string; judge: string };
}

export const BUILDER_PROMPT_PATH = 'content/prompts/npc/builder-soul@1.md';

/** The text between `<tag>` and `</tag>` lines of the builder prompt file. */
function promptBlock(text: string, tag: string): string {
  const m = new RegExp(`^<${tag}>\n([\\s\\S]*?)\n</${tag}>$`, 'm').exec(text);
  if (m === null) throw new Error(`${BUILDER_PROMPT_PATH}: no <${tag}> block`);
  return (m[1] as string).trim();
}

export function buildBuilderData(root: string): BuilderData {
  const npc = readJson<{ builder: unknown }>(root, 'config/npc.json');
  const table = loadPoiTable(root);
  const districts = [...(table.districts ?? [])].sort((a, b) => b.length - a.length);
  const pois: Record<string, string[]> = {};
  for (const poi of [...table.pois].sort()) {
    const d = districts.find((x) => poi.startsWith(`poi.${x}.`));
    if (d !== undefined) (pois[d] ??= []).push(poi);
  }
  const catalog = readJson<VoiceCatalog>(root, 'config/voice-catalog.json');
  const voices = catalog.entries
    .filter((e) => (e.tier === 'text' || e.tier === 't1') && e.allowedTiers.includes('fictionalized'))
    .map((e) => ({ voiceRef: e.voiceRef, tier: e.tier }));
  const names = readJson<NamesFile>(root, 'config/names.json');
  const known = knownNamesOf(root, names);
  return {
    schema: 'npc-builder-data/1',
    config: npc.builder,
    pois: Object.fromEntries(Object.entries(pois).sort(([a], [b]) => (a < b ? -1 : 1))),
    goals: [...loadGoals(root)].sort(),
    voices,
    knownNames: Object.fromEntries([...known].sort(([a], [b]) => (a < b ? -1 : 1))),
    prompts: (() => {
      const text = readFileSync(path.join(root, BUILDER_PROMPT_PATH), 'utf8');
      return { version: 1 as const, soul: promptBlock(text, 'system'), repair: promptBlock(text, 'repair'), classifier: promptBlock(text, 'classifier'), judge: promptBlock(text, 'judge') };
    })(),
  };
}

export const renderEdgeBundle = (b: EdgeBundle): string => `${JSON.stringify(b, null, 2)}\n`;

export async function runEdgeBundle(root: string, check: boolean): Promise<{ ok: boolean; message: string }> {
  const files = [
    { rel: EDGE_BUNDLE_PATH, text: renderEdgeBundle(await buildEdgeBundle(root)) },
    { rel: BUILDER_DATA_PATH, text: `${JSON.stringify(buildBuilderData(root), null, 2)}\n` },
  ];
  if (check) {
    const stale = files.filter((f) => {
      const file = path.join(root, f.rel);
      return (existsSync(file) ? readFileSync(file, 'utf8') : null) !== f.text;
    });
    return stale.length === 0
      ? { ok: true, message: `npc:edge-bundle: ${files.map((f) => f.rel).join(' and ')} are current` }
      : { ok: false, message: `npc:edge-bundle: ${stale.map((f) => f.rel).join(' and ')} is stale; run pnpm npc:edge-bundle` };
  }
  for (const f of files) writeFileSync(path.join(root, f.rel), f.text);
  return { ok: true, message: `npc:edge-bundle: wrote ${files.map((f) => `${f.rel} (${f.text.length} bytes)`).join(' and ')}` };
}
