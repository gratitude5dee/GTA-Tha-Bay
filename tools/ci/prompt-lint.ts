/**
 * prompt-lint CLI (spec/domains/03-story-cutscenes.md section D4, DL-550; M05b2): a thin shell over the pure `lintPrompt` of
 * @dv/shared. It lints the genAI prompt templates under `content/prompts/genai/` (frontmatter checks, rules 1 to 6) and is
 * called by `check:assets`, by `missions:build` and by the cutscene index builder.
 *
 * Names: the public denylist plus the display side of `config/names.json`; the real side comes from `DV_NAMES_REAL_JSON`
 * (CI only). Without it the real side is skipped with a `SKIP ... DV_NAMES_REAL_JSON not set` line.
 *
 *   tsx tools/ci/prompt-lint.ts [--root <dir>] [--file <template.md> ...] [--prompt <text>]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parse as parseYaml } from 'yaml';
import { finding, type GateFinding } from '../../packages/shared/src/assets/gates/types.ts';
import type { NamesFile } from '../../packages/shared/src/assets/gates/names.ts';
import { KEYFRAME_ENDPOINT, endpointPin } from '../../packages/shared/src/genai/cutscene-key.ts';
import type { GenAiRegistry } from '../../packages/shared/src/genai/registry.ts';
import {
  CLOSED_SLOT_SOURCES, lintPrompt, slotBase, templateSlots,
  type PromptBanned, type PromptLintCtx, type PromptLintResult,
} from '../../packages/shared/src/genai/prompt-lint.ts';
import { splitFrontmatter } from '../../packages/shared/src/npc/parse.ts';
import { args } from './run.ts';
import { isMain, readJson, report, toolsRoot } from './lib/common.ts';
import { loadRealSide } from './names-lint.ts';

const GATE = 'prompt-lint';
export const TEMPLATE_DIR = 'content/prompts/genai';

export interface LintBase {
  names: string[];
  denylist: PromptLintCtx['denylist'];
  banned: PromptBanned;
  /** The registry's keyframe pin, `<id>@<pinnedUpdatedAt>`. */
  keyframePin: string;
  /** Printed by the caller. */
  notes: string[];
}

function nameStrings(file: NamesFile, side: 'display' | 'real'): string[] {
  const out: string[] = [];
  for (const e of file.entries) {
    if (side === 'display' && e.display) out.push(e.display);
    if (side === 'real') {
      if (e.real) out.push(e.real);
      for (const a of e.aliases ?? []) out.push(a);
    }
  }
  return out;
}

/** The parts of the lint context that do not depend on a prompt: names, denylist, banned lists, the registry pin. */
export function loadLintBase(root: string, env: NodeJS.ProcessEnv = process.env): LintBase {
  const notes: string[] = [];
  const names = nameStrings(readJson<NamesFile>(path.join(root, 'config/names.json')), 'display');
  const real = loadRealSide(env['DV_NAMES_REAL_JSON']);
  if (real) names.push(...nameStrings(real, 'real'));
  else notes.push(`SKIP ${GATE} real-side names: DV_NAMES_REAL_JSON not set`);
  const registry = readJson<GenAiRegistry>(path.join(root, 'config/genai-endpoints.json'));
  const kf = registry.endpoints[KEYFRAME_ENDPOINT];
  return {
    names,
    denylist: readJson(path.join(root, 'config/ip-denylist.json')),
    banned: readJson(path.join(root, 'config/prompt-banned.json')),
    keyframePin: kf ? endpointPin(kf) : `${KEYFRAME_ENDPOINT}@missing`,
    notes,
  };
}

export interface Template {
  file: string;
  front: {
    id?: string; version?: number; hook?: string; slots?: string[]; keyframePin?: string; style?: string; aspect?: string; resolution?: string; recipe?: string; audio?: string;
    shots?: { durationS: 6 | 7 | 8 | 9 | 10; camera: 'static' | 'push-in' | 'pull-out' | 'pan' | 'orbit' | 'tracking' }[];
  };
  body: string;
}

export function parseTemplate(file: string, text: string): Template {
  const { yaml, body } = splitFrontmatter(text);
  return { file, front: (parseYaml(yaml) ?? {}) as Template['front'], body };
}

/** Lints one template: rules 1 to 5 on the body with every slot read as filled from its closed source, rule 6 on the pin. */
export function lintTemplate(t: Template, base: LintBase): PromptLintResult & { slotFindings: string[] } {
  const used = templateSlots(t.body);
  const slots = used.map((s) => ({ slot: s, source: CLOSED_SLOT_SOURCES[slotBase(s)] ?? 'unknown' }));
  // The worst case for rule 3: every v1 template shows a character whose tier is not `consented`.
  const res = lintPrompt(t.body, {
    names: base.names, denylist: base.denylist, banned: base.banned,
    cast: [{ id: 'template', tier: 'fictionalized' }],
    slots,
    keyframePin: { template: t.front.keyframePin ?? '', registry: base.keyframePin },
  });
  const declared = [...(t.front.slots ?? [])].sort();
  const slotFindings: string[] = [];
  if (JSON.stringify(declared) !== JSON.stringify([...used].sort())) slotFindings.push(`frontmatter slots [${declared.join(', ')}] differ from the placeholders [${[...used].sort().join(', ')}]`);
  if (t.front.aspect !== '16:9' || t.front.resolution !== '768P') slotFindings.push('aspect must be 16:9 and resolution 768P');
  return { ...res, slotFindings };
}

export function lintTemplates(root: string, files: readonly string[], env: NodeJS.ProcessEnv = process.env): { findings: GateFinding[]; scanned: number; notes: string[] } {
  const base = loadLintBase(root, env);
  const findings: GateFinding[] = [];
  for (const rel of files) {
    const t = parseTemplate(rel, readFileSync(path.join(root, rel), 'utf8'));
    const r = lintTemplate(t, base);
    for (const f of r.failures) findings.push(finding(GATE, rel, `rule-${f.rule}`, f.detail));
    for (const d of r.slotFindings) findings.push(finding(GATE, rel, 'template', d));
  }
  return { findings, scanned: files.length, notes: base.notes };
}

export function templateFiles(root: string): string[] {
  const dir = path.join(root, TEMPLATE_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.md')).sort().map((n) => `${TEMPLATE_DIR}/${n}`);
}

/** Lints a bare prompt text (rules 1 to 5) against the repository lists; used by the index builder on the prompts it plans. */
export function lintText(text: string, base: LintBase, cast: PromptLintCtx['cast']): PromptLintResult {
  return lintPrompt(text, { names: base.names, denylist: base.denylist, banned: base.banned, cast });
}

function main(): void {
  const { values } = parseArgs({ args: args(), options: { root: { type: 'string' }, file: { type: 'string', multiple: true }, prompt: { type: 'string' } } });
  const root = path.resolve(values.root ?? toolsRoot);
  if (values.prompt !== undefined) {
    const base = loadLintBase(root);
    for (const n of base.notes) console.log(n);
    const r = lintText(values.prompt, base, [{ id: 'cli', tier: 'fictionalized' }]);
    for (const f of r.failures) console.log(`${GATE}: rule ${f.rule}: ${f.detail}`);
    process.exit(r.ok ? 0 : 1);
  }
  const files = values.file && values.file.length > 0 ? values.file : templateFiles(root);
  const res = lintTemplates(root, files);
  for (const n of res.notes) console.log(n);
  process.exit(report(GATE, res.findings, res.scanned));
}

if (isMain(import.meta.url)) main();
