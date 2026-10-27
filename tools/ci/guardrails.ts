/**
 * config/guardrails.yaml -> packages/shared/src/genai/guardrails.generated.ts
 *
 *   tsx tools/ci/guardrails.ts --write    regenerate the TypeScript constant
 *   tsx tools/ci/guardrails.ts --check    fail when the generated file is out of date (default)
 *
 * The Worker cannot read YAML at runtime, so the `genai:` section is mirrored into a typed constant at commit time.
 * The parser handles the subset this file uses: nested maps by two-space indentation, scalars, inline `[a, b]` lists and
 * `#` comments. A construct outside the subset is an error, so the file cannot silently drift from what the Worker reads.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, repoRoot } from './run.ts';

export type YamlValue = string | number | boolean | YamlValue[] | { [k: string]: YamlValue };

function scalar(raw: string): YamlValue {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((x) => scalar(x));
  }
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  if (/^[A-Za-z0-9_.:/@-]+$/.test(t)) return t;
  throw new Error(`guardrails.yaml: unsupported value ${JSON.stringify(raw)}`);
}

export function parseGuardrailsYaml(text: string): { [k: string]: YamlValue } {
  const root: { [k: string]: YamlValue } = {};
  const stack: { indent: number; node: { [k: string]: YamlValue } }[] = [{ indent: -1, node: root }];
  for (const [i, rawLine] of text.split('\n').entries()) {
    const line = rawLine.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '');
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    if (indent % 2 !== 0) throw new Error(`guardrails.yaml:${i + 1}: indent must be a multiple of 2`);
    const m = /^([A-Za-z0-9_]+):(?:\s+(.*))?$/.exec(line.trim());
    if (!m) throw new Error(`guardrails.yaml:${i + 1}: expected "key: value"`);
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const parent = stack[stack.length - 1]!.node;
    const key = m[1]!;
    if (m[2] === undefined || m[2].trim() === '') {
      const child: { [k: string]: YamlValue } = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = scalar(m[2]);
    }
  }
  return root;
}

export const GENAI_LINES = ['spike', 'characters', 'cutscenes', 'vehiclesProps', 'buffer'] as const;

export interface GenaiGuardrails {
  programCapUsdMicros: number;
  falConcurrency: number;
  alarms: number[];
  /** M10a1: per-line caps in USD micros; together they stay within the program cap. */
  lines: Record<(typeof GENAI_LINES)[number], number>;
}

export function genaiSection(text: string): GenaiGuardrails {
  const genai = parseGuardrailsYaml(text)['genai'];
  if (typeof genai !== 'object' || genai === null || Array.isArray(genai)) throw new Error('guardrails.yaml: missing genai section');
  const { programCapUsdMicros, falConcurrency, alarms } = genai;
  if (typeof programCapUsdMicros !== 'number' || !Number.isInteger(programCapUsdMicros) || programCapUsdMicros <= 0) {
    throw new Error('guardrails.yaml: genai.programCapUsdMicros must be a positive integer (USD micros)');
  }
  if (typeof falConcurrency !== 'number' || !Number.isInteger(falConcurrency) || falConcurrency < 1) throw new Error('guardrails.yaml: genai.falConcurrency must be an integer >= 1');
  if (!Array.isArray(alarms) || alarms.length === 0 || alarms.some((a) => typeof a !== 'number' || a <= 0 || a > 1)) {
    throw new Error('guardrails.yaml: genai.alarms must be fractions in (0, 1]');
  }
  const lines = intMap(genai['lines'], GENAI_LINES, 'genai.lines');
  const sum = GENAI_LINES.reduce((n, k) => n + lines[k], 0);
  if (sum > programCapUsdMicros) throw new Error('guardrails.yaml: genai.lines must sum to at most genai.programCapUsdMicros');
  return { programCapUsdMicros, falConcurrency, alarms: alarms as number[], lines };
}

export interface NpcGuardrails {
  quotas: Record<'p0' | 'linked', Record<'turns' | 'perNpc' | 'voiceLines' | 'costCapUsdMicros' | 'builderText' | 'builderJob' | 'uploads' | 'posts' | 'reports', number>>;
  netMultiplier: number;
  playTokensPerNet: number;
  signupsPerNet: number;
  builderTextPerDraftMs: number;
  builder: Record<(typeof BUILDER_KEYS)[number], number>;
  encounter: Record<'turnCap' | 'turnCapHard' | 'cadenceMs' | 'idleCloseMs' | 'firstTokenMs' | 'transcriptRetentionDays' | 'indexStaleMs', number>;
  roster: Record<'isolateCacheMs' | 'pollMs', number>;
  estimates: Record<'turnUsdMicros' | 'voiceLineUsdMicros' | 'builderTextUsdMicros', number>;
}

const QUOTA_KEYS = ['turns', 'perNpc', 'voiceLines', 'costCapUsdMicros', 'builderText', 'builderJob', 'uploads', 'posts', 'reports'] as const;
const BUILDER_KEYS = [
  'liveDraftsP0', 'liveDraftsLinked', 'previewTurnsPerDraftPerDay', 'backstoryCharsMax', 'draftRetentionDays', 'soulMaxTokens', 'sexualMinorsMilli',
  'selfHarmIntentMilli',
] as const;
const ENCOUNTER_KEYS = ['turnCap', 'turnCapHard', 'cadenceMs', 'idleCloseMs', 'firstTokenMs', 'transcriptRetentionDays', 'indexStaleMs'] as const;
const ROSTER_KEYS = ['isolateCacheMs', 'pollMs'] as const;
const ESTIMATE_KEYS = ['turnUsdMicros', 'voiceLineUsdMicros', 'builderTextUsdMicros'] as const;

function intMap<K extends string>(node: YamlValue | undefined, keys: readonly K[], where: string): Record<K, number> {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) throw new Error(`guardrails.yaml: missing ${where}`);
  const out = {} as Record<K, number>;
  for (const k of keys) {
    const v = node[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new Error(`guardrails.yaml: ${where}.${k} must be a non-negative integer`);
    out[k] = v;
  }
  return out;
}

export function npcSection(text: string): NpcGuardrails {
  const npc = parseGuardrailsYaml(text)['npc'];
  if (typeof npc !== 'object' || npc === null || Array.isArray(npc)) throw new Error('guardrails.yaml: missing npc section');
  const quotas = npc['quotas'];
  if (typeof quotas !== 'object' || quotas === null || Array.isArray(quotas)) throw new Error('guardrails.yaml: missing npc.quotas');
  const top = intMap(npc, ['netMultiplier', 'playTokensPerNet', 'signupsPerNet', 'builderTextPerDraftMs'] as const, 'npc');
  if (top.netMultiplier < 1) throw new Error('guardrails.yaml: npc.netMultiplier must be >= 1');
  const encounter = intMap(npc['encounter'], ENCOUNTER_KEYS, 'npc.encounter');
  if (encounter.turnCap > encounter.turnCapHard) throw new Error('guardrails.yaml: npc.encounter.turnCap must not exceed turnCapHard');
  return {
    quotas: { p0: intMap(quotas['p0'], QUOTA_KEYS, 'npc.quotas.p0'), linked: intMap(quotas['linked'], QUOTA_KEYS, 'npc.quotas.linked') },
    ...top,
    builder: intMap(npc['builder'], BUILDER_KEYS, 'npc.builder'),
    encounter,
    roster: intMap(npc['roster'], ROSTER_KEYS, 'npc.roster'),
    estimates: intMap(npc['estimates'], ESTIMATE_KEYS, 'npc.estimates'),
  };
}

export function renderNpcGenerated(n: NpcGuardrails): string {
  const lit = (v: unknown, pad: string): string => {
    if (typeof v !== 'object' || v === null) return String(v);
    const entries = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${pad}  ${k}: ${lit(x, `${pad}  `)},`);
    return `{\n${entries.join('\n')}\n${pad}}`;
  };
  return ['// Generated by tools/ci/guardrails.ts from config/guardrails.yaml (section npc). Do not edit.', `export const NPC_GUARDRAILS = ${lit(n, '')} as const;`, ''].join('\n');
}

export function renderGenerated(g: GenaiGuardrails): string {
  return [
    '// Generated by tools/ci/guardrails.ts from config/guardrails.yaml. Do not edit.',
    'export const GENAI_GUARDRAILS = {',
    `  programCapUsdMicros: ${g.programCapUsdMicros},`,
    `  falConcurrency: ${g.falConcurrency},`,
    `  alarms: [${g.alarms.join(', ')}],`,
    '  lines: {',
    ...GENAI_LINES.map((k) => `    ${k}: ${g.lines[k]},`),
    '  },',
    '} as const;',
    '',
  ].join('\n');
}

export const YAML_PATH = path.join(repoRoot, 'config/guardrails.yaml');
export const GENERATED_PATH = path.join(repoRoot, 'packages/shared/src/genai/guardrails.generated.ts');
export const NPC_GENERATED_PATH = path.join(repoRoot, 'packages/shared/src/genai/npc-guardrails.generated.ts');

export function main(argv: string[]): number {
  const yaml = readFileSync(YAML_PATH, 'utf8');
  const targets = [
    { file: GENERATED_PATH, expected: renderGenerated(genaiSection(yaml)) },
    { file: NPC_GENERATED_PATH, expected: renderNpcGenerated(npcSection(yaml)) },
  ];
  if (argv.includes('--write')) {
    for (const t of targets) {
      writeFileSync(t.file, t.expected);
      console.log(`wrote ${path.relative(repoRoot, t.file)}`);
    }
    return 0;
  }
  let code = 0;
  for (const t of targets) {
    let actual = '';
    try {
      actual = readFileSync(t.file, 'utf8');
    } catch {
      // missing file: reported below
    }
    if (actual !== t.expected) {
      console.error(`${path.basename(t.file)} is out of date with config/guardrails.yaml; run: tsx tools/ci/guardrails.ts --write`);
      code = 1;
    } else console.log(`${path.basename(t.file)} matches config/guardrails.yaml`);
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(args()));
