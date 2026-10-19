/**
 * perf:checklist (11-platform-perf.md section 9): prints the scripted steps and the URL of a device pass so the operator can
 * follow them on the device.
 *
 *   tsx tools/ci/perf-checklist.ts <checklist.json> [--url <preview-url>]
 *
 * With `--url` the `<preview>` placeholder is replaced. Exit 1 when the file is not a valid DeviceChecklist.
 */
import { existsSync } from 'node:fs';
import type { DeviceChecklist } from '../../packages/shared/src/index.ts';
import { args } from './run.ts';
import { isMain, readJson } from './lib/common.ts';

const UPLOADS = ['perf.json', 'notes.json'];
const OPS = ['<=', '>=', '=='];

/** Structural problems of a checklist; empty means valid. */
export function checklistErrors(c: unknown): string[] {
  const errors: string[] = [];
  if (typeof c !== 'object' || c === null) return ['not an object'];
  const o = c as Partial<DeviceChecklist>;
  for (const k of ['id', 'milestone', 'device', 'urlTemplate'] as const) if (typeof o[k] !== 'string' || o[k] === '') errors.push(`${k} is missing`);
  if (typeof o.urlTemplate === 'string' && !o.urlTemplate.includes('<preview>')) errors.push('urlTemplate has no <preview> placeholder');
  if (!Array.isArray(o.steps) || o.steps.length === 0) errors.push('steps is empty');
  else {
    const seen = new Set<string>();
    o.steps.forEach((s, i) => {
      if (typeof s.id !== 'string' || s.id === '') errors.push(`steps[${i}].id is missing`);
      else if (seen.has(s.id)) errors.push(`steps[${i}].id ${s.id} is duplicated`);
      else seen.add(s.id);
      if (typeof s.instruction !== 'string' || s.instruction === '') errors.push(`steps[${i}].instruction is missing`);
      for (const [j, e] of (s.expect ?? []).entries()) {
        if (typeof e.metric !== 'string' || e.metric === '') errors.push(`steps[${i}].expect[${j}].metric is missing`);
        if (!OPS.includes(e.op)) errors.push(`steps[${i}].expect[${j}].op must be one of ${OPS.join(' ')}`);
        if (!['string', 'number', 'boolean'].includes(typeof e.value)) errors.push(`steps[${i}].expect[${j}].value is missing`);
      }
    });
  }
  if (!Array.isArray(o.upload) || o.upload.length === 0 || o.upload.some((u) => !UPLOADS.includes(u))) errors.push(`upload must list ${UPLOADS.join(' and/or ')}`);
  return errors;
}

export function formatChecklist(c: DeviceChecklist, previewUrl?: string): string[] {
  const origin = previewUrl ? (/^https?:\/\//.test(previewUrl) ? previewUrl : `https://${previewUrl}`).replace(/\/$/, '') : null;
  const url = (s: string): string => (origin ? s.replaceAll('https://<preview>', origin).replaceAll('<preview>', origin) : s);
  const out: string[] = [];
  out.push(`${c.id} (${c.milestone})`);
  out.push(`Device: ${c.device}`);
  out.push(`URL: ${url(c.urlTemplate)}`);
  out.push('');
  c.steps.forEach((s, i) => {
    out.push(`${String(i + 1).padStart(2, ' ')}. [${s.id}] ${url(s.instruction)}`);
    for (const e of s.expect ?? []) out.push(`      expect ${e.metric} ${e.op} ${String(e.value)}`);
  });
  out.push('');
  out.push(`Upload: ${c.upload.join(', ')}`);
  out.push(`Then: pnpm perf:verify -- <perf.json> --tier <id> --checklist <this file>`);
  return out;
}

function main(): void {
  const argv = args();
  const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--url');
  const urlIdx = argv.indexOf('--url');
  const previewUrl = urlIdx >= 0 ? argv[urlIdx + 1] : undefined;
  if (!file) {
    console.error('usage: perf:checklist -- <checklist.json> [--url <preview-url>]');
    process.exit(2);
  }
  if (!existsSync(file)) {
    console.error(`perf:checklist: ${file} not found`);
    process.exit(2);
  }
  const c = readJson<DeviceChecklist>(file);
  const errors = checklistErrors(c);
  if (errors.length > 0) {
    for (const e of errors) console.error(`  FAIL  ${e}`);
    console.error('perf:checklist failed');
    process.exit(1);
  }
  for (const line of formatChecklist(c, previewUrl)) console.log(line);
}

if (isMain(import.meta.url)) main();
